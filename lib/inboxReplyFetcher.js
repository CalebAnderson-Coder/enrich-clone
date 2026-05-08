// ============================================================
// lib/inboxReplyFetcher.js — IMAP inbox reply extractor
//
// Pure extraction layer: connects to Gmail via IMAP and returns
// messages from INBOX that look like replies to outreach.
// Never marks messages read. Never touches Supabase.
// Caller is responsible for matching UIDs to leads.
//
// Env vars consumed:
//   SMTP_USER  — Gmail Workspace address (e.g. jsanchez@empirikagroup.com)
//   SMTP_PASS  — App Password (works for both SMTP and IMAP)
//   IMAP_HOST  — optional, default imap.gmail.com
//   IMAP_PORT  — optional, default 993
// ============================================================

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { pathToFileURL } from 'url';

const CONNECT_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS   = 30_000;
const BODY_SLICE_CHARS   = 5_000;
const DEFAULT_DAYS_BACK  = 7;

// ── Internal helpers ─────────────────────────────────────────

/**
 * Coerce a mailparser address object (or array) into a flat list
 * of { email, name } entries.
 *
 * @param {object|object[]|null} addrField
 * @returns {{ email: string, name: string }[]}
 */
function parseAddressList(addrField) {
  if (!addrField) return [];
  const values = Array.isArray(addrField.value)
    ? addrField.value
    : addrField.value
      ? [addrField.value]
      : [];
  return values
    .filter(Boolean)
    .map((v) => ({
      email: (v.address || '').toLowerCase().replace(/[<>]/g, '').trim(),
      name:  (v.name   || '').trim(),
    }))
    .filter((v) => v.email);
}

/**
 * Split a References header string into an array of message-id tokens.
 *
 * @param {string|null} raw
 * @returns {string[]}
 */
function splitReferences(raw) {
  if (!raw) return [];
  return raw.trim().split(/\s+/).filter(Boolean);
}

/**
 * Build a Date object representing "N days ago at midnight UTC".
 *
 * @param {number} days
 * @returns {Date}
 */
function daysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Fetch new inbox messages that look like replies (have In-Reply-To
 * or References headers). Caller passes lastSeenUid for incremental
 * polling — first run pass null/0 to fetch everything since some date.
 *
 * @param {object} args
 * @param {number}  [args.sinceUid=0]        Only fetch messages with UID > sinceUid.
 * @param {string}  [args.sinceDate]          ISO date; ignored if sinceUid > 0.
 * @param {number}  [args.limit=50]           Max messages per call.
 * @param {boolean} [args.onlyReplies=true]   If true, skip messages without In-Reply-To.
 * @param {object}  [args.log]
 * @returns {Promise<{
 *   messages: Array<{
 *     uid: number,
 *     message_id: string|null,
 *     in_reply_to: string|null,
 *     references: string[],
 *     from_email: string|null,
 *     from_name: string|null,
 *     to_emails: string[],
 *     subject: string,
 *     body_text: string,
 *     date: string,
 *   }>,
 *   lastUid: number,
 *   errors: string[],
 *   total_seen: number,
 * }>}
 */
