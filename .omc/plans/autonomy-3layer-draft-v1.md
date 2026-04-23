# RALPLAN-DR + Plan: enrich-clone 3-Layer Autonomous Improvement System

## Section A — RALPLAN-DR Summary

### Principles (5)

1. **Detection and action are separated.** Layer 1 is pure SQL with zero LLM calls; only Layer 2 decides whether to spend tokens. This bounds worst-case cost even if thresholds mis-fire.
2. **Actions are whitelisted, not inferred.** Auto-dispatch is driven by a static `(suggested_action → decision)` table. Anything unknown is report-only. The LLM never picks actions, it picks *how to execute a pre-declared one*.
3. **Tournament selection requires an offline benchmark.** Real email traffic takes days and is production-critical; candidate evaluation must run against a frozen historical corpus (N=100 leads) judged by an LLM-as-judge rubric. Cost and variance are bounded per candidate.
4. **Ralph gate is sacred, env is human-approved.** Any code change goes through ralph review; any Render env var change is a diff-for-approval, never auto-applied.
5. **Observability comes before autonomy.** Week 1 is report-only. Auto-dispatch unlocks one whitelist entry at a time, with explicit ack rows in `autonomy_audits`.

### Decision Drivers (top 3)

1. **Autonomy-vs-blast-radius.** Empírika is a *live paying pilot*. A bad self-edit that breaks real-send email costs Caleb trust and revenue. Driver wins: every auto-dispatch must be revertible by a single `git revert`, and sealed files cover all send paths.
2. **Cost-vs-signal under a tight pilot budget.** 11 agents × 4 cycles/day already burn tokens. A continuous LLM auditor would double spend for marginal gain. Driver wins: Layer 1 is pure SQL on Render (near-zero marginal cost); LLM only wakes up on-demand in the morning.
3. **Feedback-loop speed vs statistical validity.** With <1/day outreach events post-flip, waiting for real conversion data gives stale signal. Driver wins: offline benchmarks become the primary fitness function; real-traffic A/B is a confirmation pass, not a selection mechanism.

### Viable Options

**Option A — Recommended: Render-side SQL auditor + Claude morning ritual + on-demand self-improve**
- Pros: Zero-marginal-cost 24/7 detection; Claude tokens only on human-in-the-loop mornings; leverages existing `manager-daemon.js` cron plumbing; whitelist rule table is auditable; gradual rollout contains blast radius.
- Cons: Detection-only value on Render — if Brian skips mornings, yellow signals age; two-system complexity; offline benchmark requires initial 100-lead corpus curation.

**Option B — Alternative: Pure Render + n8n orchestration, no Claude in the loop**
- Pros: Fully 24/7 true autonomy; zero Claude API cost; deterministic JSON rule engine.
- Cons: Cannot generate code fixes — only toggle flags or run pre-canned scripts; n8n becomes new cost center (violates rule 6); cannot reason about novel franchises; losing the ralph reviewer gate is a hard no.
- **Invalidation rationale:** Cannot satisfy Goal Layer 3 (self-improvement of code). Rejected.

**Option C — Hybrid: Render durable-cron Claude with minimal wake-ups** (deferred as Week 5+ upgrade)
- Pros: Briefing runs even when Brian doesn't open a session; preserves all Option A gates.
- Cons: Adds `ANTHROPIC_API_KEY` + budget to Render (new env var, needs approval); without interactive session, fully unattended ralph runs double required safeguards; harder to debug.
- **Verdict:** Keep as explicit Week-5+ upgrade path.

**Recommended: Option A, with Option C flagged as future upgrade gated on Week 1–4 operational stability.**

### Pre-mortem — 3 Failure Scenarios

**S1 — Silent audit failure for weeks.** Cron throws on Supabase schema drift. No row written → morning briefing says "all green." Fleet degrades 3 weeks undetected.
- Detection: Heartbeat row. Auditor MUST write `metric_name='AUDITOR_HEARTBEAT'` row every run regardless of sub-query failures. Morning briefing first-line check: "last heartbeat <36h ago?" If not, print red banner.
- Recovery: SMTP email to `SMTP_USER` on any auditor exception (existing SMTP config already in render.yaml). Brian re-runs auditor manually; root-cause fix via ralph.

