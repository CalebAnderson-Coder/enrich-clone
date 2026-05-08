-- Migration 022: Complete migration 005 brand_id NOT NULL audit (BK-004)
-- Date: 2026-05-08
-- Branch: chore/empirika-schema-2026-05-08
--
-- Renumbered from 012 (collision with master's 012_autonomy_guardrails.sql).
-- Already applied to production Supabase via MCP on 2026-05-08; this file
-- lands the IaC trail. ALTER NOT NULL is idempotent (no-op when already NOT
-- NULL); DELETE WHERE brand_id IS NULL is safe to re-run on a fresh DB.
--
-- Pre-condition (verified 2026-05-08 03:43 UTC via MCP supabase before
-- first apply):
--   * 5 tables had brand_id is_nullable=YES (excluding views).
--   * Only agent_events had NULL rows: 21 of 105667 (0.02%).
--   * The 21 NULL rows were test pollution from tests/smoke_verifier.js
--     missing brand_id in context. Pattern was 7 angela/send_email/null +
--     7 scout/null/null + 7 angela/send_email/ok per smoke run.
--   * The other 4 tables (agent_memory, campaign_enriched_data, leads,
--     marketing_jobs) had 0 NULL rows.
--   * fleet_audits_public is a VIEW; omitted from this migration.
--
-- Companion code changes in this commit (prevent future test pollution
-- AND fix two production callers that were also missing brandId):
--   - lib/verifierGate.js: leadContext.brandId propagates to runtime.run.
--   - outreach_dispatcher.js: leadContext.brandId = lead.brand_id at the
--     verifyAndRewrite call site, plus brandId in the Angela call site.
--   - magnet_worker.js: brandId from lead.brand_id at runtime.run call.
--   - tests/smoke_verifier.js: leadContext.brandId = process.env.BRAND_ID
--     || Empírika fixture UUID.

BEGIN;

-- 1. Purge NULL brand_id rows in agent_events (idempotent — no-op if 0 rows).
DELETE FROM public.agent_events WHERE brand_id IS NULL;

-- 2. ALTER NOT NULL on the 5 tables (idempotent — Postgres no-ops the ALTER
--    when the column is already NOT NULL, with a NOTICE).
ALTER TABLE public.agent_events           ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE public.agent_memory           ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE public.campaign_enriched_data ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE public.leads                  ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE public.marketing_jobs         ALTER COLUMN brand_id SET NOT NULL;

COMMIT;

-- Post-condition:
--   SELECT table_name FROM information_schema.columns
--   WHERE column_name='brand_id' AND table_schema='public'
--     AND is_nullable='YES'
--     AND table_name NOT IN (
--       SELECT table_name FROM information_schema.tables
--       WHERE table_schema='public' AND table_type='VIEW');
-- Expected: 0 rows.