export async function fetchInboxReplies({
  sinceUid    = 0,
  sinceDate   = null,
  limit       = 50,
  onlyReplies = true,
  log         = null,
} = {}) {
  const host = process.env.IMAP_HOST || 'imap.gmail.com';
  const port = Number(process.env.IMAP_PORT || 993);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    return {
      messages: [],
      lastUid:  sinceUid,
      errors:   ['SMTP_USER or SMTP_PASS env vars not set'],
      total_seen: 0,
    };
  }

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
  });

  const messages   = [];
  const errors     = [];
  let   lastUid    = sinceUid;
  let   total_seen = 0;

  try {
    log?.info?.('inbox_reply_fetcher: connecting', { host, port, user });
    await client.connect();

    const lock = await client.getMailboxLock('INBOX');

    try {
      // ── 1. Determine search criteria ──────────────────────
      let searchCriteria;
      if (sinceUid > 0) {
        searchCriteria = { uid: `${sinceUid + 1}:*` };
      } else {
        const since = sinceDate ? new Date(sinceDate) : daysAgo(DEFAULT_DAYS_BACK);
        searchCriteria = { since };
      }

      // ── 2. UID search ────────────────────────────────────
      const uidList = await Promise.race([
        client.search(searchCriteria, { uid: true }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('UID search timed out')), FETCH_TIMEOUT_MS),
        ),
      ]);

      if (!uidList || uidList.length === 0) {
        log?.info?.('inbox_reply_fetcher: no messages found', { searchCriteria });
        return { messages, lastUid, errors, total_seen };
      }

      // Apply limit from the highest UIDs (most recent first)
      const candidateUids = uidList.slice(-limit);

      log?.info?.('inbox_reply_fetcher: fetching', {
        total_found: uidList.length,
        fetching: candidateUids.length,
      });

      // ── 3. Fetch raw source ──────────────────────────────
      const fetchGen = client.fetch(
        candidateUids,
        { source: true, envelope: true, uid: true },
        { uid: true },
      );

      const fetchPromise = (async () => {
        for await (const msg of fetchGen) {
          total_seen++;
          const uid = msg.uid;
          if (uid > lastUid) lastUid = uid;

          let parsed;
          try {
            parsed = await simpleParser(msg.source);
          } catch (parseErr) {
            const detail = `uid ${uid}: parse error — ${parseErr.message}`;
            log?.warn?.('inbox_reply_fetcher: ' + detail);
            errors.push(detail);
            continue;
          }

          // ── 4. Extract reply headers ──────────────────────
          const inReplyTo  = parsed.headers.get('in-reply-to') || null;
          const refsRaw    = parsed.headers.get('references')  || null;
          const references = splitReferences(typeof refsRaw === 'string' ? refsRaw : null);

          // ── 5. Apply onlyReplies filter ───────────────────
          if (onlyReplies && !inReplyTo) {
            log?.debug?.('inbox_reply_fetcher: skip (no in-reply-to)', { uid });
            continue;
          }

          // ── 6. Extract addresses ──────────────────────────
          const fromList = parseAddressList(parsed.from);
          const fromAddr = fromList[0] || {};
          const toList   = parseAddressList(parsed.to);

          // ── 7. Build output record ────────────────────────
          messages.push({
            uid,
            message_id:  parsed.messageId || null,
            in_reply_to: inReplyTo        || null,
            references,
            from_email:  fromAddr.email   || null,
            from_name:   fromAddr.name    || null,
            to_emails:   toList.map((a) => a.email),
            subject:     parsed.subject   || '',
            body_text:   (parsed.text     || '').slice(0, BODY_SLICE_CHARS),
            date:        parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
          });
        }
      })();

      await Promise.race([
        fetchPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Fetch loop timed out')), FETCH_TIMEOUT_MS),
        ),
      ]);

    } finally {
      lock.release();
    }

  } catch (err) {
    log?.warn?.('inbox_reply_fetcher: connection/fetch error', { err: err.message });
    errors.push(err.message);
    return { messages: [], lastUid: sinceUid, errors, total_seen: 0 };
  } finally {
    try { await client.logout(); } catch (_) { /* ignore logout errors */ }
  }

  log?.info?.('inbox_reply_fetcher: done', {
    total_seen,
    replies: messages.length,
    lastUid,
    errors: errors.length,
  });

  return { messages, lastUid, errors, total_seen };
}

// ============================================================
// QUICK SMOKE TEST — run with: node lib/inboxReplyFetcher.js
// Prints last 5 reply messages from the past 7 days.
// ============================================================

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { default: dotenv } = await import('dotenv').catch(() => ({ default: { config: () => {} } }));
  dotenv.config();

  const host = process.env.IMAP_HOST || 'imap.gmail.com';
  console.log(`Connecting to ${host}...`);

  const result = await fetchInboxReplies({
    sinceUid:    0,
    limit:       50,
    onlyReplies: true,
    log: {
      info:  (...a) => console.log('[info]',  ...a),
      warn:  (...a) => console.warn('[warn]',  ...a),
      debug: ()    => {},
    },
  });

  if (result.errors.length > 0) {
    console.error('Errors:', result.errors);
  }

  console.log(`\nFound ${result.messages.length} messages with replies in last 7 days`);
  console.log(`Total inbox messages scanned: ${result.total_seen}`);
  console.log(`Last UID cursor: ${result.lastUid}`);

  const preview = result.messages.slice(-5);
  for (const m of preview) {
    const subj = m.subject || '(no subject)';
    const from = m.from_email || '?';
    const date = m.date.slice(0, 10);
    console.log(`[uid ${m.uid}] ${date}  from: ${from}  →  ${subj}`);
  }
}
