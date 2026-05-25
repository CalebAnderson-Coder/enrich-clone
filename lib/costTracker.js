import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

const LLM_PRICING = {
  nvidia: { input: 0.6 / 1_000_000, output: 0.6 / 1_000_000 },
  gemini: { input: 0.075 / 1_000_000, output: 0.3 / 1_000_000 },
  openai: { input: 0.5 / 1_000_000, output: 1.5 / 1_000_000 },
};

const FIXED_COSTS = {
  apify: 0.05,
  scrapling: 0.02,
  smtp: 0.001,
};

async function trackCost({ leadId, brandId, source, amountUsd, metadata = {} }) {
  if (!leadId || !brandId || !source) {
    logger.warn('costTracker: missing required fields', { leadId, brandId, source });
    return null;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  
  if (!url || !key) {
    logger.warn('costTracker: missing Supabase credentials');
    return null;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  try {
    const { data, error } = await supabase
      .from('lead_costs')
      .insert({
        lead_id: leadId,
        brand_id: brandId,
        source,
        amount_usd: parseFloat(amountUsd),
        metadata,
      })
      .select()
      .single();

    if (error) {
      logger.warn('costTracker: insert failed', { leadId, source, error: error.message });
      return null;
    }

    logger.info('costTracker: cost tracked', { leadId, source, amountUsd });
    return data;
  } catch (err) {
    logger.error('costTracker: unexpected error', { leadId, error: err.message });
    return null;
  }
}

async function trackLLMCost({ leadId, brandId, model = 'gemini', inputTokens = 0, outputTokens = 0, metadata = {} }) {
  const pricing = LLM_PRICING[model] || LLM_PRICING.gemini;
  const amountUsd = (inputTokens * pricing.input) + (outputTokens * pricing.output);

  return trackCost({
    leadId,
    brandId,
    source: 'llm_tokens',
    amountUsd,
    metadata: {
      ...metadata,
      model,
      inputTokens,
      outputTokens,
      pricing: model,
    },
  });
}

async function trackApifyCost({ leadId, brandId, metadata = {} }) {
  return trackCost({
    leadId,
    brandId,
    source: 'apify',
    amountUsd: FIXED_COSTS.apify,
    metadata,
  });
}

async function trackScraplingCost({ leadId, brandId, metadata = {} }) {
  return trackCost({
    leadId,
    brandId,
    source: 'scrapling',
    amountUsd: FIXED_COSTS.scrapling,
    metadata,
  });
}

async function trackSmtpCost({ leadId, brandId, metadata = {} }) {
  return trackCost({
    leadId,
    brandId,
    source: 'smtp',
    amountUsd: FIXED_COSTS.smtp,
    metadata,
  });
}

export {
  trackCost,
  trackLLMCost,
  trackApifyCost,
  trackScraplingCost,
  trackSmtpCost,
  LLM_PRICING,
  FIXED_COSTS,
};
