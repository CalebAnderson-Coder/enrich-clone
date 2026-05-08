// ============================================================
// lib/replyMatcher.js — Inbound reply → outreach event matcher
//
// Given a parsed IMAP message (output of inboxReplyFetcher.js),
// determines whether it is a reply to one of Empírika's outbound
// emails and resolves the corresponding lead_id.
//
// Strategy (priority order):
//   1. HEADER MATCH  — in_reply_to / references header matches a
//      known outreach_events.message_id (confidence 1.0, definitive).
//   2. FROM-EMAIL MATCH — from_email matches a lead's email field
//      AND that lead has a 'sent' event in the last 60 days
//      (confidence 0.7, heuristic).
//   3. No match → {matched: false, reason: 'no_header_no_email_match'}.
//
// Pure-logic + Supabase reads. Never writes to DB. Never calls LLM.
// ============================================================

const QUERY_TIMEOUT_MS = 8_000;
const RECENT_SENT_DAYS = 60;

/** Regex to filter out system / no-reply senders before doing email lookup. */
const SYSTEM_EMAIL_RE = /no-?reply|noreply|notifications?@|mailer-daemon|postmaster|bounces?@/i;

// ── Helpers ──────────────────────────────────────────────────

/**
 * Wraps a Supabase query promise with a hard 8-second timeout.
 * Returns the same {data, error} shape so callers need no special handling.
 *
 * @param {Promise} promise
 * @param {string}  label — used only in the timeout error message
 * @returns {Promise<{data: any, error: any}>}
 */
function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((resolve) =>
      setTimeout(
        () => resolve({ data: null, error: { message: `timeout after ${QUERY_TIMEOUT_MS}ms (${label})` } }),
        QUERY_TIMEOUT_MS,
      ),
    ),
  ]);
}

/**
 * Normalise a Message-ID string: lowercase + trim.
 * Keeps the angle-bracket wrapping (<…>) because that is the
 * canonical format stored in outreach_events.message_id.
 *
 * @param {string} raw
 * @returns {string}
 */
function normaliseMessageId(raw) {
  return String(raw).trim().toLowerCase();
}

// ── Main export ──────────────────────────────────────────────

/**
 * Try to match an inbound reply message to a previously sent outreach event.
 *
 * Strategy (in priority order):
 *   1. HEADER MATCH — if message.in_reply_to or any of message.references
 *      equals the message_id of any outreach_events row with event_type='sent',
 *      that's a definitive match. Returns {matched: true, source: 'header', ...}.
 *   2. FROM-EMAIL MATCH — if message.from_email matches a lead's
 *      email/email_address AND there's a 'sent' event for that lead within
 *      the last 60 days. Returns {matched: true, source: 'from_email', ...}.
 *   3. No match → {matched: false, reason: 'no_header_no_email_match'}.
 *
 * @param {object} args
 * @param {import('@supabase/supabase-js').SupabaseClient} args.supabase
 * @param {object} args.message — output from inboxReplyFetcher
 * @param {string} args.brandId
 * @param {object} [args.log]
 * @returns {Promise<{
 *   matched: boolean,
 *   source?: 'header'|'from_email',
 *   lead_id?: string,
 *   original_sent_event_id?: string,
 *   confidence: number,
 *   reason?: string,
 * }>}
 */
