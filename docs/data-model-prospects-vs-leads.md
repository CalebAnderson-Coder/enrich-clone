# Data Model — `prospects` vs `leads`

> **Status:** Decision documented 2026-05-08 (BK-021).
> **TL;DR:** `prospects` is a frozen legacy snapshot from 2026-04-08. The active multi-tenant pipeline writes to `leads`. **Do not write to `prospects` from new code.**

---

## What's in each table

| Aspect | `prospects` (legacy) | `leads` (active) |
|---|---|---|
| Row count (2026-05-08) | 23 | 261 |
| First created_at | 2026-04-08 20:24 UTC | 2026-04-08 20:24 UTC |
| Last created_at | **2026-04-08 21:56 UTC** (frozen) | 2026-05-07 22:16 UTC (active) |
| Activity window | Single 1.5-hour seed window | Continuous since launch |
| `brand_id` column | **No** | Yes (`uuid`, NOT NULL post-BK-004) |
| Multi-tenant | No | Yes |
| Primary keys | `id uuid` | `id uuid` |
| Geographic field | `city varchar` | `metro_area varchar` |
| Industry field | `niche_id integer` (FK to a `niches` table) | `industry varchar` |
| Reviews count | `reviews_count` | `review_count` |
| Lead scoring | (none) | `qualification_score`, `lead_tier`, `score_breakdown` jsonb |
| Outreach state | (none) | `outreach_status`, `email_sent_at`, …  |

---

## Overlap analysis (2026-05-08)

```sql
SELECT
  (SELECT COUNT(*) FROM prospects) AS prospects_total,
  (SELECT COUNT(*) FROM leads)     AS leads_total,
  (SELECT COUNT(*) FROM prospects p
    JOIN leads l ON LOWER(TRIM(p.business_name)) = LOWER(TRIM(l.business_name))
  ) AS exact_name_overlap;
-- prospects_total=23, leads_total=261, exact_name_overlap=21
```

- **21 of 23 prospects (91%)** have an exact business_name match in `leads`. They were migrated when the pipeline switched to the multi-tenant model.
- **2 of 23 prospects** are NOT in `leads`: `Garcia Roofing` and `Isuani Roofing` (both Miami, FL). These were never re-enriched into the new schema. Decision: leave them in `prospects` only — re-scraping Miami HVAC/Roofing will surface them in `leads` if they're still active.

---

## Code that reads `prospects` (no active production writers)

```
$ grep -rnE "from\(['\"]prospects['\"]\)" --include="*.js" \
       --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=_archive
```

| File | Purpose | Status |
|---|---|---|
| `replace_with_real_leads.js`        | One-off migration script (root, untracked) | Legacy — candidate for `_archive/` |
| `sandbox_ghl_send.js`                | Manual GHL test (root, untracked) | Legacy — sandbox |
| `update_35_leads.js`                 | One-off batch updater (root, untracked) | Legacy — already executed |
| `update_website_links.js`            | One-off URL fixer (root, untracked) | Legacy — already executed |
| `scripts/test_real_davinci.js`       | Manual DaVinci test | Sandbox — not production |

**No agent (`agents/*.js`), worker (`workers/*.js`), or `index.js` route reads or writes `prospects`.** The active pipeline is `leads`-only.

---

## Decision

**Leave `prospects` alone.** Don't drop, don't backfill, don't migrate. The table is:

1. Read-only in practice (no active writers).
2. 91% redundant with `leads`.
3. Referenced only by legacy/sandbox scripts that should themselves be archived in a separate housekeeping pass.

### Why not drop?

- The 2 unique rows (`Garcia Roofing`, `Isuani Roofing`) are inexpensive to keep.
- 5 legacy scripts grep-reference the table; dropping silently breaks them (acceptable cost, but not free).
- Future audit/forensic queries against early pilot decisions benefit from having the original snapshot intact.

### Why not backfill?

- The 2 missing rows are 4 weeks old and may already be stale (business closed, name changed, etc.).
- Empírika's Spanish-only outreach IRON RULE (per `agents/scout.js:52`) requires a fresh Latino-owned re-verification before any new outreach — backfilling without that check would violate the rule.

### When to revisit

- If `prospects` ever needs `brand_id` (i.e. multi-tenant), **drop it** instead. Do not retrofit `brand_id` onto a frozen legacy table.
- If `_archive/` is reorganised, move the 5 legacy scripts under `_archive/legacy-prospects-readers/` to make the dependency surface explicit.

---

## Action items spawned

| ID | Action | Owner | Effort |
|---|---|---|---|
| BK-035 | Add `COMMENT ON TABLE public.prospects IS 'Frozen legacy snapshot (2026-04-08). Do not write. See docs/data-model-prospects-vs-leads.md.'` | Engineering | S |
| BK-036 | Move legacy scripts (replace_with_real_leads.js, sandbox_ghl_send.js, update_35_leads.js, update_website_links.js) to `_archive/legacy-prospects-readers/` in a single commit | Engineering | S |
