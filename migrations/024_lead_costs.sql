-- ============================================================
-- Migration 024: lead_costs table for cost tracking per lead
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lead_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('llm_tokens', 'apify', 'scrapling', 'smtp')),
  amount_usd NUMERIC(10, 4) NOT NULL CHECK (amount_usd >= 0),
  occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_lead_costs_lead_id ON public.lead_costs(lead_id);
CREATE INDEX idx_lead_costs_brand_id ON public.lead_costs(brand_id);
CREATE INDEX idx_lead_costs_occurred_at ON public.lead_costs(occurred_at DESC);
CREATE INDEX idx_lead_costs_source ON public.lead_costs(source);

ALTER TABLE public.lead_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_costs_select_own_brand"
  ON public.lead_costs
  FOR SELECT
  USING (brand_id = auth.jwt() ->> 'brand_id' OR auth.jwt() ->> 'role' = 'admin');

CREATE POLICY "lead_costs_insert_own_brand"
  ON public.lead_costs
  FOR INSERT
  WITH CHECK (brand_id = auth.jwt() ->> 'brand_id' OR auth.jwt() ->> 'role' = 'admin');
