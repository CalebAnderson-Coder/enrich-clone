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

// Status buckets used by the bounce-rate circuit breaker.
// NOTE: the dispatcher does NOT yet stamp these delivery-failure
// statuses on campaign_enriched_data — they arrive when the S5
// outreach_events pipeline lands and back-populates this column (or
// when SMTP/Resend error handling is extended to persist failures).
// Until then the query still runs safely: `bounced` will simply be
// 0 and the breaker remains inactive.
const BOUNCED_STATUSES = ['BOUNCED', 'SEND_FAIL', 'SMTP_ERROR', 'DELIVERY_FAILED'];
const SENT_OR_BOUNCED_STATUSES = ['SENT', 'CONTACTED', ...BOUNCED_STATUSES];

/**
 * Bounce rate over the last 24h for a brand.
 *
 * Sprint 2 two-tier strategy:
 *   1) Primary: `outreach_events` (channel='email', event_type IN
 *      ('bounced','failed') vs ('sent')). Used when sample_size
 *      (= sends + bounces) >= 5 so a single stray event cannot
 *      trip the breaker.
 *   2) Fallback: `campaign_enriched_data.outreach_status` buckets,
 *      same math as before. Keeps the breaker warm on older rows
 *      when outreach_events is empty or LEARNING_ENABLED=false.
 *   3) Both miss → 0 (breaker inactive).
 */
export async function getBounceRateLast24h(brandId, { client } = {}) {
  const db = client || supabase;
  if (!db || !brandId) return 0;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const threshold = num('BOUNCE_RATE_CIRCUIT_BREAKER', 0.05);

  // ── Tier 1: outreach_events (preferred) ──────────────────
  try {
    const [eventBouncedRes, eventSentRes] = await Promise.all([
      db
        .from('outreach_events')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .eq('channel', 'email')
        .in('event_type', ['bounced', 'failed'])
        .gte('occurred_at', since),
      db
        .from('outreach_events')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .eq('channel', 'email')
        .eq('event_type', 'sent')
        .gte('occurred_at', since),
    ]);

    if (!eventBouncedRes.error && !eventSentRes.error) {
      const evBounced = eventBouncedRes.count || 0;
      const evSent    = eventSentRes.count    || 0;
      const evSample  = evBounced + evSent;
      if (evSample >= 5) {
        const rate = evSample > 0 ? evBounced / evSample : 0;
        if (rate > threshold) {
          log.warn('bounce rate breach (events)', { brandId, rate, bounced: evBounced, total: evSample, threshold });
        }
        return rate;
      }
    }
  } catch {
    // fall through to tier 2
  }

  // ── Tier 2: campaign_enriched_data.outreach_status ───────
  try {
    const [bouncedRes, totalRes] = await Promise.all([
      db
        .from('campaign_enriched_data')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .in('outreach_status', BOUNCED_STATUSES)
        .gte('updated_at', since),
      db
        .from('campaign_enriched_data')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .in('outreach_status', SENT_OR_BOUNCED_STATUSES)
        .gte('updated_at', since),
    ]);

    if (bouncedRes.error || totalRes.error) {
      // Missing column / permissions — fall back silently.
      return 0;
    }

    const bounced = bouncedRes.count || 0;
    const total   = totalRes.count   || 0;
    if (total === 0) return 0;
    const rate = bounced / total;

    if (rate > threshold) {
      log.warn('bounce rate breach (status)', { brandId, rate, bounced, total, threshold });
    }
    return rate;
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
