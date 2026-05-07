# LLM Council Transcript — Empírika Aliveness Plan

**Date:** 2026-05-07
**Audience:** Brian (Empírika owner)
**Methodology:** [Karpathy LLM Council](https://x.com/karpathy) · 5 advisors parallel → anonymized peer review → chairman synthesis

---

## Original question

Brian (Empírika owner) said his 11 LLM agents "feel like code and cron jobs, not alive". He asked for a Hermes-inspired implementation plan and a council pass.

## Framed question

Empírika (Latino-owned-business marketing agency) wants its 11 LLM agents to "feel alive" not "code + cron jobs". The architect's plan: `agent_observations` time-series table + `runtime.observe()`/`recall()` helpers (Phase 1, 1wk), surgical skip guards on Scout/Helena/Manager/DaVinci (Phase 2, 1-2wk), reactive worker (Phase 3, 2-3wk).

**Forced binary on Phase 3 trigger source:**
- Supabase Realtime on `outreach_events` (1-3s latency, hostile Render connections), OR
- Queue table polled every 15s (slower, observable, replayable, costs one more worker)

Three goals (continuity, restraint, reactivity) with measurable thresholds.

---

## Round 1 — 5 advisors, parallel

### The Contrarian — Vote: QUEUE

This plan does not fix aliveness — still code + cron, just better plumbed. Specific holes:
1. The 80% recall metric is a lie waiting to happen — "references prior memory" trivially passes if SELECT happened. Define recall as *behavior changed because of memory* or drop the metric.
2. Skip guards on Scout and Helena are dangerous — Scout's job is discovery; "no new work" is the failure mode. 30% skip means 30% fewer leads sourced. Ghost-skip detector reactive — owner notices after a dry week.
3. Realtime is documented as fragile in the architect's own plan — voting for fragility.
4. No rollback for Phase 2 handler edits. Kill switch when Manager skips real replies?

**Vote: Queue.** 15s latency fine, observable, replayable, survives Render restarts. Pick boring.

### The First Principles Thinker — Vote: QUEUE

"Feels alive" is a perception problem dressed up as engineering. Plan addresses continuity/reactivity/restraint, but would owner FEEL different after 6 weeks? Probably not.

"Alive" is downstream of **visible inner life**. A human watching `Scout fired at 09:00` feels machinery; a human watching *"Scout: Skipping — Helena already enriched these 14 leads yesterday in Miami"* feels a colleague.

Ship a first-person `agent_narrative` view over `agent_observations` in week 1, not week 6. That's 80% of "alive" for almost no cost.

**Vote: Queue.** 18s with readable trail > 2s black box. Observability and replayability ARE the product here.

### The Expansionist — Vote: REALTIME

This plan is built like a maintenance project. It should be built like a launchpad.
1. The observations table IS the product — proprietary behavioral graph of Latino-owned businesses, sellable as "Empírika Intelligence" data layer.
2. Reactivity <60s isn't a UX win, it's a category shift — record one Loom of Manager replying at 2am, that closes client #2-#4.
3. "Skipped — no new work" is genius — productize it. Agencies bill for activity; you'll bill for judgment.

**Vote: Realtime.** Queue is safe choice for a business that doesn't exist yet. "We poll every 15 seconds" is a forever-ceiling on the story you can tell.

### The Outsider — Vote: QUEUE

Plan fixes latency, not aliveness. I have no idea who any of these 11 agents are. Angela, Manager, Helena, Kai, Sam, Carlos, Verifier, Scout, DaVinci, Estratega, Davinci. **DaVinci appears twice — typo or two agents?**

"Alive" usually means each one has a recognizable voice, opinions, visible reactions. None of the 3 goals measure that. Continuity at <100ms with 80% memory references — an agent can quote yesterday's note and still feel like a script. Aliveness is when Helena disagrees with Kai, when Scout flags something nobody asked about, when Manager says "I already tried that Tuesday and it failed."

**Vote: Queue.** Build the boring queue. Spend the saved weeks making agents have personalities the owner can name.

### The Executor — Vote: QUEUE (not close)

Monday morning concrete:
- Phase 1 is 3-4 days not a week. CREATE TABLE + helpers + sprinkle calls.
- Phase 2 guards are 5-line `SELECT count(*) FROM agent_observations WHERE agent=$1 AND created_at > now() - interval '6 hours'` checks. ~2h per agent, all 4 in a week.
- Phase 3 isn't 2-3 weeks of code — it's 150 lines and one file. Risk is operations, not code.

**Vote: Queue, not close.** Realtime on Render = long-lived WS that Render kills, reconnect storms, missed events, zero replay. Queue = `pending_reactions` row inserted by Postgres trigger on `outreach_events`, worker `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 10` every 15s. Replayable, observable, survives restarts.

**First PR Monday:** migration for `agent_observations` + `pending_reactions` + the trigger together. Both tables so Phase 3 isn't blocked.

---

## Round 2 — 5 peer reviews, anonymized parallel

Anonymization mapping (revealed for transcript):
- A = Outsider
- B = Contrarian
- C = First Principles Thinker
- D = Expansionist
- E = Executor

### Reviewer 1
- **Strongest:** C — only response that operationalizes "alive" into a buildable Monday artifact (`agent_narrative` view).
- **Biggest blind spot:** D — premature monetization of a behavioral graph that hasn't logged its first row.
- **All missed:** Nobody challenged the 11-agent count (only A noted DaVinci-twice, didn't push). Nobody asked who the audience for "alive" is.

### Reviewer 2
- **Strongest:** E — only response that converts plan into Monday-morning code (`FOR UPDATE SKIP LOCKED`, trigger, both migrations together).
- **Biggest blind spot:** D — selling "Empírika Intelligence" when client #1's agents don't feel alive yet and there are zero replies in production.
- **All missed:** Show the owner the current `agent_events` stream rendered as first-person narrative *before* building anything. If that already feels alive, Phase 1 is a UI problem, not a schema problem.

### Reviewer 3
- **Strongest:** C — operationalizes "alive" testable this week. "18s with readable trail > 2s black box" reframes binary correctly.
- **Biggest blind spot:** D — wants to sell product before single agent has demonstrated judgment. Ignores Render-WS-fragility raised by B and E.
- **All missed:** Who reads the observations? Without a human or agent consuming the trail, agent_observations becomes a write-only log = "code + cron" failure mode.

### Reviewer 4
- **Strongest:** C — diagnoses category error correctly, proposes cheapest concrete artifact.
- **Biggest blind spot:** D — invented scope (Empírika is a marketing agency not a data product); dodges binary by voting Realtime on narrative grounds, not technical.
- **All missed:** If DaVinci really appears twice, the roster itself is incoherent. If agents read each other's observations, THAT'S the real Phase 1.

### Reviewer 5
- **Strongest:** C — diagnoses "engineering plan for a perception problem", proposes the cheapest concrete artifact.
- **Biggest blind spot:** D — romanticizes Realtime as category shift, ignores fragility raised by B and E. <60s vs 15s invisible to Caleb.
- **All missed:** Spanish-only/Latino-owned-ICP constraint that differentiates the agency. The forced binary hid the real question: who is the observer?

### Convergence
- 4/5 picked **C (First Principles)** as strongest
- **5/5 picked D (Expansionist) as biggest blind spot**
- 3/5 flagged the 11-agent roster as unchallenged
- 4/5 said the council never asked WHO READS the observations
- Vote tally on §6 forced binary: **Queue 4, Realtime 1**

---

## Chairman synthesis

### Where the Council Agrees
- **Latency is not the bottleneck.** 15s vs 1-3s is invisible to the actual observer (the owner, the demo, the client).
- **Observability and replayability are load-bearing**, not nice-to-haves. Render kills long-lived WebSockets.
- **"Alive" is a perception problem, not a latency problem.** The cheapest path to "feels alive" is a first-person narrative view over `agent_observations`, shipped in week 1.
- **Phase 1 is smaller than the architect scoped.** 3-4 days, not a week. Both migrations in one PR including the `pending_reactions` trigger.

### Where the Council Clashes
The only real clash is **D (Expansionist) vs everyone else**. D voted Realtime on narrative grounds — Queue caps the story you can tell, agent_observations is a sellable behavioral-graph product.

The reasonable read: D optimizes for *narrative weight* — a Loom of Manager replying at 2am closes clients #2-#4.

The reason 5/5 reviewers flagged D as the blind spot: monetizing a graph that hasn't logged its first row, on infrastructure flagged as fragile, for a business that doesn't match the invented scope. D dodged the technical binary on narrative grounds.

Secondary clash: **B (Contrarian) on skip guards.** Scout's job IS discovery; 30% skip = 30% fewer leads. Deserves a guardrail (skip-rate alarm, not just ghost-skip detection).

### Blind Spots the Council Caught
1. **Nobody asked who reads the observations.** Reviewers 3 and 5. Without a defined consumer, `agent_observations` becomes a write-only log = "code + cron" failure mode.
2. **The 11-agent roster lists DaVinci twice.** Outsider noted; Reviewers 1 and 4 escalated. Roster is incoherent — more pressing fix than infrastructure choice.
3. **Render the existing `agent_events` stream as first-person narrative *before* building Phase 1.** Reviewer 2's sharpest point.
4. **If agents read each other's observations, that IS Phase 1.** Reviewer 4. Aliveness is inter-agent, not per-agent.

### The Recommendation
**Build the Queue. Ship the narrative view in week 1, not week 6.**

Use Executor's plan: one migration creating `agent_observations` + `pending_reactions` + the Postgres trigger on `outreach_events`. Worker polls with `SELECT … FOR UPDATE SKIP LOCKED LIMIT 10` every 15s. 150 lines, survives Render restarts.

Same week — build the first-person `agent_narrative` view. The actual buyer cannot perceive 2s vs 18s, but absolutely perceives the difference between "Scout fired at 09:00" and "Scout: skipping — Helena already enriched these 14 leads in Miami yesterday."

Defer Expansionist's "Empírika Intelligence" data-product vision. Wrong now — zero replies to brag about, council unanimous on this being weakest move.

Add Contrarian's missing guardrail: skip-rate alarm on Scout. If skip > 40% for 24h, page the owner.

### The One Thing to Do First
**Before writing the migration, render the last 7 days of `agent_events` as a first-person stream and read it on your phone for ten minutes.** If it already feels alive, the whole Phase 1 schema is the wrong fix — UI problem. If it feels like a log file, you've earned the migration — and now you know exactly what `agent_observations` needs to record.
