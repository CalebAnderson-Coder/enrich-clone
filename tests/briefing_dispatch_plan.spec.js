// ============================================================
// tests/briefing_dispatch_plan.spec.js
//
// Week 2 D1 — synthetic-row test for the full briefing dispatch chain:
//   decisionFor → buildDispatchPlan → renderRalphPrompt
//
// Covers happy path (ADD_TO_FRANCHISE_BLOCKLIST auto-dispatch) plus the
// three guardrail downgrades (REPORT_ONLY flag, budget cap, session cap)
// and the non-whitelisted default-deny path.
//
// Run: node tests/briefing_dispatch_plan.spec.js
// ============================================================

import assert from 'node:assert/strict';
import { decisionFor, buildDispatchPlan, WHITELIST } from '../scripts/morning_briefing.js';
import { renderRalphPrompt, brandNameToRegex, escapeRegex } from '../scripts/ralph_template_renderer.js';

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    ()  => { console.log(`  ✓ ${name}`); passed++; },
    err => { console.error(`  ✗ ${name}\n    ${err.stack || err.message}`); failed++; },
  );
}

const mkAudit = (overrides = {}) => ({
  id: 'dfae2cad-0000-0000-0000-000000000001',
  metric_name: 'franchise_blocked_24h',
  value: 6,
  severity: 'red',
  suggested_action: 'ADD_TO_FRANCHISE_BLOCKLIST',
  threshold_hit: 'red',
  created_at: new Date().toISOString(),
  details: {
    brand_name: 'Chuck E. Cheese',
    evidence: 'Found in 6 cities, 12 leads flagged',
  },
  ...overrides,
});

// ─── decisionFor ───────────────────────────────────────────────

await test('decisionFor: ADD_TO_FRANCHISE_BLOCKLIST is AUTO', () => {
  assert.equal(decisionFor('ADD_TO_FRANCHISE_BLOCKLIST').decision, 'AUTO');
});

await test('decisionFor: SPANISH_VIOLATION_DETECTED is REPORT_ONLY (IR1)', () => {
  assert.equal(decisionFor('SPANISH_VIOLATION_DETECTED').decision, 'REPORT_ONLY');
});

await test('decisionFor: unknown action defaults to REPORT_ONLY', () => {
  const d = decisionFor('NUKE_EVERYTHING');
  assert.equal(d.decision, 'REPORT_ONLY');
  assert.match(d.rationale, /default deny/i);
});

await test('decisionFor: ESCALATE_LLM_QUOTA is REPORT_ONLY (IR5/IR6)', () => {
  assert.equal(decisionFor('ESCALATE_LLM_QUOTA').decision, 'REPORT_ONLY');
});

await test('decisionFor: INVESTIGATE_AGENT_* is REPORT_ONLY (wildcard)', () => {
  assert.equal(decisionFor('INVESTIGATE_AGENT_HELENA').decision, 'REPORT_ONLY');
});

// ─── buildDispatchPlan: happy path ────────────────────────────

await test('buildDispatchPlan: AUTO row in DISPATCH_ACTIVE produces one dispatch', () => {
  const audit = mkAudit();
  const plan = buildDispatchPlan({ audits: [audit], reportOnly: false, cap: 3, budgetSpent: 0, budgetCap: 25 });
  assert.equal(plan.mode, 'DISPATCH_ACTIVE');
  assert.equal(plan.dispatches.length, 1);
  assert.equal(plan.downgraded.length, 0);
  assert.equal(plan.dispatches[0].effective_decision, 'AUTO');
  assert.equal(plan.dispatches[0].audit_id, audit.id);
  assert.equal(plan.dispatches[0].suggested_action, 'ADD_TO_FRANCHISE_BLOCKLIST');
});

// ─── buildDispatchPlan: guardrails ────────────────────────────

await test('buildDispatchPlan: reportOnly flag downgrades every candidate', () => {
  const audit = mkAudit();
  const plan = buildDispatchPlan({ audits: [audit], reportOnly: true, cap: 3, budgetSpent: 0, budgetCap: 25 });
  assert.equal(plan.mode, 'REPORT_ONLY');
  assert.equal(plan.dispatches.length, 0);
  assert.equal(plan.downgraded.length, 1);
  assert.equal(plan.downgraded[0].effective_decision, 'REPORT_ONLY');
  assert.equal(plan.downgraded[0].reason, 'week1_report_only_flag');
});

await test('buildDispatchPlan: budget pre-flight blocks dispatch when cap would be exceeded', () => {
  const audit = mkAudit();
  // Worst-case $15/dispatch. spent + 1*15 > cap → downgrade.
  const plan = buildDispatchPlan({ audits: [audit], reportOnly: false, cap: 3, budgetSpent: 15, budgetCap: 25 });
  assert.equal(plan.dispatches.length, 0);
  assert.equal(plan.downgraded.length, 1);
  assert.equal(plan.downgraded[0].reason, 'budget_cap_pre_flight');
});

await test('buildDispatchPlan: session cap limits dispatches, extras downgraded', () => {
  const audits = [
    mkAudit({ id: 'a1' }),
    mkAudit({ id: 'a2' }),
    mkAudit({ id: 'a3' }),
    mkAudit({ id: 'a4' }),
  ];
  const plan = buildDispatchPlan({ audits, reportOnly: false, cap: 2, budgetSpent: 0, budgetCap: 100 });
  assert.equal(plan.dispatches.length, 2);
  assert.equal(plan.downgraded.length, 2);
  assert.ok(plan.downgraded.every(d => d.reason === 'session_dispatch_cap_hit'));
});

