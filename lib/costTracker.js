// ============================================================
// lib/costTracker.js — Track and record costs per lead
//
// Central hub for logging costs across all sources:
//   - LLM token consumption (NVIDIA, Gemini, etc.)
//   - Third-party APIs (Apify, Scrapling, Hunter, etc.)
//   - SMTP delivery
//   - Other operational costs
//
// Usage:
//   import { trackCost } from './costTracker.js';
//   await trackCost({
//     lead_id: '...',
//     brand_id: '...',
//     source: 'llm_tokens',
//     amount_usd: 0.045,
//     metadata: { model: 'gpt-4', tokens: { input: 500, output: 150 } }
//   });
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';
import { LLM_PRICING } from './llmPricing.js';

// ── Supabase singleton ──────────────────────────────────────

let _supabase = null;

function getSupabase() {
  if (_supabase) return _supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || 
              process.env.SUPABASE_SERVICE_KEY ||
              process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    logger.warn('costTracker: missing SUPABASE credentials, costs will not be tracked');
    return null;
  }

  _supabase = createClient(url, key, { auth: { persistSession: false } });
  return _supabase;
}

// ── Calculate LLM cost from tokens ─────────────────────────

/**
 * Estimates the USD cost of an LLM call based on token counts
 * and the model pricing table.
 *
 * @param {object} opts
 * @param {string} opts.model — 'gpt-4', 'gemini-flash', 'claude-3', etc.
 * @param {number} opts.inputTokens — prompt tokens
 * @param {number} opts.outputTokens — completion tokens
 * @returns {number} cost in USD
 */
export function calculateLLMCost({ model = '', inputTokens = 0, outputTokens = 0 }) {
  // Default to a safe estimate if model not found
  const modelLower = (model || '').toLowerCase();
  const pricing = LLM_PRICING[modelLower] || { input: 0.0003, output: 0.0006 };

  // Cost = (input_tokens / 1M) * input_price + (output_tokens / 1M) * output_price
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

// ── Track a single cost ────────────────────────────────────

/**
 * Logs a cost event to the lead_costs table.
 * Non-throwing: logs errors but doesn't fail the caller.
 *
 * @param {object} opts
 * @param {string} opts.lead_id — UUID of the lead
 * @param {string} opts.brand_id — UUID of the brand
 * @param {string} opts.source — cost source enum
 * @param {number} opts.amount_usd — cost in USD
 * @param {object} [opts.metadata] — optional extra data
 * @returns {Promise<{ok: boolean, error?: string, id?: string}>}
 */
export async function trackCost({
  lead_id,
  brand_id,
  source,
  amount_usd,
  metadata = {},
}) {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: true }; // Silent no-op if DB not configured
  }

  if (!lead_id || !brand_id || !source || amount_usd === undefined) {
    logger.warn('costTracker: missing required fields', { lead_id, brand_id, source });
    return { ok: false, error: 'Missing required fields' };
  }

  if (typeof amount_usd !== 'number' || amount_usd < 0) {
    logger.warn('costTracker: invalid amount_usd', { amount_usd });
    return { ok: false, error: 'Invalid amount_usd' };
  }

  try {
    const { data, error } = await supabase
      .from('lead_costs')
      .insert({
        lead_id,
        brand_id,
        source,
        amount_usd: parseFloat(amount_usd.toFixed(4)),
        occurred_at: new Date().toISOString(),
        metadata,
      })
      .select('id')
      .single();

    if (error) {
      logger.warn('costTracker: insert failed', {
        lead_id,
        source,
        amount_usd,
        err: error.message,
      });
      return { ok: false, error: error.message };
    }

    logger.debug('costTracker: cost logged', {
      id: data?.id,
      lead_id,
      source,
      amount_usd,
    });

    return { ok: true, id: data?.id };
  } catch (err) {
    logger.error('costTracker: unexpected error', { err: err.message });
    return { ok: false, error: err.message };
  }
}

// ── Batch track costs ──────────────────────────────────────

/**
 * Logs multiple cost events in a single call.
 * Each cost is inserted independently; errors on one don't block others.
 *
 * @param {object[]} costs — array of cost objects
 * @returns {Promise<{ok: number, failed: number}>}
 */