**S2 — Auto-dispatch budget blow-up.** Monday morning, 12 unacked audits from weekend. Even with `max 3 per session`, dispatched ralph runs open sonnet sub-agents burning ~$15 each. Brian hits $50/day surprise.
- Detection: Pre-flight token estimator. Before dispatch, briefing multiplies "estimated tokens × model rate" and compares to `OMC_DAILY_BUDGET_USD` env var (default $25). Stop on breach.
- Recovery: Hard kill via `/oh-my-claudecode:cancel`; add spent budget to `autonomy_audits.details.budget_spent_usd`.

**S3 — Self-improve regresses real-send email silently.** Tournament selects "winner" prompt for Helena that scores better on rubric but subtly breaks Spanish-only invariant (judge missed a `"Hi there,"` fallback). Change lands; real emails go out in English for 18h.
- Detection: Layer 1 metric `spanish_only_violation_count_24h` fires RED within 24h; pre-merge gate stronger: `self-improve` must run hard-coded `spanishOnlyLinter` on any candidate prompt *and on 10 sample drafts it generates* before promoting.
- Recovery: `git revert` the offending commit. Sealed-files list + linter gate is primary defense; Layer 1 metric is backstop.

### Expanded Test Plan (deliberate mode)

**Unit tests** (`tests/autonomy/`):
- `metric_calculators.test.js` — one test per metric, fixtures in `tests/fixtures/outreach_events_sample.json`
- `severity_classifier.test.js` — given value + thresholds, returns correct green/yellow/red
- `whitelist_rule_engine.test.js` — given `(suggested_action, severity)`, returns correct `AUTO | REPORT_ONLY | BLOCKED`
- `budget_guard.test.js` — simulated token-cost estimator caps at configured budget
- `spanish_only_linter.test.js` — 20 positive (Spanish) + 20 negative (English/mixed) samples

**Integration tests:**
- `nightly_auditor.integration.test.js` — local Supabase, seed 48h synthetic events, run auditor, assert rows written
- `morning_briefing.integration.test.js` — seed audits, run briefing in DRY_RUN mode, assert correct dispatch decisions

**E2E (staging) tests:**
- Deploy Layer 1 to staging Render for 72h with `AUTONOMY_ENABLED=true` on separate staging brand_id. Briefing in `REPORT_ONLY=true`. Assert: 3 heartbeat rows, no auto-dispatches, Brian confirms actionability.
- Canary first whitelist entry (`ADD_TO_FRANCHISE_BLOCKLIST`) with synthetic franchise signal; verify ralph dispatches, lands PR on feature branch, Brian approves, merge, next-day audit confirms metric normalized.

**Observability:**
- Every auditor run emits `DAEMON_CYCLE` event to `agent_events` with `event_type='AUDIT'`, status, duration_ms
- Morning briefing writes digest row to `autonomy_briefings` (id, session_id, read_count, dispatched_count, budget_spent_usd, created_at)
- **Alerting:** If `AUDITOR_HEARTBEAT` absent >36h, next morning briefing prints red banner; additional tiny Render cron 06:00 UTC sends SMTP if heartbeat stale
- Render logs 7d retention — no new log infra needed

---

## Section B — Full Plan

### B.1 Schema: `autonomy_audits`

New migration: `migrations/016_autonomy_audits.sql`.

```sql
CREATE TABLE IF NOT EXISTS public.autonomy_audits (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                     UUID NOT NULL REFERENCES public.brands(id),
  audit_run_id                 UUID NOT NULL,
  metric_name                  TEXT NOT NULL,
  value                        NUMERIC,
  severity                     TEXT NOT NULL CHECK (severity IN ('green','yellow','red','error')),
  suggested_action             TEXT,
  threshold_hit                TEXT,
  details                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at              TIMESTAMPTZ,
  acknowledged_by              TEXT,
  auto_dispatched_ralph_task_id TEXT,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audits_brand_created   ON public.autonomy_audits (brand_id, created_at DESC);
CREATE INDEX idx_audits_unacked_severity
  ON public.autonomy_audits (severity, created_at DESC)
  WHERE acknowledged_at IS NULL;
CREATE INDEX idx_audits_metric_created  ON public.autonomy_audits (metric_name, created_at DESC);

ALTER TABLE public.autonomy_audits ENABLE ROW LEVEL SECURITY;
```

**Retention:** 90 days of detail rows. Monthly rollup `autonomy_audits_monthly` deferred to Week 3+.

