-- ============================================================
-- Migration 014: outreach_events — Granular learning-loop events
--
-- Sprint 2 (Learning Loop). Closes critic C4 from the S1 review:
-- the circuit breaker in lib/guardrails.js needs real delivery/open/
-- reply signal to evolve past the outreach_status proxy.
--
-- Write path:
--   tools/outreachEvents.js::logOutreachEvent()
--     ↳ outreach_dispatcher.js (email sent/failed)
--     ↳ index.js  /pixel/:leadId.gif (open tracking)
--     ↳ index.js  /webhook/ghl-stage (CRM stage transitions)
--     ↳ index.js  /webhook/smtp-bounce (bounce reports)
--     ↳ tools/email.js syncToGHL (contact sync)
--     ↳ lead_magnet_worker.js (landing creation)
--
-- Read path:
--   tools/outreachEvents.js::getHistoricalPerformance() (Scout tool)
--   workers/learning_consolidator.js (nightly top/bottom combos)
--   lib/guardrails.js::getBounceRateLast24h() (circuit breaker)
--
-- NOTE: migration is NOT applied automatically. Review + apply via
-- Supabase MCP or psql when LEARNING_ENABLED=true is ready to flip.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.outreach_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  brand_id     UUID REFERENCES public.brands(id) NOT NULL,
  channel      TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  message_id   TEXT,
  CONSTRAINT outreach_events_channel_check
    CHECK (channel IN ('email','whatsapp','sms','phone','pixel','ghl','landing')),
  CONSTRAINT outreach_events_event_type_check
    CHECK (event_type IN (
      'sent','opened','clicked','replied','bounced','read',
      'visited','stage_change','scroll_50','cta_click','form_submit',
      'unsubscribed','delivered','failed'
    ))
);

COMMENT ON TABLE public.outreach_events IS
  'Append-only granular event log of outreach touches. Feeds Scout historical performance tool, nightly learning consolidator, and the circuit breaker bounce-rate query.';

-- Hot-path indexes ------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_events_brand_channel_time
  ON public.outreach_events (brand_id, channel, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_lead_time
  ON public.outreach_events (lead_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_message_id
  ON public.outreach_events (message_id)
  WHERE message_id IS NOT NULL;

-- Row Level Security (mirrors migration 011 agent_events policy) --
ALTER TABLE public.outreach_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outreach_events_service_role ON public.outreach_events;
CREATE POLICY outreach_events_service_role
  ON public.outreach_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS outreach_events_authenticated_tenant ON public.outreach_events;
CREATE POLICY outreach_events_authenticated_tenant
  ON public.outreach_events
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
