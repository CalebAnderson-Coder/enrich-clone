import { supabase } from './supabase.js';
import { logger } from './logger.js';

const LLM_PRICING = {
  'nvidia': { input: 0.6, output: 0.6 },
  'gemini': { input: 0.075, output: 0.3 },
};

export async function trackCost({ lead_id, brand_id, source, amount_usd, metadata = {} }) {
  if (!supabase) return;
  if (!lead_id || !brand_id || !source) {
    logger.warn('[costTracker] missing required fields', { lead_id, brand_id, source });
    return;
  }

  try {
    const { error } = await supabase
      .from('lead_costs')
      .insert({
        lead_id,
        brand_id,
        source,
        amount_usd,
        metadata,
      });

    if (error) {
      logger.warn('[costTracker] insert failed', { error: error.message, lead_id });
      return;
    }

    logger.info('[costTracker] cost tracked', { lead_id, source, amount_usd });
  } catch (err) {
    logger.warn('[costTracker] exception', { error: err?.message });
  }
}

export function calculateLLMCost(provider, inputTokens, outputTokens) {
  const pricing = LLM_PRICING[provider.toLowerCase()] || LLM_PRICING.gemini;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return parseFloat((inputCost + outputCost).toFixed(4));
}
