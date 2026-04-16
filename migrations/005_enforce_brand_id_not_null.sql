-- ============================================================
-- 005_enforce_brand_id_not_null.sql
-- Enforces NOT NULL on brand_id for leads + campaign_enriched_data.
--
-- ⚠️  DO NOT run this until:
--   - Migration 004 has been applied successfully.
--   - You verified `SELECT COUNT(*) WHERE brand_id IS NULL` returns 0 on both tables.
--   - The app has been running in production for at least a few hours
--     and new leads / campaigns are being created with brand_id populated.
--
-- After this migration, any INSERT missing brand_id will fail with
-- a NOT NULL constraint violation. This is intentional: it is the
-- database guaranteeing tenant isolation at the data layer.
-- ============================================================

ALTER TABLE leads
  ALTER COLUMN brand_id SET NOT NULL;

ALTER TABLE campaign_enriched_data
  ALTER COLUMN brand_id SET NOT NULL;
