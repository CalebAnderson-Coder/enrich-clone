// ============================================================
// workers/inbox_reply_cron.js — IMAP → outreach_events.replied
//
// Cron (each 5 min via Render schedule) that:
//   1. Fetches inbox replies since the last-seen IMAP UID (or 7d
//      lookback on first run).
//   2. Matches each reply to a prior outreach event via replyMatcher.
//   3. Inserts a new outreach_events row with event_type='replied'
//      (idempotent — deduped on message_id).
//   4. Advances the persisted UID cursor BEFORE logging cycle-done,
//      so a mid-cycle crash never re-processes the whole batch.
//
// Downstream consumers:
//   - dashboard /replies reads event_type='replied'
//   - reply_to_report_cron classifies intent + sends mini-audit PDF
//
// Run modes:
//   node workers/inbox_reply_cron.js            # production cycle
//   node workers/inbox_reply_cron.js --self-check  # boot+1-iter+exit(0)
// ============================================================

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { fetchInboxReplies } from '../lib/inboxReplyFetcher.js';
import { matchReplyToOutreach } from '../lib/replyMatcher.js';
import { logger } from '../lib/logger.js';

// ── Config ───────────────────────────────────────────────────

const BRAND_ID    = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const STATE_KEY   = 'imap_last_uid';
const STATE_AGENT = 'inbox_reply_cron';
const SELF_CHECK  = process.argv.includes('--self-check');

// Bounce / system-mail detection — these are NOT replies. We still track
// them as outreach_events but with event_type='bounced' so the lead can
// be marked invalid downstream and never re-emailed.
const BOUNCE_FROM    = /^(mailer-daemon|postmaster|bounces?|noreply|no-reply|notifications?)@/i;
const BOUNCE_SUBJECT = /(delivery status|undelivered|failure|address not found|no se entregó|returned mail)/i;

function looksLikeBounce(message) {
  const from = (message.from_email || '').toLowerCase();
  const subj = (message.subject    || '').toLowerCase();
  return BOUNCE_FROM.test(from) || BOUNCE_SUBJECT.test(subj);
}

// ── Supabase client ──────────────────────────────────────────

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── UID cursor persistence ───────────────────────────────────

/**
 * Reads the last-seen IMAP UID from agent_state.
 * Returns 0 if not found (triggers 7-day lookback in runCycle).
 * Degrades safely on DB error — logs a warning and returns 0 so
 * the cron re-processes the last 7 days rather than silently skipping.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<number>}
 */
async function readLastUid(supabase) {
  const { data, error } = await supabase
    .from('agent_state')
    .select('value')
    .eq('brand_id',   BRAND_ID)
    .eq('agent_name', STATE_AGENT)
    .eq('key',        STATE_KEY)
    .maybeSingle();

  if (error) {
    logger.warn('inbox_reply_cron: failed to read last UID — defaulting to 0', { err: error.message });
    return 0;
  }

  return Number(data?.value ?? 0);
}

/**
 * Persists the last-seen IMAP UID so the next cycle starts from here.
 * Upserts on the composite unique key (brand_id, agent_name, key).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {number} uid
 */
async function writeLastUid(supabase, uid) {
  const { error } = await supabase
    .from('agent_state')
    .upsert(
      {
        brand_id:   BRAND_ID,
        agent_name: STATE_AGENT,
        key:        STATE_KEY,
        value:      uid,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'brand_id,agent_name,key' },
    );

  if (error) {
    logger.warn('inbox_reply_cron: failed to write last UID', { uid, err: error.message });
  }
}

// ── processOneMessage ────────────────────────────────────────

/**
 * Attempts to match and insert a single inbox message into
 * outreach_events as event_type='replied'.
 *
 * Returns a result object — never throws.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} message  — parsed message from fetchInboxReplies
 * @returns {Promise<{action: string, [key: string]: any}>}
 */
