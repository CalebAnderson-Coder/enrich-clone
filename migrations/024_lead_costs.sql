-- ============================================================
-- Migration 024: lead_costs — Track cost per lead by source
--
-- Tracks the cost breakdown for each lead across LLM tokens,
-- Apify sourcing, Scrapling enrichment, and SMTP delivery.
-- Enables ROI visibility: total cost vs. revenue generated.
--
-- Write path:
--   lib/costTracker.js::trackCost()
--     ↳ Called from AgentRuntime after LLM completion
--     ↳ Called from outreach_dispatcher for SMTP cost
--     ↳ Called from enrichment workers for 3rd-party APIs
--
-- Read path:
--   CockpitView.jsx — aggregate SUM(amount_usd) by date range
--   ROI dashboard cards
--
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lead_costs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  brand_id     UUID REFERENCES public.brands(id) NOT NULL,
  source       TEXT NOT NULL,
  amount_usd   NUMERIC(10, 4) NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT lead_costs_source_check
    CHECK (source IN (
      'llm_tokens',
      'apify',
      'scrapling',
      'smtp',
      'hunter_enrichment',
      'brightdata',
      'other'
    ))
);

COMMENT ON TABLE public.lead_costs IS
  'Append-only log of costs incurred per lead, by source. Feeds cost analytics, ROI dashboards, and financial reporting.';

-- Hot-path indexes ------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_lead_costs_lead_time
  ON public.lead_costs (lead_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_costs_brand_time
  ON public.lead_costs (brand_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_costs_source_time
  ON public.lead_costs (source, occurred_at DESC);

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

-- Anon role: read-only on aggregated/public vistas (if needed later) --
DROP POLICY IF EXISTS lead_costs_anon_read ON public.lead_costs;
