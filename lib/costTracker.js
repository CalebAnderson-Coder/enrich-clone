// ============================================================
// lib/costTracker.js — Cost Tracking for all lead-related spend
//
// Provides trackCost() for any worker/agent to log costs.
// Called from:
//   - AgentRuntime.run() after LLM calls (prompt+completion tokens)
//   - tools/scrapling.js (enrichment cost)
//   - tools/apifyGoogleMaps.js (sourcing cost)
//   - outreach_dispatcher.js (SMTP cost estimate)
//
// All costs are stored in lead_costs table for ROI visibility.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';
import { calculateLlmCost } from './llmPricing.js';

let supabaseClient = null;

/**
 * Initialize the Supabase client (called once from worker boot).
 */
export function initCostTracker() {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
    if (url && key) {
      supabaseClient = createClient(url, key, { auth: { persistSession: false } });
    }
  }
  return supabaseClient;
}

/**
 * Track a cost for a lead.
 *
 * @param {object} params
 * @param {string} params.lead_id — UUID of the lead
 * @param {string} params.brand_id — UUID of the brand (if not provided, uses BRAND_ID env)
 * @param {string} params.source — 'llm_tokens' | 'apify' | 'scrapling' | 'smtp' | 'firecrawl' | 'other'
 * @param {number} params.amount_usd — cost in USD (can be calculated or passed)
 * @param {object} params.metadata — extra details { model, input_tokens, output_tokens, etc. }
 * @returns {Promise<{ok: boolean, error?: string, id?: string}>}
 */
export async function trackCost({
  lead_id,
  brand_id,
  source,
  amount_usd,
  metadata = {},
}) {
  const supabase = initCostTracker();

  if (!supabase) {
    logger.warn('costTracker: Supabase not initialized, skipping cost tracking');
    return { ok: false, error: 'Supabase not initialized' };
  }

  if (!lead_id) {
    logger.warn('costTracker: missing lead_id');
    return { ok: false, error: 'lead_id is required' };
  }

  const finalBrandId = brand_id || process.env.BRAND_ID;
  if (!finalBrandId) {
    logger.warn('costTracker: missing brand_id and BRAND_ID env var');
    return { ok: false, error: 'brand_id is required' };
  }

  const { data, error } = await supabase
    .from('lead_costs')
    .insert({
      lead_id,
      brand_id: finalBrandId,
      source,
      amount_usd: parseFloat(amount_usd) || 0,
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

  logger.info('costTracker: logged cost', {
    id: data.id,
    lead_id,
    source,
    amount_usd,
  });

  return { ok: true, id: data.id };
}

/**
 * Track LLM cost after an AgentRuntime call.
 * Calculates cost from tokens + provider pricing.
 *
 * @param {object} params
 * @param {string} params.lead_id
 * @param {string} params.brand_id
 * @param {string} params.provider — 'nvidia-nim' | 'gemini-2.0-flash' | etc
 * @param {number} params.input_tokens
 * @param {number} params.output_tokens
 * @param {string} params.model
 * @returns {Promise<{ok: boolean, error?: string, amount_usd?: number}>}
 */
export async function trackLlmCost({
  lead_id,
  brand_id,
  provider,
  input_tokens,
  output_tokens,
  model,
}) {
  const amount_usd = calculateLlmCost(provider, input_tokens, output_tokens);

  const result = await trackCost({
    lead_id,
    brand_id,
    source: 'llm_tokens',
    amount_usd,
    metadata: {
      provider,
      model,
      input_tokens,
      output_tokens,
    },
  });

  return { ...result, amount_usd };
}

/**
 * Get total cost for a lead.
 */
export async function getTotalCostForLead(lead_id) {
  const supabase = initCostTracker();
  if (!supabase) return { ok: false, error: 'Supabase not initialized' };

  const { data, error } = await supabase
    .from('lead_costs')
    .select('amount_usd')
    .eq('lead_id', lead_id);

  if (error) {
    logger.warn('costTracker: getTotalCostForLead failed', { lead_id, err: error.message });
    return { ok: false, error: error.message };
  }

  const total = (data || []).reduce((sum, row) => sum + parseFloat(row.amount_usd || 0), 0);
  return { ok: true, total };
}

/**
 * Get cost breakdown by source for a lead.
 */
export async function getCostBreakdownForLead(lead_id) {
  const supabase = initCostTracker();
  if (!supabase) return { ok: false, error: 'Supabase not initialized' };

  const { data, error } = await supabase
    .from('lead_costs')
    .select('source, amount_usd')
    .eq('lead_id', lead_id);

  if (error) {
    logger.warn('costTracker: getCostBreakdownForLead failed', { lead_id, err: error.message });
    return { ok: false, error: error.message };
  }

  const breakdown = {};
  (data || []).forEach(row => {
    const source = row.source || 'other';
    breakdown[source] = (breakdown[source] || 0) + parseFloat(row.amount_usd || 0);
  });

  return { ok: true, breakdown };
}
