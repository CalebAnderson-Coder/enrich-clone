-- ============================================================
-- 018_atlas_audits.sql — Atlas (fleet observability) tables
--
-- Atlas is the fleet auditor. It runs a deterministic SQL-based
-- health check every 5 min and persists the verdict here so the
-- dashboard can surface "fleet OK / DEGRADED / CRITICAL" at a
-- glance and so Manager can react to incidents without parsing
-- raw logs.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fleet_audits (
  id          BIGSERIAL PRIMARY KEY,
  brand_id    UUID        NOT NULL,
  -- Overall verdict for this audit run.
  status      TEXT        NOT NULL CHECK (status IN ('HEALTHY','DEGRADED','CRITICAL')),
  -- Counters that summarize the snapshot.
  alive_count    INTEGER  NOT NULL DEFAULT 0,
  stale_count    INTEGER  NOT NULL DEFAULT 0,
  crashed_count  INTEGER  NOT NULL DEFAULT 0,
  stuck_messages INTEGER  NOT NULL DEFAULT 0,
  failed_1h      INTEGER  NOT NULL DEFAULT 0,
  -- Full structured findings (per-agent, per-issue) for the dashboard.
  findings    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Raw metrics snapshot (for trend analysis later).
  metrics     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Whether Atlas opened an incident with Manager this run.
  alerted     BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fleet_audits_brand_created_idx
  ON public.fleet_audits (brand_id, created_at DESC);

CREATE INDEX IF NOT EXISTS fleet_audits_status_idx
  ON public.fleet_audits (status, created_at DESC)
  WHERE status <> 'HEALTHY';

ALTER TABLE public.fleet_audits ENABLE ROW LEVEL SECURITY;

-- Service role: full access.
DROP POLICY IF EXISTS fleet_audits_service_role ON public.fleet_audits;
CREATE POLICY fleet_audits_service_role
  ON public.fleet_audits FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Anon (dashboard demo): read-only. Same pattern as other dashboard tables.
DROP POLICY IF EXISTS fleet_audits_anon_demo_select ON public.fleet_audits;
CREATE POLICY fleet_audits_anon_demo_select
  ON public.fleet_audits FOR SELECT TO anon USING (true);

-- Realtime publication so the dashboard can stream new audits live.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fleet_audits;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END$$;
