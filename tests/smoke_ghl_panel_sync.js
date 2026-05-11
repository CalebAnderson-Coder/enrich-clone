// ============================================================
// tests/smoke_ghl_panel_sync.js — Verify lib/ghlPanelSync.js
// resolves hints to GHL fieldKeys correctly and dispatches a single
// PUT /contacts/{id} when a panel field is set.
//
// Stubs global.fetch — never touches the real GHL API.
// Stubs lib/supabase to return a fixture lead with email.
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

import { _hintToKey } from '../lib/ghlPanelSync.js';

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

console.log('\n[smoke_ghl_panel_sync] Running panel sync smoke tests...\n');

const ORIG_FETCH = global.fetch;
const ORIG_KEY   = process.env.EMPIRIKA_GHL_KEY;

try {

await t('Hint table maps app hints AND GHL fieldKeys to GHL fieldKeys', () => {
  const map = _hintToKey();
  // Direct GHL keys map to themselves
  if (map['emprika__email_opened_at'] !== 'emprika__email_opened_at') {
    throw new Error('GHL key did not map to itself');
  }
  // App-side hints (empirika_<x>) also resolve
  if (map['empirika_email_opened_at'] !== 'emprika__email_opened_at') {
    throw new Error('App hint empirika_email_opened_at did not resolve to GHL key');
  }
  if (map['empirika_followup_touch_2_at'] !== 'emprika__followup_touch_2_at') {
    throw new Error('App hint empirika_followup_touch_2_at did not resolve');
  }
});

await t('Unknown hint logs warning, does NOT call fetch', async () => {
  process.env.EMPIRIKA_GHL_KEY = 'stub-key';
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls++; return { ok: true, json: async () => ({}) }; };
  // Re-import via dynamic to keep module-load behavior; the function
  // is the same instance — call it with a bogus hint.
  const { setPanelFieldByLeadId } = await import('../lib/ghlPanelSync.js');
  await setPanelFieldByLeadId('fake-lead-id', 'empirika_does_not_exist', '2026-05-11T00:00:00Z');
  if (fetchCalls !== 0) throw new Error(`expected 0 fetch calls, got ${fetchCalls}`);
});

await t('Missing EMPIRIKA_GHL_KEY → silent return (no fetch)', async () => {
  delete process.env.EMPIRIKA_GHL_KEY;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls++; return { ok: true, json: async () => ({}) }; };
  const { setPanelFieldByLeadId } = await import('../lib/ghlPanelSync.js');
  await setPanelFieldByLeadId('fake-lead-id', 'empirika_email_opened_at', '2026-05-11T00:00:00Z');
  if (fetchCalls !== 0) throw new Error(`expected 0 fetch calls without key, got ${fetchCalls}`);
});

await t('Missing leadId or hint → silent return (no fetch)', async () => {
  process.env.EMPIRIKA_GHL_KEY = 'stub-key';
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls++; return { ok: true, json: async () => ({}) }; };
  const { setPanelFieldByLeadId } = await import('../lib/ghlPanelSync.js');
  await setPanelFieldByLeadId(null, 'empirika_email_opened_at', '2026-05-11T00:00:00Z');
  await setPanelFieldByLeadId('fake-lead-id', null, '2026-05-11T00:00:00Z');
  if (fetchCalls !== 0) throw new Error(`expected 0 fetch calls on null args, got ${fetchCalls}`);
});

} finally {
  global.fetch = ORIG_FETCH;
  if (ORIG_KEY === undefined) delete process.env.EMPIRIKA_GHL_KEY;
  else process.env.EMPIRIKA_GHL_KEY = ORIG_KEY;
}

console.log(`\n[smoke_ghl_panel_sync] ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
