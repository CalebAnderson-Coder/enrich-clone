-- ============================================================
-- Migration 020: lead_costs — Track spend per lead
--
-- Tracks all costs associated with acquiring and processing a lead:
-- - LLM tokens (NVIDIA, Gemini)
-- - Apify (Google Maps scraping)
-- - Scrapling (email enrichment)
-- - SMTP (email sending)
--
-- Used by: CockpitView to show "Costo este mes" and "Costo promedio"
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lead_costs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  brand_id     UUID REFERENCES public.brands(id) NOT NULL,
  source       TEXT NOT NULL,
  amount_usd   NUMERIC(10, 4) NOT NULL DEFAULT 0,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT lead_costs_source_check
    CHECK (source IN ('llm_tokens', 'apify', 'scrapling', 'smtp'))
);

COMMENT ON TABLE public.lead_costs IS
  'Append-only cost ledger. Each row represents one unit of spend (one API call, one email, one batch). Feeds CockpitView cost metrics.';

-- Hot-path indexes ------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_lead_costs_brand_occurred
  ON public.lead_costs (brand_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_costs_lead_occurred
  ON public.lead_costs (lead_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_costs_source
  ON public.lead_costs (source, occurred_at DESC);

-- Row Level Security ------------------------------------------------
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
