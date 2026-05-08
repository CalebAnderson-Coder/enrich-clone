// ============================================================
// tests/smoke_outbound_loop.test.js
// ------------------------------------------------------------
// Regression guard for the Manager↔Sam outbound loop. Reproduces
// the bug pattern that motivated commit 016598e (Manager rejecting
// paid_ads_strategy_ready as unknown_message_type).
//
// Flow under test:
//   1. Manager sends `outreach_batch_proposal` to Sam
//   2. Sam's processSamMessage handles it, persists strategy state,
//      and emits `paid_ads_strategy_ready` back to Manager
//   3. Manager's processManagerMessage handles the reply with
//      acknowledged=true (NOT unknown_message_type)
//
// The runtime is stubbed so we don't burn real LLM tokens. The test
// uses a throwaway brand_id (random UUID) so it never contaminates
// Empírika or any real tenant data.
//
// Run: node --test tests/smoke_outbound_loop.test.js
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

import { AgentMessenger } from '../lib/AgentMessenger.js';
import { processIncomingMessage as processSamMessage } from '../workers/sam_autonomous.js';
import { processIncomingMessage as processManagerMessage } from '../workers/manager_autonomous.js';

// ── Helpers ─────────────────────────────────────────────────

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Stubbed runtime — no real LLM calls. */
const fakeRuntime = {
  run: async (_agent, _prompt) => ({
    response: 'Estrategia de prueba: 50% Google Ads ($300/mes), 50% Meta retargeting ($300/mes). Idioma español. ROI estimado 2.5x.',
  }),
};

const noopLog = {
  info:  () => {},
  warn:  () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLog,
};

// ── Test ────────────────────────────────────────────────────

test('outbound loop — Manager↔Sam paid_ads_strategy_ready closes cleanly', async (t) => {
  const supabase = buildSupabase();
  const TEST_BRAND_ID = randomUUID();
  const samMessenger = new AgentMessenger({
    supabase, agentName: 'sam', processId: randomUUID(), brandId: TEST_BRAND_ID,
  });
  const mgrMessenger = new AgentMessenger({
    supabase, agentName: 'manager', processId: randomUUID(), brandId: TEST_BRAND_ID,
  });

  t.after(async () => {
    // Cleanup — wipe anything we created under TEST_BRAND_ID
    await supabase.from('agent_messages').delete().eq('brand_id', TEST_BRAND_ID);
    await supabase.from('agent_state').delete().eq('brand_id', TEST_BRAND_ID);
    await supabase.from('agent_processes').delete().eq('brand_id', TEST_BRAND_ID);
  });

  // Need a brand row for Sam's processSamMessage SELECT brand_profile.
  // We insert a stub brand and remove it on cleanup.
  await supabase.from('brands').upsert({
    id: TEST_BRAND_ID,
    name: 'TEST · outbound loop smoke',
    industry: 'service business',
    brand_profile: { test: true },
  }, { onConflict: 'id' });
  t.after(async () => {
    await supabase.from('brands').delete().eq('id', TEST_BRAND_ID);
  });

  // ── Step 1: Manager → Sam outreach_batch_proposal ────────
  const inboundForSam = {
    id: -1, // synthetic — processSamMessage doesn't validate id shape
    brand_id: TEST_BRAND_ID,
    from_agent: 'manager',
    to_agent: 'sam',
    payload: { type: 'outreach_batch_proposal', tier: 'HOT', count: 3 },
  };

  // Override BRAND_ID for the duration of the test by patching env.
  const ORIG_BRAND = process.env.BRAND_ID;
  process.env.BRAND_ID = TEST_BRAND_ID;

  let samResult;
  try {
    // Sam signature: (msg, messenger, runtime, log, supabase)
    samResult = await processSamMessage(inboundForSam, samMessenger, fakeRuntime, noopLog, supabase);
  } finally {
    if (ORIG_BRAND === undefined) delete process.env.BRAND_ID;
    else process.env.BRAND_ID = ORIG_BRAND;
  }

  assert.equal(samResult.ok, true, 'Sam should process outreach_batch_proposal successfully');
  assert.equal(samResult.persisted, true, 'Sam should persist the strategy');
  assert.equal(samResult.type, 'outreach_batch_proposal');

  // ── Step 2: verify state was persisted by Sam ────────────
  // Sam writes key=`paid_ads_strategy:${BRAND_ID}` where BRAND_ID is
  // captured at module load time (cached env var). We match by LIKE
  // prefix so the test is independent of the captured value.
  const { data: stateRows } = await supabase
    .from('agent_state')
    .select('value, key')
    .eq('brand_id', TEST_BRAND_ID)
    .eq('agent_name', 'sam')
    .like('key', 'paid_ads_strategy:%');
  const stateRow = (stateRows || [])[0];
  assert.ok(stateRow?.value, 'agent_state should contain paid_ads_strategy:* under TEST_BRAND_ID');
  assert.equal(stateRow.value.tier, 'HOT');
  assert.equal(stateRow.value.count, 3);

  // ── Step 3: verify Sam emitted paid_ads_strategy_ready ──
  const { data: readyMsgs } = await supabase
    .from('agent_messages')
    .select('*')
    .eq('brand_id', TEST_BRAND_ID)
    .eq('from_agent', 'sam')
    .eq('to_agent', 'manager');
  assert.ok(readyMsgs && readyMsgs.length >= 1, 'Sam should emit at least one message to manager');
  const readyMsg = readyMsgs.find((m) => m.payload?.type === 'paid_ads_strategy_ready');
  assert.ok(readyMsg, 'Sam should emit paid_ads_strategy_ready specifically');

  // ── Step 4: Manager processes paid_ads_strategy_ready ───
  // Manager signature: (msg, messenger, runtime, log) — no supabase param
  const mgrResult = await processManagerMessage(
    readyMsg, mgrMessenger, fakeRuntime, noopLog
  );
  assert.equal(mgrResult.ok, true, 'Manager should ack paid_ads_strategy_ready');
  assert.equal(mgrResult.acknowledged, true, 'Manager should set acknowledged=true');
  assert.equal(mgrResult.type, 'paid_ads_strategy_ready');

  // ── Step 5: verify Manager state recorded the strategy ──
  const { data: mgrStateRows } = await supabase
    .from('agent_state')
    .select('value, key')
    .eq('brand_id', TEST_BRAND_ID)
    .eq('agent_name', 'manager')
    .like('key', 'last_paid_ads_strategy:%');
  const mgrState = (mgrStateRows || [])[0];
  assert.ok(mgrState?.value, 'Manager should record last_paid_ads_strategy:*');
  assert.equal(mgrState.value.tier, 'HOT');
  assert.equal(mgrState.value.count, 3);

  console.log('✅ Outbound loop closes cleanly: Manager → Sam → paid_ads_strategy_ready → Manager ack');
});
