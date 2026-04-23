# Ralph template — ADD_TO_FRANCHISE_BLOCKLIST

Used by the `empirika-briefing` skill to auto-dispatch a ralph run when the
nightly auditor surfaces a suspected franchise chain that Scout has let
through. This is the **first** suggested_action promoted to `decision=AUTO`
(Week 2 D2-3).

## Interpolation variables

The briefing skill MUST fill these before invoking ralph:

| Variable | Source | Example |
|---|---|---|
| `{{brand_name}}` | `audit.details.brand_name` | `"Planet Fitness"` |
| `{{regex_pattern}}` | Derived from brand_name (word-boundary, case-insensitive, escaped) | `/\bplanet fitness\b/i` |
| `{{audit_id}}` | `audit.id` (UUID) | `"dfae2cad-..."` |
| `{{evidence}}` | `audit.details.evidence` (e.g. match_count, sample_leads) | `"Found in 6 cities, 12 leads flagged"` |

## Ralph prompt (authoritative)

```
/oh-my-claudecode:ralph do:

1. In tools/database.js, locate the FRANCHISE_BLOCKLIST array (around line 153).
2. Add this regex at the end of the array, preserving alphabetical-ish order:
       {{regex_pattern}},
3. Do NOT remove or reorder any existing regex. Do NOT touch any other file.
4. Run: node tests/scout_franchise_gate.spec.js (or equivalent unit test that
   covers the FRANCHISE_BLOCKLIST). If no such test exists, write a minimal
   one-line assertion that "{{brand_name}}" is now rejected.
5. Commit message (conventional):
       feat(scout): block "{{brand_name}}" franchise chain
       Detected via autonomy_audits row {{audit_id}}. {{evidence}}.
6. Push to master (auto-deploys on Render).

HARD RULES — do NOT violate:
  - DO NOT remove or modify the Latino-owned disqualifier in agents/scout.js (IR2).
  - DO NOT touch any file under agents/, lib/supabase.js, or any migration.
  - DO NOT edit .env or render.yaml (IR5).
  - DO NOT add comments about "fixing an issue" or citing the audit row — keep
    the commit message referring to the business fact (chain blocked), not
    the automation that found it.
  - If the regex would shadow an existing entry (same chain, different spelling),
    stop and report — do not duplicate.

If ANY step fails (test, commit hook, push), abort and report — do NOT force-push,
do NOT --no-verify, do NOT --amend.
```

## Post-dispatch write-back (briefing skill responsibility)

After the ralph run reports success with a merged/pushed commit SHA:

```sql
UPDATE autonomy_audits
SET acknowledged_at = now(),
    acknowledged_by = 'briefing-{{session_id}}',
    auto_dispatched_ralph_task_id = '{{ralph_task_id}}'
WHERE id = '{{audit_id}}';
```

## Safeguards encoded in the prompt

- **IR2 (Latino-owned):** explicit `DO NOT remove` clause.
- **IR3 (no destructive git):** forbids `--no-verify`, `--amend`, force-push.
- **IR5 (Render config):** forbids `.env` / `render.yaml` edits.
- **Scope containment:** only `tools/database.js` + test file. No cascade refactors.
- **Commit hygiene:** conventional commits; commit message avoids referencing the
  autonomy machinery (so history remains readable to a new engineer).

## What triggers this template

The briefing skill dispatches this template when ALL of these are true:

1. `audit.severity === 'red'` AND `audit.suggested_action === 'ADD_TO_FRANCHISE_BLOCKLIST'`
2. `audit.details.brand_name` is non-empty
3. `decisionFor(action).decision === 'AUTO'` (Week 2+ whitelist)
4. `plan.budget.spent_usd + 15 <= plan.budget.cap_usd`
5. `scripts/ralph_recursion_guard.js check` exits 0
6. `audit.acknowledged_at IS NULL`

## Known good example

From a dry-run against a synthetic row (see `tests/briefing_dispatch_plan.spec.js`):

- `audit.details.brand_name = "Chuck E. Cheese"`
- Derived `regex_pattern = /\bchuck e\.? cheese\b/i`
- Resulting commit: `feat(scout): block "Chuck E. Cheese" franchise chain`
