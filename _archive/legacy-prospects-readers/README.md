# Legacy `prospects` table readers (archived 2026-05-08, BK-036)

These 5 scripts read from `public.prospects` (the frozen legacy snapshot —
see `docs/data-model-prospects-vs-leads.md` and BK-021). They were one-off
migration / sandbox utilities, not part of the active production pipeline.

Moved here from the repo root and `scripts/` so the active surface stays
clean. They remain executable for forensic / manual replay purposes:

```bash
cd "$(git rev-parse --show-toplevel)"
node _archive/legacy-prospects-readers/replace_with_real_leads.js
```

## Files

| File | Original location | Purpose | Last meaningful run |
|---|---|---|---|
| `replace_with_real_leads.js` | repo root | One-off: swap mock leads for the first real prospects batch | early Apr 2026 |
| `sandbox_ghl_send.js` | repo root | Manual GHL test against a single prospect | sandbox only |
| `update_35_leads.js` | repo root | Batch updater of the original 35 prospect rows | 2026-04-08 |
| `update_website_links.js` | repo root | Fix prospect website URLs in bulk | 2026-04-08 |
| `test_real_davinci.js` | `scripts/` | Manual DaVinci agent test against a prospect | sandbox only |

## Current canonical pipeline

The active pipeline writes to `public.leads` (multi-tenant, brand_id NOT NULL
post-migration 012, RLS-policied). All agents (Manager, Scout, Carlos, Angela,
Helena, Sam, Kai, DaVinci, Verifier, Estratega) read and write `leads`.

## When to delete this directory

When `public.prospects` itself is dropped — at that point these scripts will
all error on first SQL call and have no remaining value.

Until then, the cost of keeping them is zero (no imports from active code,
no cron schedule, no test references).
