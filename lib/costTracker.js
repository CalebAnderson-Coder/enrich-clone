// ============================================================
// lib/costTracker.js — Track costs per lead
//
// Used by: AgentRuntime, email dispatcher, etc. to log spend
// 
// Export:
//   trackCost({ lead_id, source, amount_usd, metadata, sb })
// ============================================================

import { logger } from './logger.js';

/**
 * Log a cost event to lead_costs table
 * @param {object} params
 * @param {string} params.lead_id - UUID of the lead
 * @param {string} params.brand_id - UUID of the brand (Empírika = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8')
 * @param {string} params.source - 'llm_tokens' | 'apify' | 'scrapling' | 'smtp'
 * @param {number} params.amount_usd - cost in USD
 * @param {object} params.metadata - optional metadata (tokens, provider, email domain, etc.)
 * @param {object} params.sb - Supabase client (createClient instance)
 * @returns {Promise<boolean>} - true if logged, false on error
 */
export async function trackCost({
  lead_id,
  brand_id,
  source,
  amount_usd,
  metadata = {},
  sb
}) {
  if (!sb) {
    logger.warn('[costTracker] trackCost called without sb (Supabase client)');
    return false;
  }

  if (!lead_id || !brand_id) {
    logger.warn('[costTracker] trackCost missing lead_id or brand_id', {
      lead_id,
      brand_id,
    });
    return false;
  }

  const validSources = ['llm_tokens', 'apify', 'scrapling', 'smtp'];
  if (!validSources.includes(source)) {
    logger.warn('[costTracker] invalid source', { source });
    return false;
  }

  if (amount_usd < 0 || amount_usd > 10000) {
    logger.warn('[costTracker] suspicious amount_usd', { amount_usd });
    return false;
  }

  try {
    const { error } = await sb
      .from('lead_costs')
      .insert([
        {
          lead_id,
          brand_id,
          source,
          amount_usd,
          occurred_at: new Date().toISOString(),
          metadata,
        },
      ]);

    if (error) {
      logger.warn('[costTracker] Failed to log cost', {
        lead_id,
        source,
        error: error.message,
      });
      return false;
    }

    return true;
  } catch (err) {
    logger.error('[costTracker] Unexpected error', {
      lead_id,
      source,
      error: err?.message,
    });
    return false;
  }
}

export default { trackCost };
