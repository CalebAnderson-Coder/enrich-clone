-- ============================================================
-- Migration 009: Add verifier_report column to campaign_enriched_data
--
-- Adds a JSONB column to store the Verifier agent's rubric reports
-- (one entry per evaluation attempt) for each outreach draft.
--
-- Also documents the BLOCKED_LOW_QUALITY outreach_status value.
-- outreach_status is a free-text column (no enum constraint),
-- so no ALTER TYPE is required — the value is valid as-is.
-- ============================================================

ALTER TABLE public.campaign_enriched_data
  ADD COLUMN IF NOT EXISTS verifier_report JSONB;

COMMENT ON COLUMN public.campaign_enriched_data.verifier_report
  IS 'Array of Verifier agent rubric reports. Each entry: { scores, overall, verdict, issues, rewrite_hint }. Populated when the Verifier gate runs during outreach dispatch.';

-- Index for fast lookup of blocked/low-quality records
CREATE INDEX IF NOT EXISTS idx_campaign_blocked_quality
  ON public.campaign_enriched_data (outreach_status)
  WHERE outreach_status = 'BLOCKED_LOW_QUALITY';
