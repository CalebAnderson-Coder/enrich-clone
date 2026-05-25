-- ============================================================
-- Migration 020: lead_costs — Track cost per lead by source
--
-- Sprint 2 (Cost visibility). Tracks LLM tokens, Apify, Scrapling,
-- SMTP costs per lead so we can measure actual ROI.
--
-- Write path:
--   lib/costTracker.js::trackCost()
--     ↳ AgentRuntime.js (after LLM completion)
--     ↳ tools/apifyGoogleMaps.js (after Apify call)
--     ↳ tools/scrapling.js (after enrichment)
--     ↳ outreach_dispatcher.js (after SMTP send)
--
-- Read path:
--   dashboard /cockpit (cost cards)
--   components/CockpitView.jsx (SUM queries)
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
    CHECK (source IN ('llm_tokens', 'apify', 'scrapling', 'smtp'))
);

COMMENT ON TABLE public.lead_costs IS
  'Cost tracking per lead by source: LLM tokens, Apify, Scrapling, SMTP.';

-- Hot-path indexes ------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_lead_costs_lead_id
  ON public.lead_costs (lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_costs_brand_time
  ON public.lead_costs (brand_id, occurred_at DESC);

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
  FOR SELECT
  TO authenticated
  USING (
    brand_id IN (
      SELECT brand_id FROM public.user_brand_memberships
      WHERE user_id = auth.uid()
    )
  );
