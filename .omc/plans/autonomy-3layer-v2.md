# RALPLAN-DR + Plan: enrich-clone Layered Autonomy System (v2)

> **Honest framing:** This is **layered detection with human-gated remediation** — Layer 1 fully autonomous on Render (zero LLM cost), Layers 2–3 human-assisted via Brian's morning Claude session until the Week 5+ Option C upgrade lands a durable Render-side briefing. Earlier draft mislabeled the system "3-layer autonomous"; that overpromised. The architecture below is unchanged in substance, only correctly named.

## Section A — RALPLAN-DR Summary

### Principles (5)

1. **Detection and action are separated.** Layer 1 is pure SQL with zero LLM calls; only Layer 2 decides whether to spend tokens.
2. **Actions are whitelisted, not inferred.** Auto-dispatch is driven by a static `(suggested_action → decision)` table.
3. **Tournament selection requires an offline benchmark.** Real email traffic is too slow and too production-critical; candidate evaluation runs against a frozen historical corpus judged by an LLM rubric.
4. **Ralph gate is sacred, env is human-approved.** Every code change goes through ralph review; every Render env var change is a diff-for-approval.
5. **Observability comes before autonomy.** Week 1 is report-only. Auto-dispatch unlocks one whitelist entry at a time.

### Decision Drivers (top 3)

1. **Autonomy-vs-blast-radius.** Empírika is a live paying pilot. Every auto-dispatch must be revertible by a single `git revert`; sealed files cover all send paths.
2. **Cost-vs-signal under tight pilot budget.** Layer 1 is pure SQL (near-zero marginal cost); LLM only wakes on Brian's mornings.
3. **Feedback-loop speed vs statistical validity.** With <1/day outreach events post-flip, real-traffic A/B is too slow; offline benchmarks are the primary fitness function.

### Viable Options

**Option A — Recommended: Render-side SQL auditor + Claude morning ritual + on-demand self-improve**
- Pros: Zero-marginal-cost 24/7 detection; Claude tokens only on human-in-the-loop mornings; leverages existing `manager-daemon.js` cron plumbing; whitelist rule table is auditable; gradual rollout contains blast radius.
- Cons: Layer 2/3 value is gated on Brian opening sessions; if he skips mornings, yellow signals age until Option C lands.

**Option B — Pure Render + n8n orchestration, no Claude in the loop**
- Cons: Cannot generate code fixes; n8n becomes new cost center (violates IR6); cannot reason about novel franchises; loses ralph reviewer gate.
- **Invalidation rationale:** Cannot satisfy code-improvement goal. Rejected.

**Option C — Render durable-cron Claude with minimal wake-ups** (deferred Week 5+)
- **Steel-man (Critic-strengthened):** This is the *only* mode that delivers continuous improvement when Brian travels or runs full days of client calls. Adding `ANTHROPIC_API_KEY` to Render is not a design flaw — it's a one-time env var ask gated by IR5. The "process friction" objection from v1 was thin. Real reason to defer: we do not yet have operational data on how often Layer 2 *should* fire, so we'd be sizing a budget cap blind. Week 5+ uses the Week 1–4 metric history to size Option C correctly.
- **Verdict:** Explicit Week 5 upgrade path with sized budget once we have 4 weeks of `autonomy_briefings` data.

**Recommended: Option A → Option C upgrade in Week 5 (no longer "deferred indefinitely").**

### Pre-mortem — 3 Failure Scenarios

**S1 — Silent audit failure for weeks.** Cron throws on schema drift; no row written; morning briefing says "all green."
- Detection: `AUDITOR_HEARTBEAT` row written FIRST every run, regardless of sub-query failures. Morning briefing first-line check: heartbeat <36h or red banner.
- Recovery: Separate Render cron at 06:00 UTC sends SMTP if heartbeat stale (existing `SMTP_USER` config in render.yaml).

**S2 — Auto-dispatch budget blow-up.** Monday morning, 12 unacked weekend audits; cap-of-3 still spawns ralph runs at ~$15 each → surprise $50 day.
- Detection: Pre-flight token estimator. Before each dispatch, multiply `estimated_tokens × model_rate`; compare to `OMC_DAILY_BUDGET_USD` (default $25); halt on breach.
- Implementation sketch: estimator = `tiktoken` count of ralph prompt × 1.5 multiplier for tool calls × $0.015/1k input + $0.075/1k output (sonnet rates). Cumulative spend pulled from `autonomy_briefings.budget_spent_usd` for current UTC day.
- Recovery: Hard kill via `/oh-my-claudecode:cancel`; record spend in `autonomy_briefings`.

