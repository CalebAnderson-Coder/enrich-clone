import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

const LLM_PRICING = {
  'nvidia/meta-llama-3.1-70b-instruct': {
    input_per_million: 0.6,
    output_per_million: 1.8,
  },
  'google/gemini-flash': {
    input_per_million: 0.075,
    output_per_million: 0.3,
  },
  default: {
    input_per_million: 0.5,
    output_per_million: 1.5,
  },
};

export class CostTracker {
  constructor(supabaseClient = null) {
    this.supabase = supabaseClient || createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }

  async trackCost({ lead_id, brand_id, source, amount_usd, metadata = {} }) {
    if (!lead_id || !brand_id || !source || !amount_usd) {
      logger.warn('costTracker: missing required fields', { lead_id, brand_id, source, amount_usd });
      return null;
    }

    const costRecord = {
      lead_id,
      brand_id,
      source,
      amount_usd: parseFloat(amount_usd),
      metadata,
      occurred_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from('lead_costs')
      .insert([costRecord])
      .select('id');

    if (error) {
      logger.error('costTracker: insert failed', {
        lead_id,
        source,
        amount_usd,
        err: error.message,
      });
      return null;
    }

    logger.debug('costTracker: cost tracked', {
      cost_id: data?.[0]?.id,
      lead_id,
      source,
      amount_usd,
    });

    return data?.[0]?.id;
  }

  calculateLLMCost(inputTokens, outputTokens, model = 'default') {
    const pricing = LLM_PRICING[model] || LLM_PRICING.default;

    const inputCost = (inputTokens / 1_000_000) * pricing.input_per_million;
    const outputCost = (outputTokens / 1_000_000) * pricing.output_per_million;

    return inputCost + outputCost;
  }

  async trackLLMCost(lead_id, brand_id, inputTokens, outputTokens, model = 'default', metadata = {}) {
    const amount = this.calculateLLMCost(inputTokens, outputTokens, model);
    return this.trackCost({
      lead_id,
      brand_id,
      source: 'llm_tokens',
      amount_usd: amount,
      metadata: {
        ...metadata,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        model,
      },
    });
  }

  async trackSmtpCost(lead_id, brand_id, metadata = {}) {
    const SMTP_COST = parseFloat(process.env.SMTP_COST_PER_EMAIL || '0.001');
    return this.trackCost({
      lead_id,
      brand_id,
      source: 'smtp',
      amount_usd: SMTP_COST,
      metadata,
    });
  }

  async trackSourceCost(lead_id, brand_id, source, amount_usd, metadata = {}) {
    return this.trackCost({
      lead_id,
      brand_id,
      source,
      amount_usd,
      metadata,
    });
  }

  async getMonthlyCostSummary(brand_id) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const { data: costs, error } = await this.supabase
      .from('lead_costs')
      .select('amount_usd, lead_id')
      .eq('brand_id', brand_id)
      .gte('occurred_at', monthStart.toISOString());

    if (error) {
      logger.error('costTracker: monthly summary query failed', { brand_id, err: error.message });
      return { total_usd: 0, avg_per_lead: 0, lead_count: 0 };
    }

    const costs_array = costs || [];
    const totalCost = costs_array.reduce((sum, c) => sum + parseFloat(c.amount_usd || 0), 0);
    const uniqueLeads = new Set(costs_array.map(c => c.lead_id));
    const leadCount = uniqueLeads.size;

    return {
      total_usd: totalCost,
      avg_per_lead: leadCount > 0 ? totalCost / leadCount : 0,
      lead_count: leadCount,
    };
  }

  async getCostsBySource(brand_id, daysBack = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    const { data: costs, error } = await this.supabase
      .from('lead_costs')
      .select('source, amount_usd')
      .eq('brand_id', brand_id)
      .gte('occurred_at', cutoffDate.toISOString());

    if (error) {
      logger.error('costTracker: costs by source query failed', { brand_id, daysBack, err: error.message });
      return {};
    }

    const bySource = {};
    (costs || []).forEach(c => {
      if (!bySource[c.source]) {
        bySource[c.source] = 0;
      }
      bySource[c.source] += parseFloat(c.amount_usd || 0);
    });

    return bySource;
  }
}

export const costTracker = new CostTracker();
