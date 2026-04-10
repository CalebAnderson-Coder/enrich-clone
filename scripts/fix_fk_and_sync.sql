-- ============================================================
-- fix_fk_and_sync.sql
-- 1. Drop old FK pointing to "prospects" table
-- 2. Create new FK pointing to "leads" table
-- 3. Sync schema.sql with production reality
-- ============================================================

-- Step 1: Drop the broken foreign key
ALTER TABLE campaign_enriched_data
  DROP CONSTRAINT IF EXISTS campaign_enriched_data_prospect_id_fkey;

-- Step 2: Add correct FK pointing to leads.id
ALTER TABLE campaign_enriched_data
  ADD CONSTRAINT campaign_enriched_data_prospect_id_fkey
  FOREIGN KEY (prospect_id) REFERENCES leads(id) ON DELETE CASCADE;

-- Step 3: Verify
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'campaign_enriched_data';
