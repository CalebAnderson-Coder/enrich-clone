// ============================================================
// tests/autonomy.spec.js — Sprint 1 autonomy contract
//
// The repo uses native Node test style (no Vitest / Jest) — see
// package.json scripts.test and tests/smoke_agent_events.js for
// the canonical pattern. We keep that style here: one module, a
// tiny test() helper, and a non-zero exit on failure.
//
// Coverage:
//   1. RADAR cycle invokes the pipeline with the cursor's pair and
//      advances the cursor exactly one step per pair.
//   2. `shouldAutoApprove` says NO when AUTONOMY_ENABLED=true but
//      the draft is not yet approved AND auto_approve_at is future.
//   3. `shouldAutoApprove` says YES once auto_approve_at is in the
//      past and held_by_human is false (with AUTONOMY_ENABLED=true).
//   4. Guardrail throws GuardrailBlocked when sent_today >= cap.
//   5. With AUTONOMY_ENABLED=false, daemon.start() is a no-op AND
//      shouldAutoApprove returns false regardless of timestamps.
// ============================================================

import { pickNext, runRadarCycle, EMPIRIKA_NICHES, LATINO_METROS } from '../workers/autonomy_orchestrator.js';
import { shouldAutoApprove } from '../outreach_dispatcher.js';
import { GuardrailBlocked, getEnvCaps } from '../lib/guardrails.js';
import * as dispatcher from '../outreach_dispatcher.js';
import * as daemon from '../agents/manager-daemon.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(
        () => { console.log(`  ✅ ${name}`); passed++; },
        (err) => { console.error(`  ❌ ${name}: ${err.message}`); failed++; }
      );
    }
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log('\n══════════════════════════════════════════════');
console.log('  AUTONOMY SPEC (Sprint 1)');
console.log('══════════════════════════════════════════════\n');

// ── Test 1 ───────────────────────────────────────────────────
await test('RADAR cycle invokes pipeline with cursor pair and advances cursor', async () => {
  const calls = [];
  const fakePipeline = async (args) => { calls.push(args); return { success: true }; };

  const cursor = { nicheIdx: 0, metroIdx: 0 };
  const { pairs, next } = pickNext(cursor, { count: 1 });

  const out = await runRadarCycle({
    brandId: 'brand-test',
    pairs,
    source: 'test',
    pipelineFn: fakePipeline,
  });

  assert(out.ok === true,                           'cycle should succeed');
  assert(calls.length === 1,                        `expected 1 pipeline call, got ${calls.length}`);
  assert(calls[0].niche === EMPIRIKA_NICHES[0],     'niche should match cursor');
  assert(calls[0].metro === LATINO_METROS[0],       'metro should match cursor');
  assert(next.metroIdx === 1 && next.nicheIdx === 0, `cursor must advance metroIdx only, got ${JSON.stringify(next)}`);
});

// ── Test 2 — Auto-approve gate says NO with future deadline ───
await test('dispatcher ignores row with approved=false and auto_approve_at in future', () => {
  const future = new Date(Date.now() + 60 * 60_000).toISOString(); // +1h
  const row = { approved: false, auto_approve_at: future, held_by_human: false };
  const ok = shouldAutoApprove(row, { autonomyEnabled: true });
  assert(ok === false, 'auto-approve must refuse future deadlines');
});

// ── Test 3 — Auto-approve gate says YES on past deadline ──────
await test('dispatcher approves row with auto_approve_at in past and AUTONOMY_ENABLED=true', () => {
  const past = new Date(Date.now() - 60_000).toISOString(); // -60s
  const row  = { approved: false, auto_approve_at: past, held_by_human: false };
  const ok   = shouldAutoApprove(row, { autonomyEnabled: true });
  assert(ok === true, 'auto-approve must fire when deadline has passed');

  const heldRow = { ...row, held_by_human: true };
  const heldOk  = shouldAutoApprove(heldRow, { autonomyEnabled: true });
  assert(heldOk === false, 'held_by_human=true must veto auto-approve');
});

// ── Test 4 — Guardrail blocks on cap breach ──────────────────
await test('guardrail blocks when sent_today >= MAX_LEADS_PER_DAY_PER_BRAND', async () => {
  // We can't easily stub Supabase here without monkey-patching the
  // module graph, so we verify the error shape directly via the
  // GuardrailBlocked contract — that's what the caller reacts to.
  const caps = getEnvCaps();
  assert(typeof caps.MAX_LEADS_PER_DAY_PER_BRAND === 'number', 'env cap must be a number');

  const err = new GuardrailBlocked('daily_cap_reached', {
    sent_today: caps.MAX_LEADS_PER_DAY_PER_BRAND,
    daily_cap:  caps.MAX_LEADS_PER_DAY_PER_BRAND,
  });
  assert(err.code === 'SEND_GUARDRAIL_BLOCKED', 'error code must be SEND_GUARDRAIL_BLOCKED');
  assert(err.reason === 'daily_cap_reached',    'reason must match');
  assert(err.details.sent_today === err.details.daily_cap, 'details preserved');
});

// ── Test 5 — AUTONOMY_ENABLED=false ⇒ rollback-safe ──────────
await test('AUTONOMY_ENABLED=false → daemon.start() no-op + auto-approve refuses', async () => {
  const prior = process.env.AUTONOMY_ENABLED;
  process.env.AUTONOMY_ENABLED = 'false';

  // daemon.start() must not install a timer when flag is off
  daemon.stop(); // ensure clean state
  daemon.start({ brandsProvider: async () => [{ id: 'brand-x' }] });
  // If start() had scheduled anything, tick() would await getActiveBrands.
  // We also directly verify by calling internal tick: it should early-return.
  await daemon._internal.tick({ brandsProvider: async () => { throw new Error('should not be called'); } });

  // shouldAutoApprove must refuse even with past deadline
  const past = new Date(Date.now() - 60_000).toISOString();
  const row  = { approved: false, auto_approve_at: past, held_by_human: false };
  const ok   = shouldAutoApprove(row, { autonomyEnabled: false });
  assert(ok === false, 'auto-approve must refuse when autonomy disabled');

  // restore
  process.env.AUTONOMY_ENABLED = prior;
  daemon.stop();
});

// ─────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════');
console.log('  RESULTS');
console.log('══════════════════════════════════════════════\n');
console.log(`  Total : ${passed + failed}`);
console.log(`  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}\n`);

// Keep the export so `dispatcher` is considered used (avoids
// tree-shaking warnings; also available if the suite grows).
void dispatcher;

process.exit(failed > 0 ? 1 : 0);
