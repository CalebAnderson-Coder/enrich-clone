-- ============================================================
-- Migration 020: lead_costs — Track cost per lead by source
--
-- Sprint 2 (Cost Tracking). Records costs for:
--   - llm_tokens: NVIDIA + Gemini API usage
--   - apify: lead sourcing
--   - scrapling: data enrichment
--   - smtp: email sends
--
-- Write path:
--   lib/costTracker.js::trackCost()
--     ↳ called from AgentRuntime.run() after each agent execution
--     ↳ called from sourcing + enrichment workers
--
-- Read path:
--   CockpitView (dashboard) reads SUM(amount_usd) with date filters
--   Analytics / ROI reporting
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lead_costs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  brand_id     UUID REFERENCES public.brands(id) NOT NULL,
  source       TEXT NOT NULL,
  amount_usd   NUMERIC(10, 6) NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT lead_costs_source_check
    CHECK (source IN ('llm_tokens', 'apify', 'scrapling', 'smtp'))
);

COMMENT ON TABLE public.lead_costs IS
  'Append-only cost log per lead by source (LLM, sourcing, enrichment, email). Feeds ROI analytics and cockpit cost cards.';

-- Hot-path indexes ------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_lead_costs_brand_date
  ON public.lead_costs (brand_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_costs_lead_date
  ON public.lead_costs (lead_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_costs_source_date
  ON public.lead_costs (source, occurred_at DESC);

-- Row Level Security (mirrors migration 011 / 014 pattern) -----
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
  FOR SELECT
  TO authenticated
  USING (
    brand_id IN (
      SELECT brand_id FROM public.user_brand_memberships
      WHERE user_id = auth.uid()
    )
  );
