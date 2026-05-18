CREATE TABLE IF NOT EXISTS public.lead_costs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID REFERENCES public.leads(id) ON DELETE CASCADE,
  brand_id     UUID REFERENCES public.brands(id) NOT NULL,
  source       TEXT NOT NULL,
  amount_usd   NUMERIC(10, 4) NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_costs_source_check
    CHECK (source IN ('llm_tokens', 'apify', 'scrapling', 'smtp', 'other'))
);

COMMENT ON TABLE public.lead_costs IS
  'Cost tracking per lead by source (LLM, Apify, Scrapling, SMTP). Used for ROI analytics and per-lead cost attribution.';

CREATE INDEX IF NOT EXISTS idx_lead_costs_lead_id
  ON public.lead_costs (lead_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_costs_brand_occurred
  ON public.lead_costs (brand_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_costs_source
  ON public.lead_costs (source, occurred_at DESC);

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