export async function matchReplyToOutreach({ supabase, message, brandId, log }) {
  // ── 1. HEADER MATCH ─────────────────────────────────────────
  const rawCandidates = [
    message.in_reply_to,
    ...(Array.isArray(message.references) ? message.references : []),
  ].filter((v) => v && String(v).trim().length > 0);

  if (rawCandidates.length > 0) {
    const candidates = rawCandidates.map(normaliseMessageId);

    const headerResp = await withTimeout(
      supabase
        .from('outreach_events')
        .select('id, lead_id, message_id, occurred_at')
        .eq('brand_id', brandId)
        .eq('event_type', 'sent')
        .in('message_id', candidates)
        .order('occurred_at', { ascending: false })
        .limit(1),
      'outreach_events_header',
    );

    if (headerResp.error) {
      log?.warn?.('replyMatcher: header query failed', { err: headerResp.error.message, uid: message.uid });
      return { matched: false, confidence: 0, reason: `supabase_error: ${headerResp.error.message}` };
    }

    const row = headerResp.data?.[0];
    if (row) {
      log?.info?.('replyMatcher: header match', { uid: message.uid, lead_id: row.lead_id, event_id: row.id });
      return {
        matched: true,
        source: 'header',
        lead_id: row.lead_id,
        original_sent_event_id: row.id,
        confidence: 1.0,
      };
    }
  }

  // ── 2. FROM-EMAIL MATCH ─────────────────────────────────────
  const fromEmail = message.from_email ? String(message.from_email).trim().toLowerCase() : '';

  if (!fromEmail) {
    return { matched: false, confidence: 0, reason: 'no_header_no_email_match' };
  }

  if (SYSTEM_EMAIL_RE.test(fromEmail)) {
    log?.info?.('replyMatcher: system email filtered', { uid: message.uid, from_email: fromEmail });
    return { matched: false, confidence: 0, reason: 'system_email' };
  }

  // Query 1: find leads with this email for the brand
  const leadsResp = await withTimeout(
    supabase
      .from('leads')
      .select('id, business_name, email, email_address')
      .eq('brand_id', brandId)
      .or(`email.ilike.${fromEmail},email_address.ilike.${fromEmail}`)
      .limit(5),
    'leads_by_email',
  );

  if (leadsResp.error) {
    log?.warn?.('replyMatcher: leads query failed', { err: leadsResp.error.message, uid: message.uid });
    return { matched: false, confidence: 0, reason: `supabase_error: ${leadsResp.error.message}` };
  }

  const matchedLeads = (leadsResp.data || []).filter((lead) => {
    const a = (lead.email || '').toLowerCase();
    const b = (lead.email_address || '').toLowerCase();
    return a === fromEmail || b === fromEmail;
  });

  if (matchedLeads.length === 0) {
    return { matched: false, confidence: 0, reason: 'no_lead_with_that_email' };
  }

  // Query 2: for each candidate lead, look for a recent 'sent' event
  const cutoff = new Date(Date.now() - RECENT_SENT_DAYS * 24 * 3600 * 1000).toISOString();

  for (const lead of matchedLeads) {
    const sentResp = await withTimeout(
      supabase
        .from('outreach_events')
        .select('id, lead_id, occurred_at')
        .eq('brand_id', brandId)
        .eq('lead_id', lead.id)
        .eq('event_type', 'sent')
        .gte('occurred_at', cutoff)
        .order('occurred_at', { ascending: false })
        .limit(1),
      `outreach_events_sent_${lead.id}`,
    );

    if (sentResp.error) {
      log?.warn?.('replyMatcher: sent-event query failed', { err: sentResp.error.message, lead_id: lead.id });
      // non-fatal: try the next candidate
      continue;
    }

    const sentRow = sentResp.data?.[0];
    if (sentRow) {
      log?.info?.('replyMatcher: from_email match', {
        uid: message.uid,
        from_email: fromEmail,
        lead_id: lead.id,
        event_id: sentRow.id,
      });
      return {
        matched: true,
        source: 'from_email',
        lead_id: lead.id,
        original_sent_event_id: sentRow.id,
        confidence: 0.7,
      };
    }
  }

  return { matched: false, confidence: 0, reason: 'no_recent_sent_for_email' };
}

// ============================================================
// SELF-TEST
// Run directly:  node lib/replyMatcher.js
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env,
// plus real IDs that exist in your project for fixtures 1 & 2.
// Fixture 3 always expects no-match regardless of DB state.
// ============================================================

// Cross-platform ESM self-run guard (works on Windows too).
const _selfUrl = new URL(import.meta.url);
const _argvUrl = process.argv[1]
  ? new URL(process.argv[1].startsWith('file:') ? process.argv[1] : `file:///${process.argv[1].replace(/\\/g, '/')}`).href
  : '';

