-- ============================================================
-- Migration 024: lead_costs — Track costs per lead for ROI
--
-- Sprint 2 (Tracker de costos por lead). Provides visibility
-- into the actual cost of each lead sourced through Empírika.
--
-- Tracks costs from:
//   - LLM tokens (NVIDIA + Gemini prompt/completion)
--   - Apify (sourcing / web scraping)
--   - Scrapling (email enrichment)
--   - SMTP (email sending)
--   - Other integrations
--
-- Write path:
--   lib/costTracker.js::trackCost()
--     → AgentRuntime after .run() returns (token costs)
--     → tools/apifyGoogleMaps.js (sourcing costs)
--     → tools/scrapling.js (enrichment costs)
--     → tools/email.js (SMTP costs)
--
-- Read path:
--   Dashboard CockpitView reads:
--     - SUM(amount_usd) WHERE occurred_at >= date_trunc('month', now())
--     - SUM(amount_usd) / COUNT(DISTINCT lead_id) last 30d
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lead_costs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  brand_id     UUID REFERENCES public.brands(id) NOT NULL,
  source       TEXT NOT NULL,
  amount_usd   NUMERIC NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT lead_costs_source_check
    CHECK (source IN (
      'llm_tokens',     -- NVIDIA / Gemini token costs
      'apify',          -- Apify sourcing/mapping API
      'scrapling',      -- Scrapling email enrichment
      'smtp',           -- SMTP sending
      'other'
    ))
);

COMMENT ON TABLE public.lead_costs IS
  'Append-only cost ledger. Tracks costs per lead from all sources (LLM, sourcing, enrichment, SMTP). Used for ROI analysis + cost optimization.';

-- Hot-path indexes ------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_costs_brand_time
  ON public.lead_costs (brand_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_costs_lead_id
  ON public.lead_costs (lead_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_costs_source
  ON public.lead_costs (brand_id, source, occurred_at DESC);

-- Row Level Security (mirrors migration 011 agent_events policy) --
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
