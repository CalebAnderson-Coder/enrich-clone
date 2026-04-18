-- ============================================================
-- Migration 012: autonomy guardrails
--
-- Adds the auto-approve timestamp used by the Sprint-1 autonomous
-- dispatcher (Macro-Flujo 2, auto_approve_at + 2h default timeout)
-- and the per-brand quota table that caps daily/hourly send volume.
--
-- NOTE: migration is NOT applied automatically. Review and run manually
-- via the Supabase MCP or psql when autonomy is ready to go live.
-- ============================================================

-- ── campaign_enriched_data.auto_approve_at ──────────────────
ALTER TABLE public.campaign_enriched_data
  ADD COLUMN IF NOT EXISTS auto_approve_at TIMESTAMPTZ;

COMMENT ON COLUMN public.campaign_enriched_data.auto_approve_at
  IS 'If AUTONOMY_ENABLED=true, the dispatcher auto-approves outreach once NOW() >= auto_approve_at (default 2h after draft creation). NULL = manual approval required.';

-- Hot-path index: dispatcher only scans rows with a deadline set.
CREATE INDEX IF NOT EXISTS idx_ced_auto_approve
  ON public.campaign_enriched_data (auto_approve_at)
  WHERE auto_approve_at IS NOT NULL;

-- ── brand_quota ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_quota (
  brand_id       UUID PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  daily_cap      INTEGER NOT NULL DEFAULT 50,
  hourly_cap     INTEGER NOT NULL DEFAULT 30,
  warmup_stage   INTEGER NOT NULL DEFAULT 1,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.brand_quota IS
  'Per-brand send quotas used by lib/guardrails.js. warmup_stage allows staged ramp-up during cold-start (1 = fresh brand, 5 = warm).';

CREATE INDEX IF NOT EXISTS idx_brand_quota_updated
  ON public.brand_quota (updated_at DESC);

-- ── Row Level Security (follows migrations/007 pattern) ─────
ALTER TABLE public.brand_quota ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brand_quota_service_role ON public.brand_quota;
CREATE POLICY brand_quota_service_role
  ON public.brand_quota
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS brand_quota_authenticated_tenant ON public.brand_quota;
CREATE POLICY brand_quota_authenticated_tenant
  ON public.brand_quota
  FOR ALL
  TO authenticated
  USING (
    brand_id IN (
      SELECT brand_id FROM public.user_brand_memberships
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    brand_id IN (
      SELECT brand_id FROM public.user_brand_memberships
      WHERE user_id = auth.uid()
    )
  );

-- ── Backfill (COMMENTED — enable manually after deploying code) ──
-- Sets auto_approve_at = created_at + 2h for every existing row that
-- does not already have one. Uncomment and run ONCE when the app is
-- ready to honour the new gate (AUTONOMY_ENABLED=true in prod env).
--
-- UPDATE public.campaign_enriched_data
--   SET auto_approve_at = COALESCE(auto_approve_at, created_at + interval '2 hours')
--   WHERE auto_approve_at IS NULL;
