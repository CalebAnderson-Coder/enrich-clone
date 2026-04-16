-- ============================================================
-- Migration 008: Unify agent_memory schema
--
-- Context: The table has two sets of columns coexisting:
--   OLD: agent (text), key (text), value (text)
--   NEW: agent_name (text), brand_id (text), memory_key (text), memory_value (text)
--
-- NOTE: brand_id is stored as text here (legacy). The brands.id column is uuid.
-- We hardcode Empirika's brand_id for backfill since it is the only tenant
-- and the old rows have no brand context recorded.
--
-- Steps:
--   1. Backfill NEW cols from OLD cols for rows where agent_name IS NULL
--   2. Drop OLD cols and their unique constraint
--   3. Add prefix-search index on (agent_name, brand_id, memory_key)
-- ============================================================

-- 1. Backfill
UPDATE public.agent_memory
SET
  agent_name   = agent,
  memory_key   = key,
  memory_value = value,
  brand_id     = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8'
WHERE agent_name IS NULL AND agent IS NOT NULL;

-- 2. Drop old unique constraint on `key`, then drop old columns
ALTER TABLE public.agent_memory DROP CONSTRAINT IF EXISTS agent_memory_key_key;
ALTER TABLE public.agent_memory DROP COLUMN IF EXISTS agent;
ALTER TABLE public.agent_memory DROP COLUMN IF EXISTS key;
ALTER TABLE public.agent_memory DROP COLUMN IF EXISTS value;

-- 3. Prefix-search index (safe to create if not exists)
CREATE INDEX IF NOT EXISTS idx_agent_memory_prefix
  ON public.agent_memory (agent_name, brand_id, memory_key text_pattern_ops);