export async function trackCostsBatch(costs) {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: 0, failed: 0 };
  }

  let ok = 0;
  let failed = 0;

  for (const cost of costs) {
    const result = await trackCost(cost);
    if (result.ok) ok++;
    else failed++;
  }

  return { ok, failed };
}

// ── Get costs for a lead ───────────────────────────────────

/**
 * Sums the total cost for a given lead.
 * Returns 0 if the lead has no costs.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient|null} customSupabase
 * @param {string} lead_id
 * @returns {Promise<number>}
 */
export async function getTotalCostForLead(customSupabase, lead_id) {
  const supabase = customSupabase || getSupabase();
  if (!supabase) return 0;

  try {
    const { data, error } = await supabase
      .from('lead_costs')
      .select('amount_usd')
      .eq('lead_id', lead_id);

    if (error) {
      logger.warn('costTracker: failed to fetch costs', { lead_id, err: error.message });
      return 0;
    }

    return (data || []).reduce((sum, row) => sum + (row.amount_usd || 0), 0);
  } catch (err) {
    logger.error('costTracker: unexpected error in getTotalCostForLead', { err: err.message });
    return 0;
  }
}

// ── Get monthly cost summary ───────────────────────────────

/**
 * Aggregates costs for the current month by source.
 * Useful for cockpit dashboard "Costo este mes" card.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient|null} customSupabase
 * @param {string} brand_id
 * @returns {Promise<{total: number, bySource: {[key: string]: number}}>}
 */
export async function getMonthlyCostSummary(customSupabase, brand_id) {
  const supabase = customSupabase || getSupabase();
  if (!supabase) return { total: 0, bySource: {} };

  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('lead_costs')
      .select('amount_usd, source')
      .eq('brand_id', brand_id)
      .gte('occurred_at', startOfMonth.toISOString());

    if (error) {
      logger.warn('costTracker: failed to fetch monthly costs', { brand_id, err: error.message });
      return { total: 0, bySource: {} };
    }

    const bySource = {};
    let total = 0;

    for (const row of data || []) {
      const amount = row.amount_usd || 0;
      bySource[row.source] = (bySource[row.source] || 0) + amount;
      total += amount;
    }

    return { total, bySource };
  } catch (err) {
    logger.error('costTracker: unexpected error in getMonthlyCostSummary', { err: err.message });
    return { total: 0, bySource: {} };
  }
}

// ── Get average cost per lead (last 30 days) ───────────────

/**
 * Calculates average cost per unique lead over the last 30 days.
 * Useful for cockpit dashboard "Costo promedio por lead" card.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient|null} customSupabase
 * @param {string} brand_id
 * @returns {Promise<number>}
 */
export async function getAverageCostPerLead(customSupabase, brand_id) {
  const supabase = customSupabase || getSupabase();
  if (!supabase) return 0;

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get total cost
    const { data: costData, error: costErr } = await supabase
      .from('lead_costs')
      .select('amount_usd')
      .eq('brand_id', brand_id)
      .gte('occurred_at', thirtyDaysAgo.toISOString());

    if (costErr) {
      logger.warn('costTracker: failed to fetch costs for average', { brand_id, err: costErr.message });
      return 0;
    }

    const totalCost = (costData || []).reduce((sum, row) => sum + (row.amount_usd || 0), 0);
    if (totalCost === 0) return 0;

    // Get unique lead count
    const { data: leadData, error: leadErr } = await supabase
      .from('lead_costs')
      .select('lead_id', { count: 'exact', head: true })
      .eq('brand_id', brand_id)
      .gte('occurred_at', thirtyDaysAgo.toISOString())
      .distinct();

    if (leadErr) {
      logger.warn('costTracker: failed to count unique leads', { brand_id, err: leadErr.message });
      return 0;
    }

    const uniqueLeads = leadData?.length || 1; // Fallback to 1 to avoid division by zero
    return totalCost / uniqueLeads;
  } catch (err) {
    logger.error('costTracker: unexpected error in getAverageCostPerLead', { err: err.message });
    return 0;
  }
}

export default {
  calculateLLMCost,
  trackCost,
  trackCostsBatch,
  getTotalCostForLead,
  getMonthlyCostSummary,
  getAverageCostPerLead,
};
