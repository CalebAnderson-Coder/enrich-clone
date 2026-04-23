// ============================================================
// tests/autonomy/wa_delivery_escalation.spec.js
//
// Unit tests for escalateIfNeeded() — the briefing-side helper
// that upgrades an INVESTIGATE_WA_DELIVERABILITY (red) row to
// DISABLE_WA_CHANNEL_TEMP when the sample is statistically
// significant and the failure rate is severe.
//
// Plan: .omc/plans/autonomy-3layer-v3.md §B.4 (A1 escalation).
// Boundary: denom≥10 AND rate>60 → escalate.
//
// Run: node tests/autonomy/wa_delivery_escalation.spec.js
// ============================================================

import assert from 'node:assert/strict';
import { escalateIfNeeded } from '../../lib/autonomy_whitelist.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); }
}

const mkRow = (overrides = {}) => ({
  metric_name: 'wa_delivery_failure_rate_14d',
  severity: 'red',
  value: 75,
  suggested_action: 'INVESTIGATE_WA_DELIVERABILITY',
  details: { denom: 40, failed: 30 },
  ...overrides,
});

// ── null / ignorable inputs ──────────────────────────────────

test('null input → null', () => {
  assert.equal(escalateIfNeeded(null), null);
});

test('undefined input → null', () => {
  assert.equal(escalateIfNeeded(undefined), null);
});

test('wrong metric_name → null', () => {
  assert.equal(escalateIfNeeded(mkRow({ metric_name: 'sent_rate_24h' })), null);
});

test('non-red severity → null (yellow)', () => {
  assert.equal(escalateIfNeeded(mkRow({ severity: 'yellow' })), null);
});

test('non-red severity → null (green)', () => {
  assert.equal(escalateIfNeeded(mkRow({ severity: 'green' })), null);
});

test('non-red severity → null (error)', () => {
  assert.equal(escalateIfNeeded(mkRow({ severity: 'error' })), null);
});

// ── denom boundary (≥10) ─────────────────────────────────────

test('denom=9 (below threshold) → null even if rate=100', () => {
  const out = escalateIfNeeded(mkRow({ details: { denom: 9 }, value: 100 }));
  assert.equal(out, null);
});

test('denom=10 + rate=75 → escalate', () => {
  const out = escalateIfNeeded(mkRow({ details: { denom: 10 }, value: 75 }));
  assert.ok(out, 'expected escalation');
  assert.equal(out.suggested_action, 'DISABLE_WA_CHANNEL_TEMP');
  assert.equal(out.severity, 'red');
  assert.match(out.rationale, /denom=10/);
  assert.match(out.rationale, /rate=75/);
});

// ── rate boundary (>60, strict) ──────────────────────────────

test('rate=60 (on boundary, strictly not greater) → null', () => {
  const out = escalateIfNeeded(mkRow({ value: 60, details: { denom: 20 } }));
  assert.equal(out, null);
});

test('rate=60.01 (just above) → escalate', () => {
  const out = escalateIfNeeded(mkRow({ value: 60.01, details: { denom: 20 } }));
  assert.ok(out);
  assert.equal(out.suggested_action, 'DISABLE_WA_CHANNEL_TEMP');
});

test('rate=61 with denom=15 → escalate', () => {
  const out = escalateIfNeeded(mkRow({ value: 61, details: { denom: 15 } }));
  assert.ok(out);
  assert.equal(out.suggested_action, 'DISABLE_WA_CHANNEL_TEMP');
});

// ── extreme case: 45/45 WA failure (real incident motivating v3) ─

test('real-incident shape (45/45 failures, 100%) → escalate', () => {
  const out = escalateIfNeeded(mkRow({ value: 100, details: { denom: 45, failed: 45 } }));
  assert.ok(out);
  assert.equal(out.suggested_action, 'DISABLE_WA_CHANNEL_TEMP');
  assert.match(out.rationale, /denom=45/);
  assert.match(out.rationale, /rate=100/);
});

// ── defensive: missing/malformed fields ──────────────────────

test('missing details → treated as denom=0 → null', () => {
  const out = escalateIfNeeded({ ...mkRow(), details: undefined });
  assert.equal(out, null);
});

test('missing value → treated as 0 → null', () => {
  const out = escalateIfNeeded({ ...mkRow(), value: undefined });
  assert.equal(out, null);
});

test('string numbers in details (coercion) → escalate when valid', () => {
  const out = escalateIfNeeded(mkRow({ details: { denom: '20' }, value: '75' }));
  assert.ok(out, 'Number() coercion should allow escalation');
});

console.log(`\n[wa_delivery_escalation] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