**Companion table** `autonomy_briefings`: id, brand_id, session_id, audits_read_count, audits_dispatched_count, budget_spent_usd, created_at.

**ASSUMPTION FLAG:** `public.brands` has `autonomous=true` flag (seen in manager-daemon.js:220). Architect verify.

### B.2 Metric Catalog (13 metrics)

| # | name | thresholds green/yellow/red | suggested_action |
|---|---|---|---|
| 1 | `sent_rate_24h` | ≥15 / 5-14 / <5 | `INVESTIGATE_SEND_PIPELINE` |
| 2 | `nuevo_to_sent_conversion_7d` | ≥40% / 15-39% / <15% | `REVIEW_ENRICHMENT_FUNNEL` |
| 3 | `contactado_to_reply_rate_14d` | ≥3% / 1-2.9% / <1% | `REVIEW_OUTREACH_COPY` |
| 4 | `franchise_block_rate_7d` | ≤10% / 11-25% / >25% | `ADD_TO_FRANCHISE_BLOCKLIST` |
| 5 | `industry_other_rate_7d` | ≤5% / 6-15% / >15% | `UPDATE_INDUSTRY_MAPPING` |
| 6 | `outreach_events_row_count_24h` | >20 / 1-20 / 0 | `VERIFY_LEARNING_ENABLED_FLAG` |
| 7 | `top_combos_freshness_hours` | <30 / 30-48 / >48 | `REVIEW_LEARNING_CONSOLIDATOR` |
| 8 | `agent_error_rate_24h` (per agent) | <2% / 2-10% / >10% | `INVESTIGATE_AGENT_{agent}` |
| 9 | `scrapling_latency_p95_24h` | <8s / 8-20s / >20s | `ADJUST_SCRAPLING_TIMEOUT` |
| 10 | `ghl_api_error_rate_24h` | <3% / 3-10% / >10% | `INVESTIGATE_GHL_API` |
| 11 | `twilio_send_rate_24h` | gated on MULTICHANNEL_ENABLED | `VERIFY_MULTICHANNEL_FLAG` |
| 12 | `spanish_only_violation_count_24h` | 0 / - / ≥1 | `SPANISH_VIOLATION_DETECTED` (always report-only, RED always) |
| 13 | `latino_signal_coverage_pct_7d` | ≥70% / 40-69% / <40% | `REVIEW_SCOUT_LATINO_SIGNALS` |

All SQL parameterized `:brand_id` and `:since = NOW() - INTERVAL '24 hours'` unless noted.

**ASSUMPTION FLAG:** Column names `email_draft_html`, `lead_magnets_data`, `industry`, `outreach_status` values (NUEVO/CONTACTADO/SENT) per current tools/email.js and tools/database.js. Architect verify casing/nesting.

### B.3 Nightly Auditor Spec

**File:** `workers/nightly_auditor.js`. Export `runNightlyAudit({ brandId, client? })` returning `{ run_id, metrics_written, errors }`.

**Contract:**
- Pure SQL via existing `supabase` client. **No LLM calls. No agent invocations.** Enforced by top-of-file comment + unit test asserting AgentRuntime not imported.
- Generates one `audit_run_id` UUID per call. All rows in run share it.
- Writes `AUDITOR_HEARTBEAT` row FIRST, value=NOW() epoch, severity=green. Always, even if subsequent queries fail.
- Each metric wrapped in try/catch. On failure writes row with `severity='error'`, `details.error=message`. Never aborts run.
- After all metrics: prunes rows older than 90d that are acknowledged.

**Hook into manager-daemon:** New cycle in `CYCLES`:
```js
{ hourUtc: 3, minuteUtc: 15, type: 'AUDIT' }
```
(minuteUtc support is small extension to `inHourWindow`.) **Clash:** existing Render validate-lead-domains-nightly at 03:00 UTC — stagger to 03:15.

New branch in `executeCycle`: `if (cycle.type === 'AUDIT') metadata.audit = await runNightlyAudit({ brandId });`

**Failure handling:** SQL failure → error-severity row. Top-level exception → `DAEMON_CYCLE` event status=error (existing code path). Heartbeat-staleness alert via separate tiny Render cron `scripts/check_audit_heartbeat.js` at 06:00 UTC sending SMTP. New render.yaml cron entry requires human approval (Iron Rule 5); included as proposed diff.

