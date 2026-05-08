-- Migration 015: Mark prospects table as frozen legacy (BK-021 / BK-035)
-- Date: 2026-05-08
-- Branch: docs/prospects-vs-leads-dedup
--
-- Pre-condition (verified 2026-05-08 via MCP supabase):
--   * prospects: 23 rows, last_created_at=2026-04-08 21:56 UTC (frozen)
--   * leads:    261 rows, last_created_at=2026-05-07 22:16 UTC (active)
--   * 21 of 23 prospects share business_name with a leads row (91% overlap)
--   * No agents/, workers/, or index.js reads or writes prospects.
--   * 5 legacy scripts (root + scripts/) read the table for one-off
--     migration/sandbox purposes; documented for archival.
--
-- This migration adds a COMMENT to the table so any developer or LLM
-- that introspects the schema sees the deprecation note before writing.
-- See docs/data-model-prospects-vs-leads.md for the full rationale.

BEGIN;

COMMENT ON TABLE public.prospects IS
  'Frozen legacy snapshot (2026-04-08). Do not write. See docs/data-model-prospects-vs-leads.md (BK-021). Active multi-tenant pipeline writes to public.leads instead.';

COMMIT;

-- Post-condition:
--   SELECT obj_description('public.prospects'::regclass);
-- Should return the comment string above.
