CREATE TABLE IF NOT EXISTS public.ghl_reply_syncs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID REFERENCES public.brands(id) NOT NULL,
  outreach_event_id UUID REFERENCES public.outreach_events(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  ghl_note_id TEXT,
  ghl_opportunity_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retry_count INT DEFAULT 0,
  last_retry_at TIMESTAMPTZ,
  CONSTRAINT ghl_reply_syncs_status_check
    CHECK (status IN ('pending', 'success', 'failed', 'ignored'))
);

CREATE INDEX IF NOT EXISTS idx_ghl_reply_syncs_brand_status
  ON public.ghl_reply_syncs(brand_id, status);

CREATE INDEX IF NOT EXISTS idx_ghl_reply_syncs_event
  ON public.ghl_reply_syncs(outreach_event_id);

COMMENT ON TABLE public.ghl_reply_syncs IS
  'Tracks synchronization of outreach replies to GHL contacts and opportunities. Ensures idempotency and retry logic for GHL API calls.';
