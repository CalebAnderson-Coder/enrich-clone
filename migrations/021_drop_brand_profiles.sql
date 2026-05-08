-- Migration 021: Drop deprecated brand_profiles table (BK-003)
-- Date: 2026-05-08
-- Branch: chore/empirika-schema-2026-05-08
--
-- Renumbered from 014 (collision with master's 014_outreach_events.sql).
-- Already applied to production Supabase via MCP on 2026-05-08; this
-- file lands the IaC trail. IF EXISTS keeps it safe on a fresh DB.
--
-- Pre-conditions (verified 2026-05-08):
--   * brand_profiles row count: 0
--   * brand_profiles has no `brand_id` column
--   * Single code reference at tools/database.js:657 (readBrandProfile)
--   * Canonical source for brand profile is brands.brand_profile (JSONB)
--   * Empírika row brands.brand_profile is non-null
--
-- Companion code change in this commit:
--   tools/database.js:readBrandProfile now reads from brands.brand_profile
--   (JSONB) and flattens it into the response.

BEGIN;

DROP TABLE IF EXISTS public.brand_profiles;

COMMIT;

-- Post-condition:
--   SELECT COUNT(*) FROM information_schema.tables
--   WHERE table_schema='public' AND table_name='brand_profiles';
-- Expected: 0.
