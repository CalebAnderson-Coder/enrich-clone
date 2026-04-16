-- ============================================================
-- 004_multi_tenant_leads_campaigns.sql
-- Adds brand_id to leads + campaign_enriched_data and backfills
-- existing data with Empírika as the default tenant.
--
-- This migration is IDEMPOTENT and ADDITIVE. It does NOT enforce
-- NOT NULL — that is done in 005_enforce_brand_id_not_null.sql
-- after you verify the app runs fine with new inserts carrying
-- brand_id and no legacy inserts breaking.
--
-- Order of operations (as agreed):
--   1. Deploy the code changes to Render (INSERTs now include brand_id).
--   2. Verify app boots and a fresh lead is created with brand_id set.
--   3. Run THIS migration (004) in Supabase SQL Editor.
--   4. Run 005 (NOT NULL constraint) after a full day of green runtime.
-- ============================================================

-- ── Add brand_id columns (nullable for now) ─────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id);

ALTER TABLE campaign_enriched_data
  ADD COLUMN IF NOT EXISTS brand_id UUID REFERENCES brands(id);

-- ── Performance indexes for tenant-scoped queries ───────────
CREATE INDEX IF NOT EXISTS idx_leads_brand
  ON leads(brand_id);

CREATE INDEX IF NOT EXISTS idx_campaign_brand
  ON campaign_enriched_data(brand_id);

-- ── Ensure Empírika row exists in brands ────────────────────
INSERT INTO brands (id, name, industry)
VALUES (
  'eca1d833-77e3-4690-8cf1-2a44db20dcf8',
  'Empírika',
  'Marketing'
)
ON CONFLICT (id) DO NOTHING;

-- ── Backfill legacy rows with Empírika as default tenant ────
UPDATE leads
SET brand_id = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8'
WHERE brand_id IS NULL;

UPDATE campaign_enriched_data
SET brand_id = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8'
WHERE brand_id IS NULL;

-- ── Sanity check: no rows should remain with brand_id IS NULL ─
-- Run this in the SQL editor after executing the above:
--   SELECT COUNT(*) FROM leads WHERE brand_id IS NULL;             -- expect 0
--   SELECT COUNT(*) FROM campaign_enriched_data WHERE brand_id IS NULL;  -- expect 0
