// ============================================================
// tests/autonomy/outreach_channel_split.spec.js
//
// V4 (plan §B.2 A3): outreach_channel_split_24h severity table.
//
//   green   ← email_sends≥5 AND wa_sends≥5 AND combined≥10
//   red     ← combined<3
//   yellow  ← everything else (includes XOR and low-volume)
//
// This file mirrors the exact logic in workers/nightly_auditor.js
// (search: "V4. outreach_channel_split_24h") so threshold drift on
// either side breaks the build.
//
// Run: node tests/autonomy/outreach_channel_split.spec.js
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); }
}

// ── Reference implementation of the plan §B.2 A3 table ───────
// Any change here MUST be mirrored in workers/nightly_auditor.js,
// and vice versa. The source-inspection test below guards both.
function classifyChannelSplit(email, wa) {
  const combined = email + wa;
  if (combined < 3) return 'red';
  if (email >= 5 && wa >= 5 && combined >= 10) return 'green';
  return 'yellow';
}

// ── Hard threshold rows ──────────────────────────────────────

const cases = [
  // [email, wa, expected, description]
  [0, 0, 'red',    'nothing sent'],
  [1, 1, 'red',    'combined=2 still below red floor'],
  [2, 0, 'red',    'combined=2 email-only'],
  [1, 2, 'yellow', 'combined=3 at red boundary → yellow'],
  [3, 0, 'yellow', 'email=3, wa=0 — XOR below green floor'],
  [5, 5, 'green',  'exact green boundary'],
  [6, 4, 'yellow', 'combined≥10 but wa<5 → yellow'],
  [4, 6, 'yellow', 'combined≥10 but email<5 → yellow'],
  [20, 0, 'yellow', 'high email, zero wa (XOR paralysis) → yellow'],
  [0, 20, 'yellow', 'high wa, zero email (XOR paralysis) → yellow'],
  [10, 10, 'green', 'healthy split'],
  [5, 5, 'green',   'min green exact'],
];

for (const [email, wa, expected, desc] of cases) {
  test(`email=${email} wa=${wa} → ${expected} (${desc})`, () => {
    assert.equal(classifyChannelSplit(email, wa), expected);
  });
}

// ── Guard: plan-mandated channel paralysis detection ────────
// The 45/45 WhatsApp failure + 0 email cycles that motivated v3
// should land as red (combined<3) once dispatcher stops sending.
test('real v3-motivating scenario: 0 email + 0 wa → red', () => {
  assert.equal(classifyChannelSplit(0, 0), 'red');
});

test('suggested_action only fires on red', () => {
  // Mirror of auditor line ~449: red → INVESTIGATE_WA_CHANNEL_PARALYSIS, else null.
  const actionFor = sev => sev === 'red' ? 'INVESTIGATE_WA_CHANNEL_PARALYSIS' : null;
  assert.equal(actionFor(classifyChannelSplit(0, 0)),  'INVESTIGATE_WA_CHANNEL_PARALYSIS');
  assert.equal(actionFor(classifyChannelSplit(5, 5)),  null);
  assert.equal(actionFor(classifyChannelSplit(3, 3)),  null); // yellow → null
});

// ── Source-inspection guard: auditor must still import `combined<3` red rule ─

test('auditor source contains the three threshold constants', () => {
  const file = path.join(process.cwd(), 'workers', 'nightly_auditor.js');
  const src = fs.readFileSync(file, 'utf8');
  // Find the V4 block.
  const block = src.slice(src.indexOf("outreach_channel_split_24h"));
  assert.match(block, /combined\s*<\s*3/, 'red floor combined<3 missing');
  assert.match(block, /email\s*>=\s*5/, 'green gate email≥5 missing');
  assert.match(block, /wa\s*>=\s*5/,    'green gate wa≥5 missing');
  assert.match(block, /combined\s*>=\s*10/, 'green gate combined≥10 missing');
  assert.match(block, /min_volume_for_green:\s*10/, 'plan §B.2 A3 detail field missing');
});

console.log(`\n[outreach_channel_split] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
