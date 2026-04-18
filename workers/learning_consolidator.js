// ============================================================
// workers/learning_consolidator.js — Nightly learning-loop digest
//
// Called from agents/manager-daemon.js REPORTE cycle (UTC 23:00).
// Aggregates outreach_events for the brand over the last N days,
// computes top/bottom (niche × metro) combos by reply_rate, and
// persists the digest as agent_memory under:
//   [FLEET_LESSONS_YYYYMMDD]  (parent summary, JSON body)
//   [LEARN][manager][top_combos][YYYYMMDD]
//   [LEARN][manager][bottom_combos][YYYYMMDD]
//
// Silent-fail: when LEARNING_ENABLED=false or outreach_events is
// missing/empty, returns { ok: true, top: [], bottom: [], samples: 0 }
// without touching agent_memory.
// ============================================================

import { supabase, saveAgentMemory } from '../lib/supabase.js';
import { logger as rootLogger } from '../lib/logger.js';

const log = rootLogger.child({ module: 'learning_consolidator' });

const LEARNING_ENABLED = () => process.env.LEARNING_ENABLED === 'true';

function ymdUtc(d = new Date()) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Normalize metadata/leads join shape so we can bucket events by
 * (niche, metro). We default to "unknown" when either dim is absent.
 */
function combinationKey(niche, metro) {
  const n = (niche || 'unknown').trim().toLowerCase();
  const m = (metro || 'unknown').trim().toLowerCase();
  return `${n}::${m}`;
}

/**
 * Pure function — given a flat list of events with
 * { event_type, niche, metro }, returns aggregated combos.
 * Exposed for tests.
 */
export function aggregateCombos(events) {
  const buckets = new Map();
  for (const ev of events || []) {
    const key = combinationKey(ev.niche, ev.metro);
    const b = buckets.get(key) || {
      niche: ev.niche || 'unknown',
      metro: ev.metro || 'unknown',
      sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0,
    };
    if (ev.event_type === 'sent')    b.sent++;
    if (ev.event_type === 'opened')  b.opened++;
    if (ev.event_type === 'clicked') b.clicked++;
    if (ev.event_type === 'replied') b.replied++;
    if (ev.event_type === 'bounced' || ev.event_type === 'failed') b.bounced++;
    buckets.set(key, b);
  }
  const combos = Array.from(buckets.values()).map(b => {
    const rate = (num, den) => (den > 0 ? +(num / den).toFixed(4) : 0);
    return {
      ...b,
      open_rate:   rate(b.opened,  b.sent),
      click_rate:  rate(b.clicked, b.sent),
      reply_rate:  rate(b.replied, b.sent),
      bounce_rate: rate(b.bounced, b.sent + b.bounced),
      sample_size: b.sent,
    };
  });
  return combos;
}

/**
 * Main entry — called from manager-daemon REPORTE cycle.
 *
 * @param {object} opts
 * @param {string} opts.brandId
 * @param {number} [opts.windowDays=7]
 * @param {object} [opts.client] — injectable Supabase client for tests
 * @param {function} [opts.saveMemoryFn] — injectable save function for tests
 */
export async function runConsolidator({
  brandId,
  windowDays = 7,
  client,
  saveMemoryFn = saveAgentMemory,
} = {}) {
  if (!LEARNING_ENABLED()) {
    return { ok: true, skipped: 'learning_disabled', top: [], bottom: [], samples: 0 };
  }
  if (!brandId) {
    return { ok: false, error: 'brandId required' };
  }

  const db = client || supabase;
  if (!db) return { ok: true, skipped: 'no_supabase', top: [], bottom: [], samples: 0 };

  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  let events;
  try {
    const { data, error } = await db
      .from('outreach_events')
      .select('event_type, occurred_at, leads(industry, metro_area)')
      .eq('brand_id', brandId)
      .gte('occurred_at', since);
    if (error) {
      log.warn('consolidator query error', { error: error.message });
      return { ok: true, skipped: 'query_error', top: [], bottom: [], samples: 0 };
    }
    events = data || [];
  } catch (err) {
    log.warn('consolidator threw', { error: err?.message });
    return { ok: true, skipped: 'threw', top: [], bottom: [], samples: 0 };
  }

  const flat = events.map(e => ({
    event_type: e.event_type,
    niche: e.leads?.industry || null,
    metro: e.leads?.metro_area || null,
  }));
  const combos = aggregateCombos(flat);
  const withSends = combos.filter(c => c.sent >= 3); // floor to de-noise

  // Top by reply_rate, bottom by reply_rate (requires sends>=3).
  const top    = [...withSends].sort((a, b) => b.reply_rate - a.reply_rate).slice(0, 5);
  const bottom = [...withSends].sort((a, b) => a.reply_rate - b.reply_rate).slice(0, 5);

  const ymd = ymdUtc();
  const digest = {
    generated_at: new Date().toISOString(),
    brand_id: brandId,
    window_days: windowDays,
    total_events: flat.length,
    combos_evaluated: withSends.length,
    top,
    bottom,
  };

  // Persist under three keys — JSON body shared.
  try {
    await saveMemoryFn('manager', brandId, `[FLEET_LESSONS_${ymd}]`, JSON.stringify(digest));
    await saveMemoryFn('manager', brandId, `[LEARN][manager][top_combos][${ymd}]`, JSON.stringify(top));
    await saveMemoryFn('manager', brandId, `[LEARN][manager][bottom_combos][${ymd}]`, JSON.stringify(bottom));
  } catch (err) {
    log.warn('saveAgentMemory failed', { error: err?.message });
  }

  return { ok: true, top, bottom, samples: flat.length, ymd };
}