if (_selfUrl.href === _argvUrl) {
  const { createClient } = await import('@supabase/supabase-js');
  const dotenv = await import('dotenv');
  dotenv.config();

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('replyMatcher self-test: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Pull brand_id from env (same convention as the rest of the fleet)
  const brandId = process.env.BRAND_ID || process.env.TEST_BRAND_ID;
  if (!brandId) {
    console.error('replyMatcher self-test: set BRAND_ID or TEST_BRAND_ID in .env');
    process.exit(1);
  }

  // ── Probe DB for real IDs to build fixtures 1 & 2 ───────────
  // Fixture 1 needs a real outreach_events row with event_type='sent'
  // that has a non-null message_id.
  const { data: sentEvent } = await supabase
    .from('outreach_events')
    .select('id, lead_id, message_id')
    .eq('brand_id', brandId)
    .eq('event_type', 'sent')
    .not('message_id', 'is', null)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fixture 2 needs a real lead with an email AND a recent sent event.
  const { data: recentSentForEmail } = await supabase
    .from('outreach_events')
    .select('id, lead_id, occurred_at')
    .eq('brand_id', brandId)
    .eq('event_type', 'sent')
    .gte('occurred_at', new Date(Date.now() - RECENT_SENT_DAYS * 24 * 3600 * 1000).toISOString())
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let leadForFixture2 = null;
  if (recentSentForEmail?.lead_id) {
    const { data: ld } = await supabase
      .from('leads')
      .select('id, email, email_address')
      .eq('id', recentSentForEmail.lead_id)
      .maybeSingle();
    if (ld && (ld.email || ld.email_address)) leadForFixture2 = ld;
  }

  // ── Fixtures ─────────────────────────────────────────────────
  const fixtures = [
    {
      label: 'fixture-1: header match (in_reply_to)',
      skip: !sentEvent?.message_id,
      skipReason: 'no sent event with message_id found in DB',
      message: {
        uid: 1001,
        message_id: '<reply-001@example.com>',
        in_reply_to: sentEvent?.message_id ?? null,
        references: [],
        from_email: 'client-fixture1@example.com',
        from_name: 'Client One',
        to_emails: ['outreach@empirikagroup.com'],
        subject: 'Re: Propuesta Empírika',
        body_text: 'Gracias, me interesa la propuesta.',
        date: new Date().toISOString(),
      },
      expect: { matched: true, source: 'header', confidence: 1.0 },
    },
    {
      label: 'fixture-2: from_email match (no headers)',
      skip: !leadForFixture2,
      skipReason: 'no lead with email + recent sent event found in DB',
      message: {
        uid: 1002,
        message_id: '<reply-002@example.com>',
        in_reply_to: null,
        references: [],
        from_email: (leadForFixture2?.email || leadForFixture2?.email_address || '').toLowerCase(),
        from_name: 'Client Two',
        to_emails: ['outreach@empirikagroup.com'],
        subject: 'Re: algo',
        body_text: '',
        date: new Date().toISOString(),
      },
      expect: { matched: true, source: 'from_email', confidence: 0.7 },
    },
    {
      label: 'fixture-3: no match (unknown headers + unknown email)',
      skip: false,
      message: {
        uid: 1003,
        message_id: '<reply-003@nowhere.com>',
        in_reply_to: '<totally-unknown-id-xyz-abc@nowhere.com>',
        references: ['<also-unknown@nowhere.com>'],
        from_email: 'nobody_xyz_unknown_9999@random-domain-99999.com',
        from_name: 'Nobody',
        to_emails: ['outreach@empirikagroup.com'],
        subject: 'spam',
        body_text: '',
        date: new Date().toISOString(),
      },
      expect: { matched: false, confidence: 0 },
    },
  ];

  // ── Run ───────────────────────────────────────────────────────
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  const log = {
    info: (msg, data) => console.log(`  [info] ${msg}`, data ?? ''),
    warn: (msg, data) => console.warn(`  [warn] ${msg}`, data ?? ''),
  };

  console.log('\nreplyMatcher self-test — brand:', brandId, '\n');

  for (const fx of fixtures) {
    if (fx.skip) {
      console.log(`  SKIP  ${fx.label} — ${fx.skipReason}`);
      skipped++;
      continue;
    }

    const result = await matchReplyToOutreach({ supabase, message: fx.message, brandId, log });
    const ok =
      result.matched === fx.expect.matched &&
      result.confidence === fx.expect.confidence &&
      (!fx.expect.source || result.source === fx.expect.source);

    if (ok) {
      console.log(`  PASS  ${fx.label}`);
      console.log(`        → source=${result.source ?? 'n/a'} confidence=${result.confidence} reason=${result.reason ?? '-'}`);
      passed++;
    } else {
      console.error(`  FAIL  ${fx.label}`);
      console.error(`        expected: matched=${fx.expect.matched} source=${fx.expect.source ?? 'n/a'} confidence=${fx.expect.confidence}`);
      console.error(`        got:      matched=${result.matched} source=${result.source ?? 'n/a'} confidence=${result.confidence} reason=${result.reason ?? '-'}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed · ${failed} failed · ${skipped} skipped\n`);
  process.exit(failed > 0 ? 1 : 0);
}
