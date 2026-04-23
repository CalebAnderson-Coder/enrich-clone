// ============================================================
// lib/autonomy_whitelist.js — Single canonical source for the
// suggested_action → decision rule table consumed by both the
// morning briefing (dispatch plan) and the contract test.
//
// Plan: .omc/plans/autonomy-3layer-v3.md §B.4, C2.
// Sealed file (see .omc/self-improve/config/sealed_files.txt).
//
// Invariant: every `suggested_action` produced by
// workers/nightly_auditor.js MUST have a matching entry here.
// The whitelist contract test (tests/autonomy/whitelist_contract.spec.js)
// asserts this automatically.
// ============================================================

export const WHITELIST = {
  // ── AUTO (Week 2+ unlocks one at a time) ──────────────────
  ADD_TO_FRANCHISE_BLOCKLIST:   { decision: 'AUTO',        rationale: 'Single regex-array edit in tools/database.js' },
  UPDATE_INDUSTRY_MAPPING:      { decision: 'AUTO',        rationale: 'Adding Google type to existing map' },
  ADJUST_SCRAPLING_TIMEOUT:     { decision: 'AUTO',        rationale: 'Numeric constant, reversible' },

  // ── REPORT_ONLY ───────────────────────────────────────────
  REVIEW_DISPATCHER_HEALTH:     { decision: 'REPORT_ONLY', rationale: 'Touches dispatcher logic' },
  INVESTIGATE_DELIVERABILITY:   { decision: 'REPORT_ONLY', rationale: 'SMTP/DNS issue' },
  REVIEW_OUTREACH_COPY:         { decision: 'REPORT_ONLY', rationale: 'Touches agent prompts' },
  CHANGE_AGENT_PROMPT:          { decision: 'REPORT_ONLY', rationale: 'Until Week 4+' },
  VERIFY_LEARNING_ENABLED_FLAG: { decision: 'REPORT_ONLY', rationale: 'Env var (IR5)' },
  VERIFY_MULTICHANNEL_FLAG:     { decision: 'REPORT_ONLY', rationale: 'Env var (IR5)' },
  MIGRATE_DB_SCHEMA:            { decision: 'REPORT_ONLY', rationale: 'Destructive risk' },
  SPANISH_VIOLATION_DETECTED:   { decision: 'REPORT_ONLY', rationale: 'Never auto-fix (IR1)' },
  REVIEW_SCOUT_LATINO_SIGNALS:  { decision: 'REPORT_ONLY', rationale: 'IR2' },
  INVESTIGATE_GHL_API:          { decision: 'REPORT_ONLY', rationale: 'External API' },
  INVESTIGATE_SEND_PIPELINE:    { decision: 'REPORT_ONLY', rationale: 'Send path sealed' },
  REVIEW_LEARNING_CONSOLIDATOR: { decision: 'REPORT_ONLY', rationale: 'Diagnostic first' },
  ESCALATE_LLM_QUOTA:           { decision: 'REPORT_ONLY', rationale: 'Requires Brian billing/env action (IR5/IR6)' },

  // ── v3 iter-2 additions (plan §B.2 A1, A5) ────────────────
  INVESTIGATE_WA_DELIVERABILITY: { decision: 'REPORT_ONLY', rationale: 'WA delivery anomaly — business-level decision' },
  DISABLE_WA_CHANNEL_TEMP:       { decision: 'REPORT_ONLY', rationale: 'Escalated from WA red; red-banner only, never auto-fix' },
  WHATSAPP_SPANISH_VIOLATION:    { decision: 'REPORT_ONLY', rationale: 'Spanish-only invariant (IR1) — never auto-fix' },
  INVESTIGATE_WA_CHANNEL_PARALYSIS: { decision: 'REPORT_ONLY', rationale: 'Zero-volume split — requires diagnosis first' },
};

// Wildcard matchers applied in order; first hit wins.
const WILDCARDS = [
  { pattern: /^INVESTIGATE_AGENT_/, decision: 'REPORT_ONLY', rationale: 'Agent-level diagnosis first' },
];

export function decisionFor(suggested_action) {
  if (!suggested_action) return { decision: 'REPORT_ONLY', rationale: 'no suggested_action' };
  const direct = WHITELIST[suggested_action];
  if (direct) return direct;
  for (const w of WILDCARDS) {
    if (w.pattern.test(suggested_action)) return { decision: w.decision, rationale: w.rationale };
  }
  return { decision: 'REPORT_ONLY', rationale: 'Not on whitelist — default deny' };
}

// ── A1 escalation helper (plan §B.4) ─────────────────────────
// When V1 (wa_delivery_failure_rate_14d) is RED AND sample has
// statistical weight (denom>=10) AND failure rate is severe (>60%),
// escalate the REPORT_ONLY action to DISABLE_WA_CHANNEL_TEMP.
//
// The escalation is a briefing-side concern (Layer 2), not a
// nightly-auditor row (retired V2). Keeps detection separated
// from action recommendation.
export function escalateIfNeeded(auditRow) {
  if (!auditRow) return null;
  if (auditRow.metric_name !== 'wa_delivery_failure_rate_14d') return null;
  if (auditRow.severity !== 'red') return null;
  const denom = Number(auditRow.details?.denom ?? 0);
  const rate  = Number(auditRow.value ?? 0);
  if (denom >= 10 && rate > 60) {
    return {
      suggested_action: 'DISABLE_WA_CHANNEL_TEMP',
      rationale: `V1 red + denom=${denom} + rate=${rate}% → escalated`,
      severity: 'red',
    };
  }
  return null;
}

export const _AUTO_ACTIONS = Object.entries(WHITELIST)
  .filter(([, v]) => v.decision === 'AUTO')
  .map(([k]) => k);
