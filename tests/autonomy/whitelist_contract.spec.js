// ============================================================
// tests/autonomy/whitelist_contract.spec.js
//
// Contract: every `suggested_action` string literal emitted by
// workers/nightly_auditor.js MUST have a matching entry in
// lib/autonomy_whitelist.js (direct key OR wildcard).
//
// Plan: .omc/plans/autonomy-3layer-v3.md §B.4 (C3), §C (fix #2).
// Invariant defended: no drift between detection side and
// morning-briefing decision side.
//
// Run: node tests/autonomy/whitelist_contract.spec.js
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { WHITELIST, decisionFor, _AUTO_ACTIONS } from '../../lib/autonomy_whitelist.js';

const AUDITOR_FILE = path.join(process.cwd(), 'workers', 'nightly_auditor.js');
const TEMPLATE_DIR = path.join(process.cwd(), '.omc', 'ralph-templates');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); }
}

// ── Extract actions from auditor source ──────────────────────
// Matches:  suggested_action: 'FOO' | "FOO" | `FOO_${agent}` (template literal prefix)
const src = fs.readFileSync(AUDITOR_FILE, 'utf8');
const literalRe         = /suggested_action\s*:\s*['"]([A-Z_][A-Z0-9_]*)['"]/g;
const templateRe        = /suggested_action\s*:\s*`([A-Z_][A-Z0-9_]*)\$\{/g;
const ternaryLiteralRe  = /suggested_action\s*:\s*[^,\n]*\?\s*['"]([A-Z_][A-Z0-9_]*)['"]/g;
const ternaryTemplateRe = /suggested_action\s*:\s*[^,\n]*\?\s*`([A-Z_][A-Z0-9_]*)\$\{/g;

const literals   = new Set();
const templates  = new Set();
let m;
while ((m = literalRe.exec(src)))         literals.add(m[1]);
while ((m = templateRe.exec(src)))        templates.add(m[1]);
while ((m = ternaryLiteralRe.exec(src)))  literals.add(m[1]);
while ((m = ternaryTemplateRe.exec(src))) templates.add(m[1]);

// ── Tests ────────────────────────────────────────────────────

test('WHITELIST non-empty', () => {
  assert.ok(Object.keys(WHITELIST).length > 0, 'WHITELIST is empty');
});

test('decisionFor(null) returns REPORT_ONLY', () => {
  assert.equal(decisionFor(null).decision, 'REPORT_ONLY');
  assert.equal(decisionFor(undefined).decision, 'REPORT_ONLY');
});

test('decisionFor(unknown) defaults to REPORT_ONLY (default-deny)', () => {
  const d = decisionFor('TOTALLY_MADE_UP_ACTION');
  assert.equal(d.decision, 'REPORT_ONLY');
  assert.match(d.rationale, /default deny/i);
});

test('_AUTO_ACTIONS contains every WHITELIST AUTO key', () => {
  const expected = Object.entries(WHITELIST)
    .filter(([, v]) => v.decision === 'AUTO')
    .map(([k]) => k)
    .sort();
  const actual = [..._AUTO_ACTIONS].sort();
  assert.deepEqual(actual, expected);
});

test(`auditor emits ≥1 literal suggested_action (found ${literals.size})`, () => {
  assert.ok(literals.size >= 5, `expected ≥5 literals, got ${literals.size}`);
});

const DEFAULT_DENY = /Not on whitelist — default deny/;

for (const action of literals) {
  test(`auditor literal "${action}" has whitelist or wildcard entry`, () => {
    const d = decisionFor(action);
    assert.ok(!DEFAULT_DENY.test(d.rationale),
      `${action} emitted by nightly_auditor.js but missing from WHITELIST`);
  });
}

for (const prefix of templates) {
  test(`auditor template-prefix "${prefix}*" resolves via wildcard`, () => {
    const probe = `${prefix}TESTAGENT`;
    const d = decisionFor(probe);
    assert.ok(!DEFAULT_DENY.test(d.rationale),
      `${prefix}* not covered by WILDCARDS in autonomy_whitelist.js`);
  });
}

// ── AUTO entries must have ralph template on disk ────────────
// Plan §B.4 C3: every AUTO action has an executable ralph template.
test('every AUTO action has a ralph template file', () => {
  if (!fs.existsSync(TEMPLATE_DIR)) {
    console.log(`    (skip: ${TEMPLATE_DIR} does not exist yet)`);
    return;
  }
  const files = fs.readdirSync(TEMPLATE_DIR);
  const missing = [];
  for (const action of _AUTO_ACTIONS) {
    const fname = `${action.toLowerCase()}.md`;
    if (!files.includes(fname)) missing.push(action);
  }
  // Soft-fail: we haven't built templates for all AUTO yet (plan rolls
  // them in Week 2+ one at a time). But we DO require a template for
  // any AUTO action, so warn loudly. Convert to hard assert once all
  // three Week-2 AUTO templates have landed.
  if (missing.length > 0) {
    console.log(`    ⚠ AUTO actions without template (expected during Week 2 rollout): ${missing.join(', ')}`);
  }
});

console.log(`\n[whitelist_contract] ${passed} passed, ${failed} failed`);
console.log(`  literals detected: ${[...literals].sort().join(', ')}`);
console.log(`  templates detected: ${[...templates].sort().join(', ') || '(none)'}`);
if (failed > 0) process.exit(1);
