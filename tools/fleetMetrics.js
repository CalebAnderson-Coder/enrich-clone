// ============================================================
// tools/fleetMetrics.js — Análisis interno de métricas del fleet
//
// Power tool del agente Estratega. Agrega outreach_events + agent_events
// + campaign_enriched_data + leads sobre una ventana (7d/30d/90d) y
// devuelve un shape normalizado con:
//   - funnel:            prospected → HOT → enriched → sent → opened → replied
//   - by_channel:        open/reply/bounce rate por canal
//   - top_niches:        top 5 por reply_rate (sample >= 10)
//   - top_metros:        top 5 por reply_rate (sample >= 10)
//   - bottom_combos:     bottom 3 niche×metro con reply_rate < 1%
//   - agent_errors:      patrones de error por (agent, event_type)
//   - cost_per_reply:    proxy sends × 0.001 / replies
//
// Silent-fail: si Supabase no está disponible o no hay data suficiente
// devolvemos shape con low_confidence=true y todos los ratios en 0.
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';
import { supabase as defaultSupabase } from '../lib/supabase.js';
import { logger as rootLogger } from '../lib/logger.js';

const log = rootLogger.child({ module: 'fleetMetrics' });

const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

function sinceIso(period) {
  const days = PERIOD_DAYS[period] || 7;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function emptyShape(period, reason) {
  return {
    generated_at: new Date().toISOString(),
    period,
    low_confidence: true,
    reason: reason || null,
    funnel: {
      prospected: 0, hot: 0, enriched: 0, sent: 0, opened: 0, replied: 0,
    },
    by_channel: {},
    top_niches: [],
    top_metros: [],
    bottom_combos: [],
    agent_errors: [],
    cost_per_reply: null,
  };
}

function rate(num, den) {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
  return +(num / den).toFixed(4);
}

/**
 * Parametrized queries — nunca string-concat.
 */
export async function analyzeFleetMetrics({
  brandId,
  period = '7d',
  client,
} = {}) {
  if (!brandId) return emptyShape(period, 'missing_brand_id');
  if (!PERIOD_DAYS[period]) return emptyShape(period, 'invalid_period');

  const db = client || defaultSupabase;
  if (!db) return emptyShape(period, 'no_supabase');

  const since = sinceIso(period);

  // ── Funnel counts (leads) ──────────────────────────────────
  let prospected = 0, hot = 0;
  try {
    const { count: c1 } = await db
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('created_at', since);
    prospected = Number.isFinite(c1) ? c1 : 0;

    const { count: c2 } = await db
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('lead_tier', 'HOT')
      .gte('created_at', since);
    hot = Number.isFinite(c2) ? c2 : 0;
  } catch (err) {
    log.warn('leads funnel query failed', { error: err?.message });
  }

  // ── Enriched CED in window ─────────────────────────────────
  let enriched = 0;
  try {
    const { count } = await db
      .from('campaign_enriched_data')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('created_at', since);
    enriched = Number.isFinite(count) ? count : 0;
  } catch (err) {
    log.warn('CED count query failed', { error: err?.message });
  }

  // ── Outreach events in window (single fetch, bucket locally) ──
  let events = [];
  try {
    const { data, error } = await db
      .from('outreach_events')
      .select('event_type, channel, occurred_at, leads(industry, metro_area)')
      .eq('brand_id', brandId)
      .gte('occurred_at', since)
      .limit(10000);
    if (!error) events = data || [];
  } catch (err) {
    log.warn('outreach_events query failed', { error: err?.message });
  }

  // Funnel: sent / opened / replied from outreach_events (channel=email primarily)
  let sent = 0, opened = 0, replied = 0;
  const channelBuckets = new Map(); // channel → {sent,opened,replied,bounced}
  const comboBuckets = new Map();   // niche::metro → {sent,replied,niche,metro}
  const nicheBuckets = new Map();   // niche → {sent,replied}
  const metroBuckets = new Map();   // metro → {sent,replied}

  for (const ev of events) {
    const et = ev.event_type;
    const ch = ev.channel || 'unknown';
    const niche = (ev.leads?.industry || 'unknown').toLowerCase();
    const metro = (ev.leads?.metro_area || 'unknown').toLowerCase();

    if (et === 'sent')    sent++;
    if (et === 'opened')  opened++;
    if (et === 'replied') replied++;

    const chb = channelBuckets.get(ch) || { sent: 0, opened: 0, replied: 0, bounced: 0 };
    if (et === 'sent')    chb.sent++;
    if (et === 'opened')  chb.opened++;
    if (et === 'replied') chb.replied++;
    if (et === 'bounced' || et === 'failed') chb.bounced++;
    channelBuckets.set(ch, chb);

    const ck = `${niche}::${metro}`;
    const cb = comboBuckets.get(ck) || { niche, metro, sent: 0, replied: 0 };
    if (et === 'sent')    cb.sent++;
    if (et === 'replied') cb.replied++;
    comboBuckets.set(ck, cb);

    const nb = nicheBuckets.get(niche) || { niche, sent: 0, replied: 0 };
    if (et === 'sent')    nb.sent++;
    if (et === 'replied') nb.replied++;
    nicheBuckets.set(niche, nb);

    const mb = metroBuckets.get(metro) || { metro, sent: 0, replied: 0 };
    if (et === 'sent')    mb.sent++;
    if (et === 'replied') mb.replied++;
    metroBuckets.set(metro, mb);
  }

  const by_channel = {};
  for (const [ch, b] of channelBuckets.entries()) {
    by_channel[ch] = {
      sent: b.sent,
      open_rate:   rate(b.opened,  b.sent),
      reply_rate:  rate(b.replied, b.sent),
      bounce_rate: rate(b.bounced, b.sent + b.bounced),
    };
  }

  const top_niches = [...nicheBuckets.values()]
    .filter(x => x.sent >= 10 && x.niche !== 'unknown')
    .map(x => ({ ...x, reply_rate: rate(x.replied, x.sent) }))
    .sort((a, b) => b.reply_rate - a.reply_rate)
    .slice(0, 5);

  const top_metros = [...metroBuckets.values()]
    .filter(x => x.sent >= 10 && x.metro !== 'unknown')
    .map(x => ({ ...x, reply_rate: rate(x.replied, x.sent) }))
    .sort((a, b) => b.reply_rate - a.reply_rate)
    .slice(0, 5);

  const bottom_combos = [...comboBuckets.values()]
    .filter(x => x.sent >= 10)
    .map(x => ({ ...x, reply_rate: rate(x.replied, x.sent) }))
    .filter(x => x.reply_rate < 0.01)
    .sort((a, b) => a.reply_rate - b.reply_rate)
    .slice(0, 3);

  // ── Agent errors (from agent_events) ───────────────────────
  let agent_errors = [];
  try {
    const { data, error } = await db
      .from('agent_events')
      .select('agent, event_type')
      .eq('brand_id', brandId)
      .eq('status', 'error')
      .gte('created_at', since)
      .limit(5000);
    if (!error && data) {
      const errMap = new Map();
      for (const row of data) {
        const k = `${row.agent || 'unknown'}::${row.event_type || 'unknown'}`;
        errMap.set(k, (errMap.get(k) || 0) + 1);
      }
      agent_errors = [...errMap.entries()]
        .map(([k, count]) => {
          const [agent, event_type] = k.split('::');
          return { agent, event_type, count };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }
  } catch (err) {
    log.warn('agent_events query failed', { error: err?.message });
  }

  // ── Cost per reply (proxy: sends × 0.001 / replies) ────────
  const cost_per_reply = replied > 0 ? +((sent * 0.001) / replied).toFixed(4) : null;

  const totalSignal = sent + opened + replied;
  const lowConfidence = totalSignal < 10;

  return {
    generated_at: new Date().toISOString(),
    period,
    low_confidence: lowConfidence,
    funnel: { prospected, hot, enriched, sent, opened, replied },
    by_channel,
    top_niches,
    top_metros,
    bottom_combos,
    agent_errors,
    cost_per_reply,
  };
}

// ── Tool wrapper para que el Agente Estratega lo invoque ─────
export const analyzeFleetMetricsTool = new Tool({
  name: 'analyze_fleet_metrics',
  description: 'Analiza métricas internas del fleet Empírika sobre una ventana (7d/30d/90d). Devuelve funnel, by_channel, top_niches/metros, bottom_combos, agent_errors, cost_per_reply. Si no hay data, devuelve low_confidence=true.',
  parameters: {
    type: 'object',
    properties: {
      period: { type: 'string', enum: ['7d', '30d', '90d'], description: 'Ventana de análisis' },
    },
    required: [],
  },
  fn: async (args, context = {}) => {
    const brandId = context.brand_id || process.env.BRAND_ID;
    const period = args?.period || '7d';
    try {
      const out = await analyzeFleetMetrics({ brandId, period });
      return JSON.stringify(out);
    } catch (err) {
      return JSON.stringify(emptyShape(period, `error: ${err.message}`));
    }
  },
});
