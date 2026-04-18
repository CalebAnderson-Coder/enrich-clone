// ============================================================
// tools/outreachEvents.js — Learning-loop event helpers
//
// Sprint 2 central sink for granular outreach telemetry. Every
// touch-point (email sent, pixel open, GHL stage change, webhook
// bounce, landing creation) flows through logOutreachEvent so the
// Scout tool, nightly consolidator, and circuit breaker can mine
// performance patterns per niche × metro × channel.
//
// Design rules:
//   • Silent-fail when Supabase or LEARNING_ENABLED is off — the
//     send loop MUST NEVER be blocked by a missing event write.
//   • Agents and dispatchers call log/get — no schema knowledge
//     leaks out.
// ============================================================

import { Tool } from '../lib/AgentRuntime.js';
import { supabase } from '../lib/supabase.js';
import { logger as rootLogger } from '../lib/logger.js';

const log = rootLogger.child({ module: 'outreachEvents' });

export const LEARNING_ENABLED = () =>
  process.env.LEARNING_ENABLED === 'true';

const VALID_CHANNELS = new Set([
  'email', 'whatsapp', 'sms', 'phone', 'pixel', 'ghl', 'landing',
]);
const VALID_EVENT_TYPES = new Set([
  'sent', 'opened', 'clicked', 'replied', 'bounced', 'read',
  'visited', 'stage_change', 'scroll_50', 'cta_click', 'form_submit',
  'unsubscribed', 'delivered', 'failed',
]);

/**
 * Insert a single outreach event. Never throws — any failure is
 * logged at warn level and returns null so the caller can keep
 * going. When LEARNING_ENABLED !== 'true' this is a no-op.
 *
 * @param {object} params
 * @param {string|null} params.leadId     - leads.id (nullable; e.g. pixel ping before lead resolves)
 * @param {string}     params.brandId    - brands.id (required; rejects silently if missing)
 * @param {string}     params.channel    - one of VALID_CHANNELS
 * @param {string}     params.eventType  - one of VALID_EVENT_TYPES
 * @param {object}     [params.metadata] - free-form jsonb payload
 * @param {string|null}[params.messageId] - SMTP/Resend message-id / GHL contactId / similar
 * @returns {Promise<object|null>} inserted row or null
 */
export async function logOutreachEvent({
  leadId = null,
  brandId,
  channel,
  eventType,
  metadata = {},
  messageId = null,
} = {}) {
  if (!LEARNING_ENABLED()) return null;
  if (!supabase) {
    log.warn('logOutreachEvent skip: supabase not configured');
    return null;
  }
  if (!brandId) {
    log.warn('logOutreachEvent skip: brandId required');
    return null;
  }
  if (!VALID_CHANNELS.has(channel)) {
    log.warn('logOutreachEvent skip: invalid channel', { channel });
    return null;
  }
  if (!VALID_EVENT_TYPES.has(eventType)) {
    log.warn('logOutreachEvent skip: invalid eventType', { eventType });
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('outreach_events')
      .insert({
        lead_id:    leadId,
        brand_id:   brandId,
        channel,
        event_type: eventType,
        metadata:   metadata || {},
        message_id: messageId,
      })
      .select()
      .single();
    if (error) {
      log.warn('logOutreachEvent insert error', { error: error.message });
      return null;
    }
    return data;
  } catch (err) {
    log.warn('logOutreachEvent threw', { error: err?.message });
    return null;
  }
}

/**
 * Fetch recent outreach events with optional filters. Silent-fail
 * returns an empty array.
 */
export async function getRecentEvents(
  { brandId, leadId, channel, eventType, sinceHours } = {},
  limit = 50,
) {
  if (!supabase) return [];
  try {
    let q = supabase
      .from('outreach_events')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (brandId)   q = q.eq('brand_id', brandId);
    if (leadId)    q = q.eq('lead_id', leadId);
    if (channel)   q = q.eq('channel', channel);
    if (eventType) q = q.eq('event_type', eventType);
    if (Number.isFinite(sinceHours)) {
      const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();
      q = q.gte('occurred_at', since);
    }

    const { data, error } = await q;
    if (error) {
      log.warn('getRecentEvents error', { error: error.message });
      return [];
    }
    return data || [];
  } catch (err) {
    log.warn('getRecentEvents threw', { error: err?.message });
    return [];
  }
}