**S3 — Self-improve regresses Spanish-only invariant.** Tournament winner subtly breaks Spanish-only (judge missed `"Hi there,"` fallback); real emails go in English for 18h.
- Detection: **Pre-merge gate uses `lib/spanishOnlyLinter.js`** (NEW PREREQ — see B.0). Linter runs on candidate prompt + 10 sample drafts the candidate generates. Layer 1 metric `spanish_only_violation_count_24h` (Metric 12) is the production backstop, not the only line.
- Recovery: `git revert`. Sealed files + linter gate is primary defense.

### Expanded Test Plan (deliberate mode)

**Unit tests** (`tests/autonomy/`):
- `metric_calculators.test.js` — one test per metric, fixtures use real enum values
- `severity_classifier.test.js` — green/yellow/red boundary tests
- `whitelist_rule_engine.test.js` — `(suggested_action, severity) → AUTO|REPORT_ONLY|BLOCKED`
- `budget_guard.test.js` — token estimator caps at configured budget
- `spanish_only_linter.test.js` — 20 Spanish positive + 20 English/mixed negative

**Integration tests:**
- `nightly_auditor.integration.test.js` — local Supabase, seed 48h synthetic events with REAL enum, run auditor, assert rows written
- `morning_briefing.integration.test.js` — seed audits, run briefing in DRY_RUN, assert dispatch decisions

**E2E (staging):**
- 72h on staging Render (`AUTONOMY_ENABLED=true` on staging brand_id, `REPORT_ONLY=true`). Assert 3 heartbeats, no auto-dispatches, Brian confirms actionability.
- Canary `ADD_TO_FRANCHISE_BLOCKLIST` with synthetic franchise signal; ralph dispatches → PR on feature branch → Brian approves → merge → next-day audit confirms metric normalized.

**Observability:**
- Every auditor run emits `agent_events` row `event_type='AUDIT'`, status, duration_ms.
- Morning briefing writes to `autonomy_briefings` (id, session_id, read_count, dispatched_count, budget_spent_usd, created_at).
- Heartbeat staleness >36h → red banner + SMTP.
- Render logs 7d retention — no new log infra.

---

## Section B — Full Plan

### B.0 Prerequisite Tasks (must land BEFORE Week 1)

These two artifacts are referenced throughout the plan but do not exist in repo today. Build first.

**P1. `lib/spanishOnlyLinter.js`** (~80 LOC)
- Export `lintSpanishOnly(text) → { ok: boolean, violations: string[] }`.
- Rules: (a) no English forbidden phrases (`"Hi there,"`, `"Hey,"`, `"Best regards,"`, `"Thanks,"`, ~30 entries), (b) Spanish-character ratio ≥30% non-ASCII letters OR contains ≥3 Spanish stop-words from frozen list, (c) URL-only edge case allowed.
- Tests: 20 Spanish + 20 English/mixed samples in `tests/fixtures/spanish_linter/`.
- Used by: morning briefing pre-merge gate (B.5), self-improve hard-fail gate.

**P2. Ralph recursion guard** (`scripts/ralph_recursion_guard.js` + integration)
- Mechanism: `scripts/morning_briefing.js` writes lock file `.omc/state/ralph-spawn-lock` containing `{spawned_by, parent_pid, ts}` BEFORE invoking ralph.
- Ralph template prompt includes hard instruction: "**DO NOT spawn another ralph or autopilot run. Pre-check `.omc/state/ralph-spawn-lock` exists; if so, this is a constrained sub-run — refuse any sub-spawn.**"
- Pre-spawn bash hook in template: `node scripts/ralph_recursion_guard.js check` exits non-zero if lock present and current PID isn't whitelisted.
- Briefing removes lock on ralph completion (success or failure).

Both are sub-1-day builds, untracked-budget, but block any auto-dispatch flip.

### B.1 Schema: `autonomy_audits`

Migration: `migrations/016_autonomy_audits.sql`.

