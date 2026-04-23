// ============================================================
// tests/autonomy/briefing_staleness.spec.js
//
// Plan §B.4 A2: the morning briefing must surface AUTO-whitelist
// entries whose oldest unacknowledged audit exceeds the staleness
// banner threshold (14d = 336h). This is an on-boot query, NOT a
// nightly auditor metric row (V3 retired).
//
// Scope of this test:
//   - _AUTO_ACTIONS integrity (matches WHITELIST decision=AUTO)
//   - STALENESS_BANNER_HOURS = 336 in briefing source (canonical constant)
//   - fetchStaleAutoActions read shape (smoke — SQL not exercised here)
//   - buildDispatchPlan: escalation annotates escalated=true / original_action
//
// Run: node tests/autonomy/briefing_staleness.spec.js
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildDispatchPlan,
  WHITELIST,
  decisionFor,
  escalateIfNeeded,
} from '../../scripts/morning_briefing.js';
import { _AUTO_ACTIONS } from '../../lib/autonomy_whitelist.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); }
}

// ── 1. _AUTO_ACTIONS integrity ────────────────────────────────

test('_AUTO_ACTIONS is a non-empty array', () => {
  assert.ok(Array.isArray(_AUTO_ACTIONS));
  assert.ok(_AUTO_ACTIONS.length > 0);
});

test('_AUTO_ACTIONS exactly matches WHITELIST entries with decision=AUTO', () => {
  const fromWhitelist = Object.entries(WHITELIST)
    .filter(([, v]) => v.decision === 'AUTO')
    .map(([k]) => k)
    .sort();
  assert.deepEqual([..._AUTO_ACTIONS].sort(), fromWhitelist);
});

test('every _AUTO_ACTIONS entry is decisionFor()-resolved as AUTO', () => {
  for (const action of _AUTO_ACTIONS) {
    assert.equal(decisionFor(action).decision, 'AUTO', `${action} should resolve AUTO`);
  }
});

// ── 2. Canonical STALENESS_BANNER_HOURS constant ─────────────

test('morning_briefing.js declares STALENESS_BANNER_HOURS = 336 (14d)', () => {
  const file = path.join(process.cwd(), 'scripts', 'morning_briefing.js');
  const src  = fs.readFileSync(file, 'utf8');
  assert.match(src, /STALENESS_BANNER_HOURS\s*=\s*336/, 'plan §B.4 A2 constant drifted');
});

test('morning_briefing.js declares DEFAULT_BUDGET_CAP_USD = 10 (plan §B.4 A8)', () => {
  const file = path.join(process.cwd(), 'scripts', 'morning_briefing.js');
  const src  = fs.readFileSync(file, 'utf8');
  assert.match(src, /DEFAULT_BUDGET_CAP_USD\s*=\s*10/, 'budget cap drifted from plan §B.4 A8');
});

test('morning_briefing.js exposes fetchStaleAutoActions helper', () => {
  const file = path.join(process.cwd(), 'scripts', 'morning_briefing.js');
  const src  = fs.readFileSync(file, 'utf8');
  assert.match(src, /function fetchStaleAutoActions\s*\(/, 'helper missing');
  assert.match(src, /in\(\s*['"]suggested_action['"]\s*,\s*_AUTO_ACTIONS\s*\)/,
    'fetchStaleAutoActions must filter by _AUTO_ACTIONS only');
});

// ── 3. Escalation annotation in buildDispatchPlan ────────────

test('buildDispatchPlan annotates escalated=true + original_action when WA red escalates', () => {
  const audit = {
    id: 'a1',
    metric_name: 'wa_delivery_failure_rate_14d',
    severity: 'red',
    value: 100,
    suggested_action: 'INVESTIGATE_WA_DELIVERABILITY',
    details: { denom: 45, failed: 45 },
    created_at: new Date().toISOString(),
  };
  const plan = buildDispatchPlan({
    audits: [audit], reportOnly: false, cap: 3, budgetSpent: 0, budgetCap: 100,
  });
  // Escalated action is DISABLE_WA_CHANNEL_TEMP, which is REPORT_ONLY in whitelist,
  // so it should NOT be auto-dispatched — just annotated in downgraded list.
  assert.equal(plan.dispatches.length, 0, 'DISABLE_WA_CHANNEL_TEMP must never auto-dispatch');
  assert.equal(plan.downgraded.length, 1);
  const row = plan.downgraded[0];
  assert.equal(row.escalated, true);
  assert.equal(row.suggested_action, 'DISABLE_WA_CHANNEL_TEMP');
  assert.equal(row.original_action, 'INVESTIGATE_WA_DELIVERABILITY');
  assert.match(row.reason, /whitelist=REPORT_ONLY/);
});

test('buildDispatchPlan: WA red below escalation threshold stays as INVESTIGATE_WA_DELIVERABILITY', () => {
  const audit = {
    id: 'a2',
    metric_name: 'wa_delivery_failure_rate_14d',
    severity: 'red',
    value: 50, // below 60 threshold
    suggested_action: 'INVESTIGATE_WA_DELIVERABILITY',
    details: { denom: 20, failed: 10 },
    created_at: new Date().toISOString(),
  };
  const plan = buildDispatchPlan({
    audits: [audit], reportOnly: false, cap: 3, budgetSpent: 0, budgetCap: 100,
  });
  assert.equal(plan.downgraded.length, 1);
  const row = plan.downgraded[0];
  assert.equal(row.escalated, false);
  assert.equal(row.suggested_action, 'INVESTIGATE_WA_DELIVERABILITY');
  assert.equal(row.original_action, undefined);
});

test('buildDispatchPlan: non-WA red is unaffected by escalation logic', () => {
  const audit = {
    id: 'a3',
    metric_name: 'sent_rate_24h',
    severity: 'red',
    value: 0,
    suggested_action: 'INVESTIGATE_SEND_PIPELINE',
    details: {},
    created_at: new Date().toISOString(),
  };
  const plan = buildDispatchPlan({
    audits: [audit], reportOnly: false, cap: 3, budgetSpent: 0, budgetCap: 100,
  });
  assert.equal(plan.downgraded.length, 1);
  assert.equal(plan.downgraded[0].escalated, false);
});

// ── 4. Sanity: escalateIfNeeded re-export is the same fn ─────

test('escalateIfNeeded re-exported from morning_briefing matches lib source', () => {
  assert.equal(typeof escalateIfNeeded, 'function');
  const out = escalateIfNeeded({
    metric_name: 'wa_delivery_failure_rate_14d',
    severity: 'red',
    value: 100,
    details: { denom: 45 },
  });
  assert.equal(out?.suggested_action, 'DISABLE_WA_CHANNEL_TEMP');
});

console.log(`\n[briefing_staleness] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
