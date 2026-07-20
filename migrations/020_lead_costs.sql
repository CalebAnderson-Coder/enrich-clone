-- ============================================================
-- Migration 020: lead_costs — Track actual costs per lead
--
-- Sprint 2 (Cost tracking). Financial visibility for ROI analysis.
-- Tracks costs from LLM tokens (NVIDIA + Gemini), Apify, Scrapling,
-- SMTP, and other external services.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lead_costs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  brand_id        UUID REFERENCES public.brands(id) NOT NULL,
  source          TEXT NOT NULL,
  amount_usd      NUMERIC(10, 6) NOT NULL DEFAULT 0,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT lead_costs_source_check
    CHECK (source IN ('llm_tokens', 'apify', 'scrapling', 'smtp', 'other'))
);

COMMENT ON TABLE public.lead_costs IS
  'Append-only cost log for each lead. Tracks spending across LLM, data enrichment, and outreach services for ROI calculation.';

-- Hot-path indexes ------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_lead_costs_brand_month
  ON public.lead_costs (brand_id, date_trunc('month', occurred_at) DESC);

CREATE INDEX IF NOT EXISTS idx_lead_costs_lead_time
  ON public.lead_costs (lead_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_costs_source_time
  ON public.lead_costs (brand_id, source, occurred_at DESC);

-- Row Level Security -----------------------------------------------
ALTER TABLE public.lead_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_costs_service_role ON public.lead_costs;
CREATE POLICY lead_costs_service_role
  ON public.lead_costs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS lead_costs_authenticated_tenant ON public.lead_costs;
CREATE POLICY lead_costs_authenticated_tenant
  ON public.lead_costs
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
