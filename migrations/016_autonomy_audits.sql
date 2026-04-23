-- ============================================================
-- migrations/016_autonomy_audits.sql
-- Layer 1 storage for the nightly auditor (Empírika pilot).
-- Plan: .omc/plans/autonomy-3layer-v2.md §B.1
-- ============================================================

CREATE TABLE IF NOT EXISTS public.autonomy_audits (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                      UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  audit_run_id                  UUID NOT NULL,
  metric_name                   TEXT NOT NULL,
  value                         NUMERIC,
  severity                      TEXT NOT NULL CHECK (severity IN ('green','yellow','red','error')),
  suggested_action              TEXT,
  threshold_hit                 TEXT,
  details                       JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at               TIMESTAMPTZ,
  acknowledged_by               TEXT,
  auto_dispatched_ralph_task_id TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audits_brand_created
  ON public.autonomy_audits (brand_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audits_unacked_severity
  ON public.autonomy_audits (severity, created_at DESC)
  WHERE acknowledged_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_audits_metric_created
  ON public.autonomy_audits (metric_name, created_at DESC);

ALTER TABLE public.autonomy_audits ENABLE ROW LEVEL SECURITY;

-- Companion table: one row per morning_briefing session.
CREATE TABLE IF NOT EXISTS public.autonomy_briefings (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id                 UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  session_id               TEXT,
  audits_read_count        INTEGER NOT NULL DEFAULT 0,
  audits_dispatched_count  INTEGER NOT NULL DEFAULT 0,
  budget_spent_usd         NUMERIC NOT NULL DEFAULT 0,
  details                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_briefings_brand_created
  ON public.autonomy_briefings (brand_id, created_at DESC);

ALTER TABLE public.autonomy_briefings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.autonomy_audits IS
  'Layer 1 auditor output. One row per (metric, run). Written by workers/nightly_auditor.js. Pure SQL, no LLM.';
COMMENT ON TABLE public.autonomy_briefings IS
  'Layer 2 session ledger. One row per morning_briefing invocation. Tracks dispatch + cost.';