```sql
CREATE TABLE IF NOT EXISTS public.autonomy_audits (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                      UUID NOT NULL REFERENCES public.brands(id),
  audit_run_id                  UUID NOT NULL,
  metric_name                   TEXT NOT NULL,
  value                         NUMERIC,
  severity                      TEXT NOT NULL CHECK (severity IN ('green','yellow','red','error')),
  suggested_action              TEXT,
  threshold_hit                 TEXT,
  details                       JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at               TIMESTAMPTZ,
  acknowledged_by               TEXT,
  auto_dispatched_ralph_task_id TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audits_brand_created   ON public.autonomy_audits (brand_id, created_at DESC);
CREATE INDEX idx_audits_unacked_severity
  ON public.autonomy_audits (severity, created_at DESC)
  WHERE acknowledged_at IS NULL;
CREATE INDEX idx_audits_metric_created  ON public.autonomy_audits (metric_name, created_at DESC);

ALTER TABLE public.autonomy_audits ENABLE ROW LEVEL SECURITY;
```

**Retention:** 90 days. Monthly rollup deferred to Week 3+.

**Companion table** `autonomy_briefings`: id, brand_id, session_id, audits_read_count, audits_dispatched_count, budget_spent_usd, created_at.

**Autonomy gate:** `brand_quota.warmup_stage >= 1` per `lib/supabase.js:227-248` (corrected from v1's incorrect `brands.autonomous` reference). Auditor only runs for brands matching this gate; reuse `getActiveBrands({ onlyAutonomous: true })`.

### B.2 Metric Catalog (12 metrics — Metric 3 redefined)

Real `outreach_status` enum per `lib/guardrails.js:100-101` and `tools/database.js:41,585`:
`PENDING / APPROVED / SENT / CONTACTED / BOUNCED / SEND_FAIL / SMTP_ERROR / DELIVERY_FAILED`.
`industry` lives on `leads` table (JOIN required), not `campaign_enriched_data`.
**There is NO `REPLIED` enum value.** Reply tracking lives in inbound webhook (currently unconfirmed pipeline).

| # | name | source / SQL shape | thresholds green/yellow/red | suggested_action |
|---|---|---|---|---|
| 1 | `sent_rate_24h` | `campaign_enriched_data` count where `outreach_status='SENT'` last 24h | ≥15 / 5-14 / <5 | `INVESTIGATE_SEND_PIPELINE` |
| 2 | `approved_to_sent_conversion_7d` | ratio APPROVED→SENT in 7d (replaces v1 `nuevo_to_sent`) | ≥80% / 50-79% / <50% | `REVIEW_DISPATCHER_HEALTH` |
| 3 | **REVISED:** `sent_to_failure_rate_14d` | (BOUNCED + SEND_FAIL + SMTP_ERROR + DELIVERY_FAILED) / SENT, 14d | ≤5% / 6-15% / >15% | `INVESTIGATE_DELIVERABILITY` |
| 3b | **DEFERRED:** `sent_to_reply_rate_14d` | requires reply pipeline; **add ONLY after `inbound_replies` table exists** (separate prereq tracked in follow-ups) | n/a | n/a |
| 4 | `franchise_block_rate_7d` | scout reject reason='franchise' / total scouted, 7d | ≤10% / 11-25% / >25% | `ADD_TO_FRANCHISE_BLOCKLIST` |
| 5 | `industry_other_rate_7d` | JOIN `leads.industry='other'` count / total enriched, 7d | ≤5% / 6-15% / >15% | `UPDATE_INDUSTRY_MAPPING` |
| 6 | `outreach_events_row_count_24h` | `outreach_events` row count last 24h | >20 / 1-20 / 0 | `VERIFY_LEARNING_ENABLED_FLAG` |
| 7 | `top_combos_freshness_hours` | NOW - MAX(updated_at) on top_combos table | <30 / 30-48 / >48 | `REVIEW_LEARNING_CONSOLIDATOR` |
| 8 | `agent_error_rate_24h` per agent | `agent_events` group by agent where status='error' | <2% / 2-10% / >10% | `INVESTIGATE_AGENT_{agent}` |
| 9 | `scrapling_latency_p95_24h` | `agent_events` where `tool='scrapling'` (Architect confirmed first-class column) | <8s / 8-20s / >20s | `ADJUST_SCRAPLING_TIMEOUT` |
| 10 | `ghl_api_error_rate_24h` | `agent_events` where `tool='ghl'` and status='error' | <3% / 3-10% / >10% | `INVESTIGATE_GHL_API` |
| 11 | `twilio_send_rate_24h` | gated on MULTICHANNEL_ENABLED | (informational) | `VERIFY_MULTICHANNEL_FLAG` |
| 12 | `spanish_only_violation_count_24h` | `lib/spanishOnlyLinter` over outbound `email_draft_html` last 24h | 0 / - / ≥1 | `SPANISH_VIOLATION_DETECTED` (always RED, REPORT_ONLY) |
| 13 | `latino_signal_coverage_pct_7d` | scout enrichment with latino_signal!=null / total | ≥70% / 40-69% / <40% | `REVIEW_SCOUT_LATINO_SIGNALS` |

All SQL parameterized `:brand_id` and time windows.

### B.3 Nightly Auditor Spec

**File:** `workers/nightly_auditor.js`. Export `runNightlyAudit({ brandId, client? })` returning `{ run_id, metrics_written, errors }`.

**Contract:**
- Pure SQL via `supabase` client. **No LLM, no agent invocations.** Enforced by top-of-file comment + unit test asserting `AgentRuntime` is not imported.
- One `audit_run_id` UUID per call.
- Writes `AUDITOR_HEARTBEAT` row FIRST, value=NOW() epoch, severity=green. Always.
- Each metric in try/catch. On failure: severity='error', `details.error=message`. Never aborts run.
- After all metrics: prunes acknowledged rows >90d.

**Hook into manager-daemon:** New cycle in `CYCLES`:
```js
{ hourUtc: 3, minuteUtc: 15, type: 'AUDIT' }
```
`minuteUtc` is a small extension to `inHourWindow` (manager-daemon.js:204-213). 03:15 UTC chosen to stagger from `validate-lead-domains-nightly` (separate Render service at 03:00 — Architect confirmed no contention, but staggered for log clarity).

New branch in `executeCycle`: `if (cycle.type === 'AUDIT') metadata.audit = await runNightlyAudit({ brandId });`

**Heartbeat-staleness alert:** new tiny Render cron `scripts/check_audit_heartbeat.js` at 06:00 UTC sends SMTP via existing `SMTP_USER`. **render.yaml diff included as proposed change requiring Brian approval (IR5).** Pattern matches existing `validate-lead-domains-nightly` cron — same Render free-tier slot, no new cost center.

### B.4 Morning Briefing Ritual Spec

**Skill location decision:** Skill lives at `C:\Users\Agencia IA\.claude\skills\empirika-briefing\SKILL.md`.
- Trade-off: this couples the workflow to Brian's machine (`Agencia IA` user).
- Mitigation: companion copy at `enrich-clone/.omc/skills/empirika-briefing-ref.md` (portable reference, can be re-installed on a second machine via single command).
- **Risk acknowledged in R10:** single-machine dependency until Option C removes the human-trigger requirement entirely.

Skill calls `scripts/morning_briefing.js`:
1. Connect via `SUPABASE_SERVICE_ROLE_KEY`.
2. `SELECT * FROM autonomy_audits WHERE brand_id=:b AND acknowledged_at IS NULL ORDER BY severity DESC, created_at DESC LIMIT 50`.
3. `SELECT MAX(created_at) WHERE metric_name='AUDITOR_HEARTBEAT'`; warn if >36h.
4. Print categorized report.
5. Emit JSON dispatch plan.

**Whitelist rule table** (skill + duplicated in `scripts/morning_briefing.js`):

| suggested_action | Decision | Rationale |
|---|---|---|
| `ADD_TO_FRANCHISE_BLOCKLIST` | AUTO | Single regex array edit in `tools/database.js` |
| `UPDATE_INDUSTRY_MAPPING` | AUTO | Adding Google type to existing map |
| `ADJUST_SCRAPLING_TIMEOUT` | AUTO | Numeric constant, reversible |
| `REVIEW_DISPATCHER_HEALTH` | REPORT_ONLY | Touches dispatcher logic |
| `INVESTIGATE_DELIVERABILITY` | REPORT_ONLY | SMTP/DNS issue |
| `REVIEW_OUTREACH_COPY` | REPORT_ONLY | Touches agent prompts |
| `CHANGE_AGENT_PROMPT` | REPORT_ONLY | Until Week 4+ |
| `VERIFY_LEARNING_ENABLED_FLAG` | REPORT_ONLY | Env var (IR5) |
| `VERIFY_MULTICHANNEL_FLAG` | REPORT_ONLY | Env var |
| `MIGRATE_DB_SCHEMA` | REPORT_ONLY | Destructive |
| `SPANISH_VIOLATION_DETECTED` | REPORT_ONLY (RED-BANNER) | Never auto-fix |
| `REVIEW_SCOUT_LATINO_SIGNALS` | REPORT_ONLY | IR2 |
| `INVESTIGATE_AGENT_*` | REPORT_ONLY | |
| `INVESTIGATE_GHL_API` | REPORT_ONLY | External API |
| `INVESTIGATE_SEND_PIPELINE` | REPORT_ONLY | Send path sealed |
| `REVIEW_LEARNING_CONSOLIDATOR` | REPORT_ONLY | |

**Rate limits:**
- `MAX_DISPATCH_PER_SESSION=3`
- `MAX_CONCURRENT_RALPH=1` (serial)
- `BUDGET_CAP_USD=25/day` from `autonomy_briefings`; if cumulative would exceed, downgrade AUTO → REPORT_ONLY.
- **Recursion guard:** P2 spawn-lock + ralph template hard instruction (Architect confirmed no native ralph guard — P2 closes this).

**Ack model:**
- On dispatch: `auto_dispatched_ralph_task_id=:id, acknowledged_by='auto_dispatch'`.
- On ralph completion: `acknowledged_at=NOW()`.
- On budget-stop: `acknowledged_by='budget_stop'` set, `acknowledged_at` NULL → re-surfaces next morning.

**ralph prompt template** fixed per action. Example `ADD_TO_FRANCHISE_BLOCKLIST`:
```
Task: add following names to FRANCHISE_BLOCKLIST in tools/database.js: {{names}}
Files you may modify: tools/database.js ONLY.
Files you must not modify: anything else.
You must: (1) deduplicate against current FRANCHISE_BLOCKLIST contents, (2) add entries to existing regex array, (3) run test suite, (4) open PR on feature branch, (5) DO NOT merge to master.
Pre-check: run `node scripts/ralph_recursion_guard.js check` — abort if exits non-zero.
DO NOT spawn another ralph or autopilot run.
```

### B.5 `self-improve` Integration Spec

**Goal doc:** `.omc/self-improve/config/goal.md`:
```
Target: helena agent prompt optimization
Baseline metric: helena_email_draft_judge_score = 62 (offline benchmark)
Improvement threshold: +8 absolute OR +15% relative
Budget ceiling: $30/tournament run
Max wallclock: 60 minutes
```

**Benchmark — Historical Replay + LLM Judge:**

1. **Corpus construction (one-time, Week 3):** `scripts/build_benchmark_corpus.js` pulls 100 historical leads from `campaign_enriched_data` where `outreach_status IN ('SENT','CONTACTED','BOUNCED','SEND_FAIL')` AND `created_at > 30d ago` (corrected enum). Stratified: 40 SENT-positive-engagement (proxy: contacted ≥2x in GHL), 30 SENT-no-engagement, 30 BOUNCED/SEND_FAIL. Frozen to `.omc/self-improve/corpus/empirika_v1.jsonl`.

   **Contingency:** If real data yields <40 positive-engagement rows, **defer Helena self-improve to Week 5+** and run Week 4 as scrapling_timeout_tuning dry-run only. Block recorded as a rollout gate (B.7).

2. **Per-candidate eval:** for each of 100 leads:
   - Run candidate prompt with lead's actual enrichment data (no live send).
   - Feed draft to LLM judge (sonnet, version pinned in corpus header) with rubric: Spanish-only (0/1, **HARD-FAIL via P1 linter, not just judge**), persona-fit (0-5), specificity (0-5), Latino-signal respect (0-5), grammar (0-5). Max 21.
   - Hard-fail (DQ candidate) if linter `ok=false` on any draft.

3. **Cost per candidate:** ~$0.30–0.50; tournament ~$3–5/run.

4. **Selection gate:** winner must (a) beat baseline ≥ threshold AND (b) `spanishOnlyLinter` 100% pass on 100 drafts AND (c) no bottom-quartile rubric dim regresses >1.

5. **Promotion:** ralph PR against master. **Never auto-merges.** Brian reviews.

**Sealed files:**
```
tools/email.js
tools/twilio.js
tools/baileysWhatsApp.js
tools/stripe.js (if present)
outreach_dispatcher.js
index.js
render.yaml
.env*
migrations/**
supabase/**
scripts/validate_lead_domains.js
agents/manager-daemon.js
tools/database.js  (full file sealed for self-improve; editable only via morning briefing constrained templates)
lib/spanishOnlyLinter.js  (sealed — must not be self-modified)
```

`.omc/self-improve/config/sealed_files.txt` enforces allowlist before any write.

**Stop conditions:** max 5 rounds, 3 candidates/round, $30/run hard cap, auto-stop on <2% improvement over 2 rounds, auto-stop if Spanish hard-fail rate >30%.

### B.6 Risk Register (10 risks)

| # | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R1 | Silent auditor failure (S1) | M | H | Heartbeat row + 36h SMTP alert + morning red banner |
| R2 | Budget blow-up from stale weekend queue (S2) | M | M | Pre-flight token estimator + per-session cap + daily budget check |
| R3 | Self-improve regresses Spanish invariant (S3) | L | Critical | P1 `spanishOnlyLinter` hard-fail + sealed files + Layer 1 metric backstop |
| R4 | Whitelist misclassification auto-fixes wrong thing | L | H | Every dispatch creates feature branch + PR; never merges; Brian approves |
| R5 | Corpus drift — 30d-old benchmarks stale | M | M | Rebuild every 60 days; version pinned in goal.md |
| R6 | LLM judge drift / version change | M | M | Pin judge model + rubric version in corpus header |
| R7 | Franchise blocklist thrash | L | L | ralph template deduplicates against current file |
| R8 | 03:00 UTC clash with validate-lead-domains | L | L | Move AUDIT to 03:15 UTC; Architect confirmed separate services, no contention |
| R9 | Supabase service-role-key exposure | L | Critical | Reuse existing `SUPABASE_SERVICE_ROLE_KEY`; no new secret |
| R10 | Single-machine dependency (Brian skips mornings AND skill on Brian's laptop) | M | H | Companion ref at `.omc/skills/empirika-briefing-ref.md` enables re-install on second machine; **Option C upgrade in Week 5 removes the dependency entirely (no longer indefinitely deferred)** |

### B.7 Rollout Sequence (4 weeks + Week 5 upgrade)

**Week 0 (Prerequisites — ~2 days):**
- Build P1 `lib/spanishOnlyLinter.js` + tests.
- Build P2 `scripts/ralph_recursion_guard.js` + spawn-lock integration.
- Both must pass before Week 1 Day 1.

**Week 1 — Build + deploy Layer 1. Briefing report-only.**
- D1-2: `migrations/016_autonomy_audits.sql` via Supabase MCP.
- D2-3: `workers/nightly_auditor.js` + manager-daemon AUDIT cycle at 03:15 UTC. `minuteUtc` extension to `inHourWindow`.
- D3-4: Unit + integration tests; staging 48h; confirm heartbeats + metric rows.
- D5: Create `empirika-briefing` skill (report-only) + companion ref.
- D6-7: Tune thresholds. **Zero auto-dispatches.**

**Week 2 — One auto-dispatch unlocked: `ADD_TO_FRANCHISE_BLOCKLIST`.**
- D1: ralph template + synthetic yellow-row test.
- D2-3: Flip whitelist to AUTO. Budget cap $15/day.
- D4-7: Observe; log every dispatch in `autonomy_briefings`. EOW Brian reviews all PRs.

**Week 3 — Expand whitelist (+2) + benchmark corpus + first dry-run self-improve.**
- Add `UPDATE_INDUSTRY_MAPPING` + `ADJUST_SCRAPLING_TIMEOUT` to AUTO.
- Build benchmark corpus. **If positive-engagement rows <40, hard-stop Helena self-improve; only Week 4 scrapling-tuning dry-run.**
- First self-improve target: scrapling_timeout_tuning (numeric, no prompt risk). Verify tournament mechanics.

**Week 4 — First real self-improve on Helena prompt (corpus permitting).**
- 5 rounds max, $30 cap.
- Promoted winner → PR; Brian approves.
- EOW retro using **Day-30 binary success criteria (below)**.

**Week 5 — Option C upgrade evaluation.**
- Use Week 1–4 `autonomy_briefings` data to size durable-cron budget.
- Propose `ANTHROPIC_API_KEY` env var add to Render (IR5 approval).
- If approved, ship Render-side briefing cron; deprecate single-machine dependency.

### B.7.1 Day-30 Binary Success Criteria

Replaces v1's lagging `contactado_to_reply_rate_14d` signal with metrics that compute on real data inside the window:

- ✅ ≥20 nightly audit runs written to `autonomy_audits` (heartbeat health)
- ✅ ≥3 auto-dispatched PRs merged to master (signal Layer 2 produced real value)
- ✅ 0 `spanish_only_violation_count_24h` red events (IR1 held)
- ✅ 0 auditor silence windows >36h (S1 mitigation worked)
- ✅ ≥1 self-improve dry-run executed end-to-end without budget breach (Layer 3 mechanics validated)
- ✅ `autonomy_briefings.budget_spent_usd` cumulative < $200 across 30d (cost discipline)

Conversion-impact metrics (`sent_to_failure_rate_14d` improvement, eventually `sent_to_reply_rate_14d` once reply pipe lands) are explicit follow-ups for Day 60+.

### B.8 ADR

**Decision:** Adopt layered detection with human-gated remediation: (1) zero-LLM SQL-only nightly auditor → `autonomy_audits`, (2) Claude-side morning briefing skill with static whitelist + budget guards, (3) on-demand `self-improve` with offline historical-replay + LLM-judge benchmark. Plus prerequisites P1 (Spanish linter) and P2 (ralph recursion guard) before Week 1.

**Drivers:** autonomy vs blast-radius (dominant), cost vs coverage, feedback-loop speed vs statistical validity.

**Alternatives considered:**
- Option B (Pure Render + n8n) — rejected: cannot fulfill code-improvement goal, adds cost center.
- Option C (Render durable-cron Claude) — Week 5 upgrade with sized budget from Week 1–4 data. No longer indefinite defer.

**Why chosen:** Option A is the only design satisfying all three goal layers while respecting every Iron Rule, with Option C as the explicit graduation path that removes the single-machine dependency once we have operational data.

**Consequences:**
- Upside: continuous improvement signal; small auto-fixes land without manual triage; cost-bounded by design.
- Downside acknowledged: until Option C lands, Layers 2-3 require Brian's morning session; mitigation is the explicit Week 5 upgrade, not perpetual deferral.
- Footprint: 1 Supabase table (+ briefings table), 1 worker file, 1 skill, 2 prerequisite libs (linter, recursion guard), 1 benchmark corpus. ~450 LOC + ~150 LOC tests.
- Dependency: LLM-judge model version pinned in corpus header.

**Follow-ups:**
1. Option C durable-cron upgrade (Week 5 — sized).
2. Inbound reply pipeline build → enables `sent_to_reply_rate_14d` (separate plan).
3. Monthly rollup `autonomy_audits_monthly` (Week 3+).
4. Corpus rebuild every 60 days (auto-once Week 4 stable).
5. Pattern application to Kai/Sam/Davinci (Week 6+).
6. `autonomy_briefings` dashboard (defer).

---

## Changelog vs v1
- Renamed system: dropped "3-layer autonomous" → "layered detection with human-gated remediation."
- B.0 added: P1 Spanish linter + P2 ralph recursion guard prerequisites.
- B.1: corrected autonomy gate to `brand_quota.warmup_stage >= 1`.
- B.2: rewrote metric catalog with real `outreach_status` enum; redefined Metric 3 as `sent_to_failure_rate_14d`; deferred reply-rate metric (3b) to follow-up; corrected `industry` source to `leads` JOIN.
- B.5: corpus query uses real enum; added contingency for insufficient positive-engagement rows; sealed `lib/spanishOnlyLinter.js`.
- B.7: added Week 0 prerequisites; promoted Option C from indefinite-defer to Week 5 sized upgrade.
- B.7.1 added: Day-30 binary success criteria using metrics that compute on real data within the window.
- R10: rewritten with single-machine dependency acknowledgment + companion ref + Option C as definite mitigation path.
- Option C steel-man strengthened in Section A.
