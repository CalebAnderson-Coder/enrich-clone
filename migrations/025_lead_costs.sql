CREATE TABLE IF NOT EXISTS public.lead_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
  brand_id UUID REFERENCES public.brands(id) NOT NULL,
  source TEXT NOT NULL,
  amount_usd NUMERIC(10, 6) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_costs_source_check
    CHECK (source IN ('llm_tokens', 'apify', 'scrapling', 'smtp'))
);

CREATE INDEX IF NOT EXISTS idx_lead_costs_brand_date
  ON public.lead_costs(brand_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_costs_lead
  ON public.lead_costs(lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_costs_source
  ON public.lead_costs(source);

COMMENT ON TABLE public.lead_costs IS
  'Granular cost tracking per lead across all services (LLM, sourcing, enrichment, SMTP). Feeds dashboard analytics and ROI calculations.';
