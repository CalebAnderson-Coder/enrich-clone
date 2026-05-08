import { supabase } from './supabase.js';
import { logger as rootLogger } from './logger.js';

const log = rootLogger.child({ module: 'costTracker' });

const VALID_SOURCES = new Set(['llm_tokens', 'apify', 'scrapling', 'smtp']);

export async function trackCost({
  leadId = null,
  brandId,
  source,
  amountUsd,
  metadata = {},
} = {}) {
  if (!supabase) {
    log.warn('trackCost skip: supabase not configured');
    return null;
  }

  if (!brandId) {
    log.warn('trackCost skip: brandId required');
    return null;
  }

  if (!VALID_SOURCES.has(source)) {
    log.warn('trackCost skip: invalid source', { source });
    return null;
  }

  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    log.warn('trackCost skip: invalid amountUsd', { amountUsd });
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('lead_costs')
      .insert({
        lead_id: leadId,
        brand_id: brandId,
        source,
        amount_usd: amountUsd,
        metadata: metadata || {},
      })
      .select()
      .single();

    if (error) {
      log.warn('trackCost insert error', { error: error.message });
      return null;
    }

    return data;
  } catch (err) {
    log.warn('trackCost threw', { error: err?.message });
    return null;
  }
}

export async function getMonthlyStats(brandId) {
  if (!supabase) return { totalCost: 0, count: 0, bySource: {} };

  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startIso = startOfMonth.toISOString();

    const { data, error } = await supabase
      .from('lead_costs')
      .select('source, amount_usd, lead_id')
      .eq('brand_id', brandId)
      .gte('occurred_at', startIso);

    if (error) {
      log.warn('getMonthlyStats query error', { error: error.message });
      return { totalCost: 0, count: 0, bySource: {} };
    }

    if (!data || data.length === 0) {
      return { totalCost: 0, count: 0, bySource: {} };
    }

    const bySource = {};
    let totalCost = 0;
    const uniqueLeads = new Set();

    for (const row of data) {
      totalCost += Number(row.amount_usd || 0);
      if (row.lead_id) uniqueLeads.add(row.lead_id);

      if (!bySource[row.source]) {
        bySource[row.source] = 0;
      }
      bySource[row.source] += Number(row.amount_usd || 0);
    }

    return {
      totalCost: +totalCost.toFixed(2),
      uniqueLeads: uniqueLeads.size,
      count: data.length,
      bySource: Object.fromEntries(
        Object.entries(bySource).map(([k, v]) => [k, +v.toFixed(2)])
      ),
    };
  } catch (err) {
    log.warn('getMonthlyStats threw', { error: err?.message });
    return { totalCost: 0, count: 0, bySource: {} };
  }
}

export async function getAverageCostPerLead(brandId, daysBack = 30) {
  if (!supabase) return 0;

  try {
    const since = new Date(Date.now() - daysBack * 24 * 3600000).toISOString();

    const { data, error } = await supabase
      .from('lead_costs')
      .select('amount_usd, lead_id')
      .eq('brand_id', brandId)
      .gte('occurred_at', since);

    if (error || !data) return 0;

    if (data.length === 0) return 0;

    const totalCost = data.reduce((sum, row) => sum + Number(row.amount_usd || 0), 0);
    const uniqueLeads = new Set(data.map(row => row.lead_id).filter(Boolean));

    if (uniqueLeads.size === 0) return 0;

    return +(totalCost / uniqueLeads.size).toFixed(2);
  } catch (err) {
    log.warn('getAverageCostPerLead threw', { error: err?.message });
    return 0;
  }
}