/**
 * Aggregate send/open/click/reply/bounce counts and rates for a
 * (niche, metro, channel) slice over a window. Joins leads to
 * filter by industry/metro_area (ILIKE, both optional).
 *
 * Returns:
 *   { sends, opens, clicks, replies, bounces,
 *     open_rate, click_rate, reply_rate, bounce_rate,
 *     sample_size, low_confidence }
 *
 * Silent-fail returns zero-value shape so the Scout tool can still
 * parse JSON and fall back to default GATE thresholds.
 *
 * Allows an injected `client` for tests.
 */
export async function getHistoricalPerformance({
  niche,
  metro,
  channel = 'email',
  windowDays = 30,
  client,
} = {}) {
  const emptyShape = {
    sends: 0, opens: 0, clicks: 0, replies: 0, bounces: 0,
    open_rate: 0, click_rate: 0, reply_rate: 0, bounce_rate: 0,
    sample_size: 0, low_confidence: true,
  };

  const db = client || supabase;
  if (!db) return emptyShape;

  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  try {
    // We pull rows joined with leads(industry, metro_area) so we can
    // filter on a per-tenant slice. Supabase JS supports inner joins
    // via `leads!inner(...)` — same pattern the dispatcher uses.
    let q = db
      .from('outreach_events')
      .select('id, event_type, leads!inner(industry, metro_area)', { count: 'exact' })
      .eq('channel', channel)
      .gte('occurred_at', since);

    if (niche) q = q.ilike('leads.industry', `%${niche}%`);
    if (metro) q = q.ilike('leads.metro_area', `%${metro}%`);

    const { data, error } = await q;
    if (error) {
      log.warn('getHistoricalPerformance query error', { error: error.message });
      return emptyShape;
    }

    const buckets = {
      sent: 0, opened: 0, clicked: 0, replied: 0,
      bounced: 0, failed: 0,
    };
    for (const row of data || []) {
      if (Object.prototype.hasOwnProperty.call(buckets, row.event_type)) {
        buckets[row.event_type]++;
      }
    }

    const sends   = buckets.sent;
    const opens   = buckets.opened;
    const clicks  = buckets.clicked;
    const replies = buckets.replied;
    const bounces = buckets.bounced + buckets.failed;

    const rate = (num, den) => (den > 0 ? +(num / den).toFixed(4) : 0);
    const sampleSize = sends;

    return {
      sends,
      opens,
      clicks,
      replies,
      bounces,
      open_rate:   rate(opens, sends),
      click_rate:  rate(clicks, sends),
      reply_rate:  rate(replies, sends),
      bounce_rate: rate(bounces, sends + bounces),
      sample_size: sampleSize,
      low_confidence: sampleSize < 10,
    };
  } catch (err) {
    log.warn('getHistoricalPerformance threw', { error: err?.message });
    return emptyShape;
  }
}

// ── Tool wrapper for Scout ────────────────────────────────────
export const getHistoricalPerformanceTool = new Tool({
  name: 'get_historical_performance',
  description:
    'Consulta métricas históricas de outreach para el niche+metro+channel solicitado. ' +
    'DEBE usarse antes de scrape_google_maps para decidir si endurecer GATEs cuando reply_rate<2%. ' +
    'Devuelve { sends, opens, clicks, replies, bounces, open_rate, click_rate, reply_rate, bounce_rate, sample_size, low_confidence }.',
  parameters: {
    type: 'object',
    properties: {
      niche:       { type: 'string', description: 'Industria / nicho (ILIKE, ej. "roofing")' },
      metro:       { type: 'string', description: 'Metro area (ILIKE, ej. "Houston")' },
      channel:     { type: 'string', description: 'email|whatsapp|sms|phone|pixel|ghl|landing. Default email.' },
      window_days: { type: 'number', description: 'Ventana en días. Default 30.' },
    },
    required: [],
  },
  fn: async (args = {}) => {
    try {
      const res = await getHistoricalPerformance({
        niche:      args.niche,
        metro:      args.metro,
        channel:    args.channel || 'email',
        windowDays: Number.isFinite(args.window_days) ? args.window_days : 30,
      });
      return JSON.stringify(res);
    } catch (err) {
      return JSON.stringify({ error: err?.message || String(err) });
    }
  },
});