### B.4 Morning Briefing Ritual Spec

**Location:** new OMC skill at `C:/Users/Agencia IA/.claude/skills/empirika-briefing/SKILL.md`. Skill name: `empirika-briefing`. Trigger keyword: `"briefing"` when CWD is enrich-clone, or explicit `/oh-my-claudecode:empirika-briefing`.

Skill SKILL.md contains instructions; actual work via `scripts/morning_briefing.js`:
1. Connect Supabase via `SUPABASE_SERVICE_ROLE_KEY`.
2. `SELECT * FROM autonomy_audits WHERE brand_id=:b AND acknowledged_at IS NULL ORDER BY severity DESC, created_at DESC LIMIT 50`.
3. Fetch `MAX(created_at) WHERE metric_name='AUDITOR_HEARTBEAT'`; warn if >36h.
4. Print categorized report (red/yellow/green summary).
5. Emit machine-readable JSON block with dispatch plan.

Skill's LLM instructions then decide (per whitelist) whether to invoke `ralph` for each RED auto-dispatch row.

**Whitelist rule table** (in skill + duplicated in `scripts/morning_briefing.js` as source of truth):

| suggested_action | Decision | Rationale |
|---|---|---|
| `ADD_TO_FRANCHISE_BLOCKLIST` | AUTO | Single regex array edit in `tools/database.js` |
| `UPDATE_INDUSTRY_MAPPING` | AUTO | Adding Google type to existing map |
| `ADJUST_SCRAPLING_TIMEOUT` | AUTO | Numeric constant, reversible |
| `REVIEW_OUTREACH_COPY` | REPORT_ONLY | Touches agent prompts |
| `CHANGE_AGENT_PROMPT` | REPORT_ONLY | Violates safety posture until Week 4+ |
| `VERIFY_LEARNING_ENABLED_FLAG` | REPORT_ONLY | Env var — Iron Rule 5 |
| `VERIFY_MULTICHANNEL_FLAG` | REPORT_ONLY | Env var |
| `TOUCH_ENV_VAR` (generic) | REPORT_ONLY | Iron Rule 5 |
| `MIGRATE_DB_SCHEMA` | REPORT_ONLY | Destructive risk |
| `SPANISH_VIOLATION_DETECTED` | REPORT_ONLY (RED-BANNER) | Never auto-fix Spanish violations |
| `REVIEW_ENRICHMENT_FUNNEL` | REPORT_ONLY | Diagnosis first |
| `REVIEW_SCOUT_LATINO_SIGNALS` | REPORT_ONLY | Iron Rule 2 |
| `INVESTIGATE_AGENT_*` | REPORT_ONLY | |
| `INVESTIGATE_GHL_API` | REPORT_ONLY | External API |
| `INVESTIGATE_SEND_PIPELINE` | REPORT_ONLY | Send path sealed |
| `REVIEW_LEARNING_CONSOLIDATOR` | REPORT_ONLY | |

**Rate limits:**
- `MAX_DISPATCH_PER_SESSION=3` (hard cap).
- `MAX_CONCURRENT_RALPH=1` (serial; wait for ack before next).
- `BUDGET_CAP_USD=25/day` (queries `autonomy_briefings` for spent; if cumulative would exceed, downgrade AUTO → REPORT_ONLY).
- **Recursion guard:** prompt given to ralph includes `NEVER_DISPATCH_ANOTHER_RALPH_RUN`; env var `RALPH_SPAWNED_BY=morning_briefing` triggers ralph-level pre-check that refuses re-spawn.

**Ack model:**
- On dispatch: `UPDATE autonomy_audits SET auto_dispatched_ralph_task_id=:id, acknowledged_by='auto_dispatch' WHERE id=:row`.
- On ralph completion (success OR blocked): `UPDATE ... SET acknowledged_at=NOW()`.
- On budget-stop: `acknowledged_by='budget_stop'` set but `acknowledged_at` null → re-surfaces next morning.

**ralph prompt template** fixed per suggested_action. Example `ADD_TO_FRANCHISE_BLOCKLIST`:
```
Task: add following names to FRANCHISE_BLOCKLIST in tools/database.js: {{names}}
Files you may modify: tools/database.js ONLY.
Files you must not modify: anything else.
You must: (1) add entries to existing FRANCHISE_BLOCKLIST regex array, (2) run test suite, (3) open PR on feature branch, (4) DO NOT merge to master.
```

