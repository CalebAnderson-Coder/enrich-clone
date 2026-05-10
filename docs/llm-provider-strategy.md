# LLM Provider Strategy — enrich-clone

> **Status:** Decision documented 2026-05-08 (BK-015).
> **Owner:** brian@doublemybookings.com
> **Source data:** `agent_events` Render production, last 7 days (2026-05-01 → 2026-05-08).

---

## TL;DR

**Decision: keep NVIDIA primary + Gemini fallback. Fix two specific bugs (BK-029, BK-030) that account for ~16% of NVIDIA failures. Re-evaluate in 30 days.**

Gemini-only is a viable Plan C if BK-029/BK-030 don't move success_rate above 70% by 2026-06-08.

---

## Production data (last 7 days)

Captured via:
```sql
-- distinct trace_ids that touched nvidia
SELECT COUNT(DISTINCT trace_id) FROM agent_events
WHERE metadata->>'provider' IN ('nvidia','NVIDIA')
  AND created_at > now() - interval '7 days';
-- → 206

-- nvidia primary success (run_completed/ok/no-fallback)
SELECT COUNT(*) FROM agent_events
WHERE event_type='run_completed'
  AND status='ok'
  AND metadata->>'fallback_used'='false'
  AND metadata->>'provider' IN ('nvidia','NVIDIA')
  AND created_at > now() - interval '7 days';
-- → 96

-- traces that fell back to Gemini after NVIDIA failed
SELECT COUNT(DISTINCT trace_id) FROM agent_events
WHERE event_type='run_completed'
  AND metadata->>'fallback_used'='true'
  AND metadata->>'provider'='Gemini'
  AND trace_id IN (
    SELECT trace_id FROM agent_events
    WHERE metadata->>'provider' IN ('nvidia','NVIDIA')
  )
  AND created_at > now() - interval '7 days';
-- → 139
```

| Metric | Value |
|---|---:|
| Distinct trace_ids touching NVIDIA | 206 |
| NVIDIA primary success (no fallback used) | 96 |
| Fell back to Gemini after NVIDIA fail | 139 |
| Terminal user-visible failures | **0** |
| **NVIDIA primary success rate** | **96 / 206 ≈ 46.6%** |
| Gemini fallback success rate (when invoked) | 100% |

### Error breakdown (357 `agent_error` events with provider=nvidia)

| Error message | is_429 | Count | % of errors |
|---|---|---:|---:|
| `429 status code (no body)` | true | 282 | 79% |
| `400 This model only supports single tool-calls at once!` | false | 32 | 9% |
| `401 status code (no body)` | false | 24 | 7% |
| `[QuotaCircuitBreaker:nvidia] OPEN — cooldown remaining` | true | 7 | 2% |
| Other | mixed | ~12 | 3% |

---

## Interpretation

1. **The fallback works.** Despite 46.6% NVIDIA primary success, the user sees zero terminal failures because Gemini 2.0-flash recovers every NVIDIA failure. The runtime path verified by `tests/smoke_llm_429_fallback.js` (BK-014) is the production safety net.

2. **NVIDIA failures are dominated by rate limits (282 of 357, 79%).** This is expected behavior on the free NVIDIA NIM tier — the circuit breaker (`lib/AgentRuntime.js:64-67`) already pauses NVIDIA for 5 min when 10 hits land in 60s. The 7 `cooldown remaining` events confirm the breaker is doing its job.

