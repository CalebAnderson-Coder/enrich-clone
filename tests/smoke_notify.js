// ============================================================
// tests/smoke_notify.js — BK-027 multi-channel notification smoke
//
// Stubs global.fetch so we can observe whether telegram/slack POSTs
// would have been issued without hitting any real network.
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

import { notify, notifyApprovalRequest } from '../lib/notify.js';

let passed = 0;
let failed = 0;

async function t(name, fn) {
  try {
    await fn();
    console.log(`  OK  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.message}`);
    failed++;
  }
}

const ORIG_ENV = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID:   process.env.TELEGRAM_CHAT_ID,
  SLACK_WEBHOOK_URL:  process.env.SLACK_WEBHOOK_URL,
};
function restoreEnv() {
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const ORIG_FETCH = global.fetch;
function stubFetch(impl) { global.fetch = impl; }
function restoreFetch()  { global.fetch = ORIG_FETCH; }

console.log('\n[smoke_notify] Running notify() smoke tests...\n');

try {

await t('No env vars → console sent, telegram+slack skipped', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.SLACK_WEBHOOK_URL;
  let fetchCalls = 0;
  stubFetch(async () => { fetchCalls++; return { ok: true }; });

  const res = await notify({ kind: 'test', title: 'no env' });

  if (res.console !== 'sent')      throw new Error(`console=${res.console}`);
  if (res.telegram !== 'skipped')  throw new Error(`telegram=${res.telegram}`);
  if (res.slack !== 'skipped')     throw new Error(`slack=${res.slack}`);
  if (fetchCalls !== 0)            throw new Error(`unexpected fetch calls: ${fetchCalls}`);
});

await t('Telegram env set + dryRun → telegram sent without network call', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
  process.env.TELEGRAM_CHAT_ID   = '12345';
  let fetchCalls = 0;
  stubFetch(async () => { fetchCalls++; return { ok: true }; });

  const res = await notify({ kind: 'test', title: 'tg dry', dryRun: true });

  if (res.telegram !== 'sent') throw new Error(`telegram=${res.telegram}`);
  if (fetchCalls !== 0)        throw new Error(`dryRun should skip network; got ${fetchCalls} calls`);
});

await t('Slack webhook set + ok response → slack sent with 1 fetch call', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/FAKE/STUB/CHANNEL';
  let fetchCalls = 0;
  stubFetch(async (url, opts) => {
    fetchCalls++;
    if (!String(url).startsWith('https://hooks.slack.com/')) {
      throw new Error(`unexpected url: ${url}`);
    }
    if (!opts || opts.method !== 'POST') throw new Error('expected POST');
    return { ok: true };
  });

  const res = await notify({ kind: 'test', title: 'slack live', body: 'hello' });

  if (res.slack !== 'sent') throw new Error(`slack=${res.slack}`);
  if (fetchCalls !== 1)     throw new Error(`expected 1 slack POST, got ${fetchCalls}`);
});

await t('Bad opts (missing title) → console error, others skipped', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.SLACK_WEBHOOK_URL;
  const res = await notify({ kind: 'test' });
  if (res.console !== 'error:bad_opts') throw new Error(`console=${res.console}`);
  if (res.telegram !== 'skipped')       throw new Error(`telegram=${res.telegram}`);
});

await t('notifyApprovalRequest formats payload correctly (dry through console)', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.SLACK_WEBHOOK_URL;
  const res = await notifyApprovalRequest({
    jobId: 'job-123',
    contentType: 'email',
    summary: 'A test approval request.',
    approveLink: 'https://example.test/approve?j=123',
    rejectLink:  'https://example.test/reject?j=123',
  });
  if (res.console !== 'sent') throw new Error(`console=${res.console}`);
});

} finally {
  restoreEnv();
  restoreFetch();
}

console.log(`\n[smoke_notify] ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