async function processOneMessage(supabase, message) {
  // 0. Bounce detection — categorize as 'bounced' instead of 'replied'.
  //    Real bounces still match by header (the bounce notification
  //    references the original Message-ID), but they're NOT a reply
  //    from the prospect — they're delivery failures.
  const isBounce = looksLikeBounce(message);

  // 1. Match against prior outreach
  const matchResult = await matchReplyToOutreach({
    supabase,
    message,
    brandId: BRAND_ID,
    log:     logger,
  });

  if (!matchResult.matched) {
    logger.info('inbox_reply_cron: unmatched reply', {
      message_id: message.message_id,
      reason:     matchResult.reason,
    });
    return { action: 'unmatched', reason: matchResult.reason };
  }

  const eventType = isBounce ? 'bounced' : 'replied';

  // 2. Idempotency check — skip if already inserted for this message_id
  const { data: existing, error: dupErr } = await supabase
    .from('outreach_events')
    .select('id')
    .eq('brand_id',    BRAND_ID)
    .eq('event_type',  eventType)
    .eq('message_id',  message.message_id)
    .limit(1);

  if (dupErr) {
    logger.warn('inbox_reply_cron: duplicate check failed — skipping insert', {
      message_id: message.message_id,
      err:        dupErr.message,
    });
    return { action: 'insert_failed', error: dupErr.message };
  }

  if (existing && existing.length > 0) {
    logger.info('inbox_reply_cron: duplicate — already inserted', {
      message_id:  message.message_id,
      existing_id: existing[0].id,
    });
    return { action: 'duplicate', existing_id: existing[0].id };
  }

  // 3. Insert new event (replied OR bounced)
  const { data: inserted, error: insertErr } = await supabase
    .from('outreach_events')
    .insert({
      brand_id:    BRAND_ID,
      lead_id:     matchResult.lead_id,
      channel:     'email',
      event_type:  eventType,
      message_id:  message.message_id,
      occurred_at: message.date || new Date().toISOString(),
      metadata: {
        imap_uid:               message.uid,
        in_reply_to:            message.in_reply_to,
        from_email:             message.from_email,
        from_name:              message.from_name,
        subject:                message.subject,
        body:                   message.body_text,
        match_source:           matchResult.source,
        match_confidence:       matchResult.confidence,
        original_sent_event_id: matchResult.original_sent_event_id,
        is_bounce:              isBounce,
      },
    })
    .select('id')
    .single();

  // If this is a bounce, mark the lead so we never email it again.
  if (isBounce && !insertErr) {
    try {
      await supabase
        .from('leads')
        .update({ outreach_status: 'BOUNCED' })
        .eq('id', matchResult.lead_id);
    } catch (e) {
      logger.warn('inbox_reply_cron: failed to mark lead BOUNCED', { lead_id: matchResult.lead_id, err: e.message });
    }
  }

  if (insertErr) {
    logger.error('inbox_reply_cron: insert failed', {
      message_id: message.message_id,
      lead_id:    matchResult.lead_id,
      err:        insertErr.message,
    });
    return { action: 'insert_failed', error: insertErr.message };
  }

  logger.info(`inbox_reply_cron: inserted ${eventType} event`, {
    id:      inserted.id,
    lead_id: matchResult.lead_id,
    source:  matchResult.source,
    is_bounce: isBounce,
  });
  return { action: 'inserted', event_type: eventType, id: inserted.id, lead_id: matchResult.lead_id, source: matchResult.source };
}

// ── runCycle ─────────────────────────────────────────────────

/**
 * One full scan cycle: fetch → match → insert → advance UID cursor.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @returns {Promise<{fetched: number, considered: number, inserted: number, duplicate: number, unmatched: number, insert_failed: number, lastUid: number}>}
 */
async function runCycle(supabase) {
  const lastUid = await readLastUid(supabase);
  logger.info('inbox_reply_cron: cycle start', { lastUid });

  // On first run (uid=0) use a 7-day lookback so we don't miss historical replies
  const sinceDate = lastUid === 0
    ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    : undefined;

  const result = await fetchInboxReplies({
    sinceUid:    lastUid,
    sinceDate,
    limit:       100,
    onlyReplies: true,
    log:         logger,
  });

  logger.info('inbox_reply_cron: fetched messages', {
    total_seen: result.total_seen,
    considered: result.messages.length,
    errors:     result.errors?.length ?? 0,
  });

  // Counters
  let inserted     = 0;
  let bounced      = 0;
  let duplicate    = 0;
  let unmatched    = 0;
  let insert_failed = 0;

  for (const msg of result.messages) {
    const outcome = await processOneMessage(supabase, msg);
    switch (outcome.action) {
      case 'inserted':
        if (outcome.event_type === 'bounced') bounced++;
        else inserted++;
        break;
      case 'duplicate':    duplicate++;     break;
      case 'unmatched':    unmatched++;     break;
      case 'insert_failed': insert_failed++; break;
    }
  }

  // Advance UID cursor BEFORE final log — protects against partial crash re-processing
  if (result.lastUid > lastUid) {
    await writeLastUid(supabase, result.lastUid);
  }

  logger.info('inbox_reply_cron: cycle done', {
    fetched:      result.total_seen,
    considered:   result.messages.length,
    inserted,
    duplicate,
    unmatched,
    insert_failed,
    lastUid:      result.lastUid ?? lastUid,
  });

  return {
    fetched:      result.total_seen,
    considered:   result.messages.length,
    inserted,
    duplicate,
    unmatched,
    insert_failed,
    lastUid:      result.lastUid ?? lastUid,
  };
}

// ── main ─────────────────────────────────────────────────────

async function main() {
  logger.info('inbox_reply worker starting', { selfCheck: SELF_CHECK });
  const supabase = buildSupabase();

  await runCycle(supabase);

  if (SELF_CHECK) {
    logger.info('inbox_reply_cron: self-check OK, exiting');
    process.exit(0);
  }
  // Not self-check: cron mode — single pass then process ends naturally.
  // Render fires this every 5 min via schedule config in render.yaml.
}

// ── Entry point ──────────────────────────────────────────────

import { fileURLToPath } from 'url';
const __isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (__isMain) {
  main().catch((err) => {
    logger.error('inbox_reply_cron fatal error', err);
    process.exit(1);
  });
}

export { runCycle, processOneMessage };