### B.5 `self-improve` Integration Spec

**Goal doc:** `.omc/self-improve/config/goal.md`:
```
Target: helena agent prompt optimization
Baseline metric: helena_email_draft_judge_score = 62 (offline benchmark)
Improvement threshold: +8 points absolute OR +15% relative (whichever larger)
Budget ceiling: $30/tournament run
Max wallclock: 60 minutes
```

**Benchmark strategy — Historical Replay + LLM Judge:**

1. **Corpus construction (one-time, Week 3):** `scripts/build_benchmark_corpus.js` pulls 100 historical leads from `campaign_enriched_data` where `outreach_status IN ('CONTACTADO','REPLIED','BOUNCED')` + `created_at > 30d ago`. Stratified: 40 REPLIED, 30 CONTACTADO-no-reply, 30 BOUNCED. Freeze to `.omc/self-improve/corpus/empirika_v1.jsonl`. Never mutate.

2. **Per-candidate eval:** for each of 100 leads:
   - Run candidate prompt with lead's actual enrichment data (no live send).
   - Feed draft to LLM judge (sonnet) with rubric: Spanish-only (0/1), persona-fit (0-5), specificity (0-5), Latino-signal respect (0-5), grammar (0-5). Max 21.
   - Hard-fail (score=0, candidate DQ'd) if Spanish-only=0 OR any forbidden English phrase from linter list appears.

3. **Cost per candidate:** ~100 drafts × (800 in + 300 out sonnet) + 100 judge calls (~1500 in + 100 out). ≈ $0.30–0.50/candidate. Tournament 3 rounds × 3 = ~$3–5/tournament.

4. **Selection gate:** winner must (a) beat baseline by ≥ threshold AND (b) pass `spanishOnlyLinter` 100% of 100 drafts AND (c) not regress any bottom-quartile rubric dim by >1 point.

5. **Promotion:** winner triggers ralph PR against master with diff. **Never auto-merges.** Brian reviews.

**Sealed files (self-improve must NOT modify):**
```
tools/email.js
tools/twilio.js
tools/baileysWhatsApp.js
tools/stripe.js (if present)
outreach_dispatcher.js
index.js (auth middleware + webhook routes)
render.yaml
.env*
migrations/**
supabase/**
scripts/validate_lead_domains.js
agents/manager-daemon.js
tools/database.js  (full file sealed for self-improve; editable only via morning briefing constrained templates)
```

Encoded in `.omc/self-improve/config/sealed_files.txt`; self-improve enforces allowlist check before any write.

**Stop conditions:**
- Max 5 tournament rounds per invocation.
- Max 3 candidates per round.
- Budget hard cap $30/run (configurable via goal.md).
- Auto-stop if last 2 consecutive rounds <2% improvement over prior best.
- Auto-stop if candidate triggers Spanish-only hard-fail rate >30% (early termination signal).

### B.6 Risk Register (10 risks)

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R1 | Silent auditor failure (S1) | M | H | Heartbeat + 36h SMTP alert + morning red banner |
| R2 | Budget blow-up from stale weekend queue (S2) | M | M | Pre-flight token estimator + per-session cap + daily budget check |
| R3 | Self-improve regresses Spanish invariant (S3) | L | Critical | Sealed files + hard Spanish-only linter gate + Layer 1 backstop metric |
| R4 | Whitelist misclassification auto-fixes wrong thing | L | H | Every auto-dispatch creates feature branch + PR, never merges; Brian approves |
| R5 | Corpus drift — 30d-old benchmarks no longer reflect current ICP | M | M | Corpus rebuilt every 60 days; version pinned in goal.md |
| R6 | LLM judge drift / bias (sonnet version change) | M | M | Pin judge model + rubric version in corpus file; log judge version |
| R7 | Franchise blocklist thrash — two runs add competing regexes | L | L | ralph template deduplicates against current file content |
| R8 | 03:00 UTC clash with validate-lead-domains-nightly | L | L | Move AUDIT to 03:15 UTC; both read-heavy SQL, no write contention |
| R9 | Supabase service-role-key exposure in new cron | L | Critical | Reuse existing `SUPABASE_SERVICE_ROLE_KEY`; no new secret |
| R10 | Brian skips mornings — yellow signals age | M | M | Week 5+ upgrade to Option C (durable Render-side briefing); tracked as follow-up |

### B.7 Rollout Sequence (4 Weeks)

**Week 1 — Build + deploy Layer 1. Briefing report-only.**
- D1-2: Write `migrations/016_autonomy_audits.sql` + apply via Supabase MCP.
- D2-3: Build `workers/nightly_auditor.js` + hook into manager-daemon AUDIT cycle at 03:15 UTC. Deploy.
- D3-4: Unit + integration tests on staging. Confirm 48h heartbeats + metric rows.
- D5: Create `empirika-briefing` skill (report-only). Brian runs each morning, validates actionability.
- D6-7: Tune thresholds based on real values. No auto-dispatches.

**Week 2 — Enable one auto-dispatch: `ADD_TO_FRANCHISE_BLOCKLIST`.**
- D1: Add ralph template for franchise blocklist. Test dispatch with synthetic yellow row.
- D2-3: Flip whitelist to AUTO. Budget cap $15/day for safety.
- D4-7: Observe. Log every dispatch in `autonomy_briefings`. End of week Brian reviews all PRs.

**Week 3 — Expand whitelist (+2) + first self-improve trial.**
- Add `UPDATE_INDUSTRY_MAPPING` and `ADJUST_SCRAPLING_TIMEOUT` to AUTO.
- Build benchmark corpus (100 leads stratified). Freeze.
- First `self-improve` run: target = scrapling_timeout_tuning (pure numeric, no prompt risk). Metric = `scrapling_latency_p95_24h` + success rate. Dry-run only; verify tournament mechanics.

**Week 4 — Full 3-layer on. First real self-improve on Helena prompt.**
- Authorize real self-improve tournament on Helena. 5 rounds max, $30 cap.
- Promoted winner lands as PR; Brian approves.
- End-of-week retro: measure improvement in `contactado_to_reply_rate_14d` (takes Week 5-7 to confirm statistically; use offline benchmark score as immediate signal).

### B.8 ADR

**Decision:** Adopt 3-layer: (1) zero-LLM SQL-only nightly auditor writing to `autonomy_audits`, (2) Claude-side morning briefing skill with static whitelist rule engine + strict budget guards, (3) on-demand `self-improve` with offline historical-replay + LLM-judge benchmark.

**Drivers:** autonomy vs blast-radius (dominant), cost vs coverage, feedback-loop speed vs statistical validity.

**Alternatives considered:**
- Pure Render + n8n (Option B) — rejected: cannot fulfill code-improvement goal, adds cost center.
- Render durable-cron Claude briefing (Option C) — deferred Week 5+ as upgrade.

**Why chosen:** Option A is only design satisfying all three goal layers while respecting every Iron Rule. Detection 24/7 near-zero cost; actions gated and reversible; learning bounded on synthetic corpora before touching real traffic.

**Consequences:**
- Upside: continuous improvement signal surfaces in Brian's morning ritual; small auto-fixes land without manual triage; cost-bounded by design.
- Downside: if Brian skips mornings, yellow signals age (mitigation: Option C upgrade path). Adds one Supabase table, one worker file, one skill, one benchmark corpus — ~350 LOC + 100 LOC tests.
- Dependency: LLM-judge scoring is fitness function for Layer 3; judge model version must be pinned.

**Follow-ups:**
1. Option C durable-cron upgrade eval (Week 5).
2. Monthly rollup table `autonomy_audits_monthly` (Week 3+).
3. Corpus rebuild every 60 days (automate once Week 4 proves stable).
4. Apply pattern to Kai, Sam, Davinci once Helena proves loop (Week 6+).
5. `autonomy_briefings` dashboard surface in Render dashboard for observability (defer).

---

## Assumption flags for Architect to verify

1. Exact columns of `campaign_enriched_data` (especially `industry`, `outreach_status` values, `lead_magnets_data` nesting).
2. `brands` table has `autonomous` (or similar) flag used by `getActiveBrands({ onlyAutonomous })`.
3. `agent_events.metadata` is right JSONB source for `tool='scrapling'`, `tool='ghl'` filters — may need dedicated field.
4. Ralph skill supports env-var-scoped recursion guard or we need to add one.
5. Render cron invocation for `scripts/check_audit_heartbeat.js` needs approval — included as proposed diff, not auto-applied.
