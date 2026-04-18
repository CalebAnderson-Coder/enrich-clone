// ============================================================
// lib/guardrails.js — Autonomous-send guardrails
//
// Gatekeeper between "drafts ready" and "bytes on the wire".
// The autonomous dispatcher (outreach_dispatcher.js) calls
// assertSendAllowed({ brandId }) before every send batch. If any
// quota is breached, the guard throws `SEND_GUARDRAIL_BLOCKED` and
// the caller must halt.
//
// Secondary job: the circuit breaker persists a manager memory
// note when bounce_rate spikes, so the Manager can hear about
// the pause in the next 23h REPORTE cycle.
// ============================================================

import { supabase } from './supabase.js';
import { saveAgentMemory } from './supabase.js';
import { logger as rootLogger } from './logger.js';

const log = rootLogger.child({ module: 'guardrails' });

// ── Env knobs (documented in docs/autonomy.md) ───────────────
function num(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) ? n : dflt;
}

export function getEnvCaps() {
  return {
    MAX_SENDS_PER_HOUR:          num('MAX_SENDS_PER_HOUR', 30),
    MAX_LEADS_PER_DAY_PER_BRAND: num('MAX_LEADS_PER_DAY_PER_BRAND', 50),
    BOUNCE_RATE_CIRCUIT_BREAKER: num('BOUNCE_RATE_CIRCUIT_BREAKER', 0.05),
  };
}

// ── Counters (Supabase, with graceful fallback) ──────────────

/**
 * Count dispatched outreach in the last hour for a brand.
 * Uses campaign_enriched_data.outreach_status transitions because the
 * dedicated outreach_events table does not exist yet (planned for S5).
 */
export async function getSentLastHour(brandId) {
  if (!supabase || !brandId) return 0;

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  try {
    const { count, error } = await supabase
      .from('campaign_enriched_data')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .in('outreach_status', ['APPROVED', 'SENT', 'CONTACTED'])
      .gte('updated_at', since);
    if (error) {
      log.warn('getSentLastHour query error', { error: error.message });
      return 0;
    }
    return count || 0;
  } catch (err) {
    log.warn('getSentLastHour threw', { error: err?.message });
    return 0;
  }
}

/** Count dispatched outreach since UTC midnight for a brand. */
export async function getSentToday(brandId) {
  if (!supabase || !brandId) return 0;

  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const since = d.toISOString();

  try {
    const { count, error } = await supabase
      .from('campaign_enriched_data')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .in('outreach_status', ['APPROVED', 'SENT', 'CONTACTED'])
      .gte('updated_at', since);
    if (error) {
      log.warn('getSentToday query error', { error: error.message });
      return 0;
    }
    return count || 0;
  } catch (err) {
    log.warn('getSentToday threw', { error: err?.message });
    return 0;
  }
}

/**
 * Bounce rate over the last 24h for a brand. When a dedicated
 * outreach_events table lands (S5), wire it here; until then we
 * return 0 so autonomy does not trip on missing-table errors.
 */
export async function getBounceRateLast24h(brandId) {
  if (!supabase || !brandId) return 0;

  try {
    // Probe the (optional) outreach_events table. If it does not exist
    // the query will fail and we gracefully return 0.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const totalRes = await supabase
      .from('outreach_events')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('created_at', since);

    if (totalRes.error) {
      // Missing table / column — fall back silently.
      return 0;
    }

    const bounceRes = await supabase
      .from('outreach_events')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('event_type', 'bounce')
      .gte('created_at', since);

    const total  = totalRes.count || 0;
    const bounce = bounceRes.count || 0;
    if (total === 0) return 0;
    return bounce / total;
  } catch {
    return 0;
  }
}

// ── Per-brand caps override via brand_quota (optional) ───────
async function getBrandCaps(brandId) {
  if (!supabase || !brandId) return null;
  try {
    const { data, error } = await supabase
      .from('brand_quota')
      .select('daily_cap, hourly_cap')
      .eq('brand_id', brandId)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

// ── Main gate ────────────────────────────────────────────────

export class GuardrailBlocked extends Error {
  constructor(reason, details = {}) {
    super(`SEND_GUARDRAIL_BLOCKED: ${reason}`);
    this.name    = 'GuardrailBlocked';
    this.code    = 'SEND_GUARDRAIL_BLOCKED';
    this.reason  = reason;
    this.details = details;
  }
}

/**
 * Throws GuardrailBlocked if any quota is breached. Callers must
 * catch and stop the send loop. Silent (no-throw) on success.
 */
export async function assertSendAllowed({ brandId }) {
  if (!brandId) return; // single-tenant legacy mode → no gate

  const caps   = getEnvCaps();
  const perBrand = await getBrandCaps(brandId);
  const dailyCap  = perBrand?.daily_cap  ?? caps.MAX_LEADS_PER_DAY_PER_BRAND;
  const hourlyCap = perBrand?.hourly_cap ?? caps.MAX_SENDS_PER_HOUR;

  const [sentToday, sentHour, bounce] = await Promise.all([
    getSentToday(brandId),
    getSentLastHour(brandId),
    getBounceRateLast24h(brandId),
  ]);

  if (bounce > caps.BOUNCE_RATE_CIRCUIT_BREAKER) {
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    try {
      await saveAgentMemory('manager', brandId,
        `[MANAGER_BLOCKED] bounce_rate_high ${ymd}`,
        JSON.stringify({ bounce_rate: bounce, threshold: caps.BOUNCE_RATE_CIRCUIT_BREAKER })
      );
    } catch {/* swallow */}
    throw new GuardrailBlocked('bounce_rate_circuit_breaker', {
      bounce_rate: bounce,
      threshold:   caps.BOUNCE_RATE_CIRCUIT_BREAKER,
    });
  }

  if (sentToday >= dailyCap) {
    throw new GuardrailBlocked('daily_cap_reached', {
      sent_today: sentToday, daily_cap: dailyCap,
    });
  }

  if (sentHour >= hourlyCap) {
    throw new GuardrailBlocked('hourly_cap_reached', {
      sent_last_hour: sentHour, hourly_cap: hourlyCap,
    });
  }
}
