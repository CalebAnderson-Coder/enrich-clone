// ============================================================
// lib/notify.js — Multi-channel notification dispatcher (BK-027)
//
// Sends a one-line notification to whichever channels have credentials
// configured via env vars. Channels are optional and independent —
// missing creds for one channel never block the others.
//
// Console is always written. Telegram and Slack are conditional.
//
// Channels:
//   console:  always — uses logger.info with kind='notify'.
//   telegram: requires TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.
//   slack:    requires SLACK_WEBHOOK_URL.
//
// Contract:
//   notify(opts)            -> Promise<{ console, telegram, slack }>
//   opts: {
//     kind:       string  (e.g. 'approval_request')
//     title:      string  (one-line headline; required)
//     body:       string  (multi-line body; optional)
//     links?:     [{ label, url }]  (optional CTAs)
//     dryRun?:    boolean (skip network calls)
//   }
//
// Each channel returns one of:
//   'sent'      — request succeeded
//   'skipped'   — channel not configured (no creds)
//   'error:<m>' — request threw or non-2xx; never throws to caller
//
// Used by:
//   tools/approvals.js  (lifts the BK-027 TODO at line 89)
// ============================================================

import { logger } from './logger.js';

const TELEGRAM_API = 'https://api.telegram.org';

function envHas(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

function renderTextMessage({ kind, title, body, links }) {
  const parts = [`[${kind}] ${title}`];
  if (body) parts.push(String(body).slice(0, 3500));
  if (Array.isArray(links) && links.length > 0) {
    parts.push('');
    for (const l of links) {
      if (!l || !l.url) continue;
      parts.push(`${l.label || 'Link'}: ${l.url}`);
    }
  }
  return parts.join('\n');
}

async function notifyConsole(opts) {
  const text = renderTextMessage(opts);
  logger.info(text, { kind: 'notify', notify_kind: opts.kind, channel: 'console' });
  return 'sent';
}

async function notifyTelegram(opts) {
  if (!envHas('TELEGRAM_BOT_TOKEN') || !envHas('TELEGRAM_CHAT_ID')) return 'skipped';
  if (opts.dryRun) return 'sent';
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const text   = renderTextMessage(opts);
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) return `error:telegram_${res.status}`;
    return 'sent';
  } catch (err) {
    return `error:${err.message}`;
  }
}

async function notifySlack(opts) {
  if (!envHas('SLACK_WEBHOOK_URL')) return 'skipped';
  if (opts.dryRun) return 'sent';
  const url  = process.env.SLACK_WEBHOOK_URL;
  const text = renderTextMessage(opts);
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
    });
    if (!res.ok) return `error:slack_${res.status}`;
    return 'sent';
  } catch (err) {
    return `error:${err.message}`;
  }
}

/**
 * Send a notification to whichever channels are configured. Never throws.
 *
 * @param {object} opts
 * @param {string} opts.kind  — short identifier (e.g. 'approval_request')
 * @param {string} opts.title — one-line headline
 * @param {string} [opts.body]
 * @param {Array<{label?: string, url: string}>} [opts.links]
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<{ console: string, telegram: string, slack: string }>}
 */
export async function notify(opts) {
  if (!opts || typeof opts !== 'object' || !opts.kind || !opts.title) {
    return {
      console:  'error:bad_opts',
      telegram: 'skipped',
      slack:    'skipped',
    };
  }
  const [c, t, s] = await Promise.all([
    notifyConsole(opts).catch(e => `error:${e.message}`),
    notifyTelegram(opts).catch(e => `error:${e.message}`),
    notifySlack(opts).catch(e => `error:${e.message}`),
  ]);
  return { console: c, telegram: t, slack: s };
}

/**
 * Convenience wrapper for tools/approvals.js — formats an approval request
 * payload into the standard notify() contract.
 */
export async function notifyApprovalRequest({ jobId, contentType, summary, approveLink, rejectLink }) {
  return notify({
    kind:  'approval_request',
    title: `Approval needed — Job ${jobId} (${contentType})`,
    body:  String(summary || '').slice(0, 600),
    links: [
      { label: '✅ Approve', url: approveLink },
      { label: '❌ Reject',  url: rejectLink  },
    ],
  });
}
