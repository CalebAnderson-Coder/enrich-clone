import { createClient } from '@supabase/supabase-js';
import { logger } from './logger.js';

let supabaseInstance;

function getSupabase() {
  if (!supabaseInstance) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    }
    supabaseInstance = createClient(url, key, { auth: { persistSession: false } });
  }
  return supabaseInstance;
}

export async function trackCost({
  lead_id,
  brand_id,
  source,
  amount_usd,
  metadata = {},
}) {
  if (!lead_id || !brand_id || !source || amount_usd === undefined || amount_usd === null) {
    logger.warn('costTracker: missing required fields', {
      lead_id,
      brand_id,
      source,
      amount_usd,
    });
    return { success: false, reason: 'missing_fields' };
  }

  if (amount_usd < 0) {
    logger.warn('costTracker: negative amount', { lead_id, amount_usd });
    return { success: false, reason: 'negative_amount' };
  }

  try {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('lead_costs')
      .insert({
        lead_id,
        brand_id,
        source,
        amount_usd: parseFloat(amount_usd.toFixed(6)),
        occurred_at: new Date().toISOString(),
        metadata,
      })
      .select('id')
      .single();

    if (error) {
      logger.error('costTracker: insert failed', {
        lead_id,
        error: error.message,
      });
      return { success: false, reason: 'insert_failed', error: error.message };
    }

    logger.info('costTracker: cost tracked', {
      cost_id: data?.id,
      lead_id,
      source,
      amount_usd,
    });

    return { success: true, cost_id: data?.id };
  } catch (err) {
    logger.error('costTracker: unexpected error', {
      lead_id,
      error: err.message,
    });
    return { success: false, reason: 'unexpected_error', error: err.message };
  }
}

export async function getLeadTotalCost(lead_id, brand_id, days = 30) {
  try {
    const supabase = getSupabase();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const { data, error } = await supabase
      .from('lead_costs')
      .select('amount_usd')
      .eq('lead_id', lead_id)
      .eq('brand_id', brand_id)
      .gte('occurred_at', cutoffDate.toISOString());

    if (error) {
      logger.warn('costTracker: failed to fetch lead costs', {
        lead_id,
        error: error.message,
      });
      return 0;
    }

    return (data || []).reduce((sum, row) => sum + parseFloat(row.amount_usd || 0), 0);
  } catch (err) {
    logger.error('costTracker: error calculating total', { error: err.message });
    return 0;
  }
}

export async function getBrandCostMetrics(brand_id, days = 30) {
  try {
    const supabase = getSupabase();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const { data, error } = await supabase
      .from('lead_costs')
      .select('lead_id, amount_usd')
      .eq('brand_id', brand_id)
      .gte('occurred_at', cutoffDate.toISOString());

    if (error) {
      logger.warn('costTracker: failed to fetch brand costs', {
        brand_id,
        error: error.message,
      });
      return { total_usd: 0, avg_per_lead: 0, unique_leads: 0 };
    }

    const costs = data || [];
    const totalCost = costs.reduce((sum, row) => sum + parseFloat(row.amount_usd || 0), 0);
    const uniqueLeads = new Set(costs.map(c => c.lead_id)).size;
    const avgPerLead = uniqueLeads > 0 ? totalCost / uniqueLeads : 0;

    return {
      total_usd: parseFloat(totalCost.toFixed(2)),
      avg_per_lead: parseFloat(avgPerLead.toFixed(2)),
      unique_leads: uniqueLeads,
    };
  } catch (err) {
    logger.error('costTracker: error calculating brand metrics', { error: err.message });
    return { total_usd: 0, avg_per_lead: 0, unique_leads: 0 };
  }
}