3. **NVIDIA 401s on prod (24 events) are NOT a local-only issue.** This contradicts the inventory note that 401s were thought to be local-only (missing env var). Possible causes:
    - Stale or rotated NVIDIA API key in Render env vars.
    - NVIDIA's auth gateway returning intermittent 401 under load.
    - Multiple workers sharing one key and hitting per-key concurrent-session limits.
   - **Action:** see Manual verification step (AC #4) below.

4. **NVIDIA rejects parallel tool-calls (32 events, 9%).** Llama-3.1-70B-instruct via NVIDIA NIM only supports one tool call per turn, but several agents (Manager, Scout, Carlos) emit multi-tool sequences. Each rejection costs a primary attempt and forces fallback. **Action:** new backlog item BK-030 (split parallel tool calls into sequential turns OR upgrade to NVIDIA model that supports parallel tools).

---

## Decision matrix

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Keep NVIDIA + Gemini fallback (current)** | 46.6% requests served by cheaper NVIDIA; cost savings vs Gemini-only; existing infra; circuit breaker handles bursts | 54% of requests pay double-call latency (NVIDIA fail → Gemini retry, ~+1-2s p50); 32 silent tool-call rejections weekly; 24 unexplained 401s | **CHOSEN — provisional 30 days** |
| B. Gemini-only (drop NVIDIA) | Simpler ops; lower p50 latency (no double-call); no auth-related noise; single rate-limit tier to manage | Loses ~46% of cheap NVIDIA inference; ties piloto to a single provider's pricing/availability; loses the diversification that the fallback architecture provides | Plan C if A's fixes don't lift success rate to ≥70% by 2026-06-08 |
| C. Gemini primary + NVIDIA fallback (`PRIMARY_LLM=gemini`) | NVIDIA only used when Gemini saturates; benefits from Gemini's higher reliability while still using NVIDIA when free | Same 32 tool-call problem when NVIDIA is invoked; minimal latency win because Gemini is already most calls | Not pursued — strictly dominated by B unless Gemini quotas become tight |

---

## Action items spawned by this audit

| ID | Action | Owner | Effort | Target |
|---|---|---|---|---|
| BK-029 | Investigate the 24 NVIDIA 401s — rotate key or contact NVIDIA NIM support | Brian | S | 2026-05-15 |
| BK-030 | Fix `400 This model only supports single tool-calls` — split parallel tool calls OR migrate to model with parallel tool support | Engineering | M | 2026-05-22 |
| BK-031 | Re-run this success_rate audit on 2026-06-08; if <70%, switch to Plan B (Gemini-only) | Brian | S | 2026-06-08 |
| BK-032 | Declare `NVIDIA_API_KEY: sync: false` in render.yaml (currently set manually outside IaC) | Brian | S | 2026-05-12 |

---

## Manual verification pending (AC #4)

This audit cannot autonomously confirm that `NVIDIA_API_KEY` in Render dashboard is the correct/non-stale value. **Brian must do one of the following on Render**:

1. **Render dashboard screenshot:** capture `agency-fleet-runtime` env vars showing `NVIDIA_API_KEY` populated (last 4 chars only) and save to `.omc/audit/nvidia-key-render-2026-05-08.png`.
2. **Curl from Render shell:** SSH into the running service or use Render's shell tab and run:
   ```bash
   curl -sw "\nHTTP %{http_code}\n" \
     -H "Authorization: Bearer $NVIDIA_API_KEY" \
     -d '{"model":"meta/llama-3.1-70b-instruct","messages":[{"role":"user","content":"hi"}]}' \
     -H "Content-Type: application/json" \
     https://integrate.api.nvidia.com/v1/chat/completions
   ```
   Expected: `HTTP 200`. If 401, the key is stale → rotate via NVIDIA NIM dashboard and update Render env var.

Append the result to this doc under `## Manual verification result` when done.

---

## render.yaml audit (AC #4 self-serve part)

Direct grep on `render.yaml` (2026-05-08):

```
$ grep -n "NVIDIA\|GEMINI" render.yaml
15:      - key: GEMINI_API_KEY
157:      - key: GEMINI_API_KEY
```

**Finding: `NVIDIA_API_KEY` is NOT declared in render.yaml.** Only `GEMINI_API_KEY` is gated as a sync:false secret.

Since prod logs show 96 successful NVIDIA primary calls in 7 days, the key MUST be set in Render's dashboard manually (outside the render.yaml IaC). This creates IaC drift:

- **Risk 1:** A fresh deploy from a new Render workspace would not propagate `NVIDIA_API_KEY` and the runtime would silently fall back to Gemini-only with no obvious indicator.
- **Risk 2:** When Brian rotates the key, the rotation only happens in Render dashboard; there is no IaC trail of the rotation cadence.
- **Risk 3:** A second tenant onboarded via the documented "spin up a separate service" pattern would forget to set `NVIDIA_API_KEY` and silently degrade to Gemini-only.

**New action item:** BK-032 — declare `NVIDIA_API_KEY` in `render.yaml` with `sync: false`. Effort: S. Owner: Brian (one-line PR + redeploy).

The remaining unknown is whether the actual *value* in Render dashboard is current — addressed in the manual step above.