await test('buildDispatchPlan: non-AUTO candidate downgraded with whitelist reason', () => {
  const audit = mkAudit({
    suggested_action: 'SPANISH_VIOLATION_DETECTED',
    metric_name: 'spanish_only_violation_count_24h',
  });
  const plan = buildDispatchPlan({ audits: [audit], reportOnly: false, cap: 3, budgetSpent: 0, budgetCap: 25 });
  assert.equal(plan.dispatches.length, 0);
  assert.equal(plan.downgraded.length, 1);
  assert.equal(plan.downgraded[0].reason, 'whitelist=REPORT_ONLY');
});

await test('buildDispatchPlan: non-red rows never become candidates', () => {
  const yellow = mkAudit({ severity: 'yellow' });
  const green  = mkAudit({ severity: 'green',  id: 'g1' });
  const plan = buildDispatchPlan({ audits: [yellow, green], reportOnly: false, cap: 3, budgetSpent: 0, budgetCap: 25 });
  assert.equal(plan.dispatches.length, 0);
  assert.equal(plan.downgraded.length, 0);
});

// ─── renderRalphPrompt ────────────────────────────────────────

await test('brandNameToRegex: escapes dots and lowercases', () => {
  assert.equal(brandNameToRegex('Chuck E. Cheese'), '/\\bchuck e\\. cheese\\b/i');
});

await test('escapeRegex: escapes regex metacharacters', () => {
  assert.equal(escapeRegex('A+B.C'), 'A\\+B\\.C');
});

await test('renderRalphPrompt: interpolates all four variables from template', () => {
  const audit = mkAudit();
  const { prompt, variables, template_action } = renderRalphPrompt(audit);

  assert.equal(template_action, 'ADD_TO_FRANCHISE_BLOCKLIST');
  assert.equal(variables.brand_name, 'Chuck E. Cheese');
  assert.equal(variables.regex_pattern, '/\\bchuck e\\. cheese\\b/i');
  assert.equal(variables.audit_id, audit.id);
  assert.equal(variables.evidence, 'Found in 6 cities, 12 leads flagged');

  // Prompt must be the authoritative fenced block content (starts with ralph invocation).
  assert.match(prompt, /^\/oh-my-claudecode:ralph do:/);
  // Regex pattern substituted in step 2.
  assert.ok(prompt.includes('/\\bchuck e\\. cheese\\b/i'), 'prompt missing interpolated regex');
  // Brand name substituted in commit message.
  assert.ok(prompt.includes('"Chuck E. Cheese"'), 'prompt missing quoted brand name');
  // Audit id substituted in commit body.
  assert.ok(prompt.includes(audit.id), 'prompt missing audit_id');
  // Evidence substituted.
  assert.ok(prompt.includes('Found in 6 cities, 12 leads flagged'), 'prompt missing evidence');
  // Iron-rule protections survived.
  assert.match(prompt, /DO NOT remove or modify the Latino-owned disqualifier/);
  assert.match(prompt, /DO NOT edit \.env or render\.yaml/);
  assert.match(prompt, /do NOT force-push/);
});

await test('renderRalphPrompt: no unfilled mustache variables remain', () => {
  const audit = mkAudit();
  const { prompt } = renderRalphPrompt(audit);
  const leftover = prompt.match(/\{\{[a-z_]+\}\}/gi);
  assert.equal(leftover, null, `unfilled variables: ${leftover && leftover.join(',')}`);
});

await test('renderRalphPrompt: falls back to business_name when brand_name missing', () => {
  const audit = mkAudit({ details: { business_name: 'Planet Fitness', evidence: 'test' } });
  const { variables } = renderRalphPrompt(audit);
  assert.equal(variables.brand_name, 'Planet Fitness');
  assert.equal(variables.regex_pattern, '/\\bplanet fitness\\b/i');
});

await test('renderRalphPrompt: synthesizes evidence when audit.details.evidence missing', () => {
  const audit = mkAudit({
    metric_name: 'franchise_blocked_24h',
    details: { brand_name: 'Planet Fitness' },
  });
  const { variables } = renderRalphPrompt(audit);
  assert.match(variables.evidence, /metric franchise_blocked_24h/);
});

await test('renderRalphPrompt: throws on missing suggested_action', () => {
  assert.throws(() => renderRalphPrompt({ id: 'x', details: { brand_name: 'X' } }),
    /suggested_action required/);
});

await test('renderRalphPrompt: throws on missing brand_name', () => {
  const audit = mkAudit({ details: {} });
  assert.throws(() => renderRalphPrompt(audit), /brand_name required/);
});

await test('renderRalphPrompt: throws on unknown suggested_action (no template)', () => {
  const audit = mkAudit({ suggested_action: 'NONEXISTENT_ACTION' });
  assert.throws(() => renderRalphPrompt(audit), /template not found/);
});

// ─── End-to-end: plan + render together ───────────────────────

await test('e2e: AUTO dispatch plan + render produces ready-to-invoke ralph prompt', () => {
  const audit = mkAudit();
  const plan = buildDispatchPlan({ audits: [audit], reportOnly: false, cap: 3, budgetSpent: 0, budgetCap: 25 });
  assert.equal(plan.dispatches.length, 1);

  const dispatch = plan.dispatches[0];
  // Skill would re-hydrate the audit (from DB) before rendering; here we pass it directly.
  const { prompt } = renderRalphPrompt(audit);

  assert.equal(dispatch.effective_decision, 'AUTO');
  assert.ok(prompt.length > 200, 'prompt suspiciously short');
  assert.ok(prompt.includes(dispatch.audit_id), 'prompt should reference audit_id');
});

// ─── Summary ──────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
