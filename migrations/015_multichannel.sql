-- ============================================================
-- Migration 015: multichannel — WhatsApp (Baileys) + SMS + warmup
--
-- Sprint 5 final. Adds the persistence layer the Baileys wrapper
-- (tools/baileysWhatsApp.js) needs on Render's ephemeral FS, plus
-- the per-brand, per-day warmup counter the dispatcher consults
-- before every WhatsApp send.
--
-- Rollback-safe: MULTICHANNEL_ENABLED=false → dispatcher skips
-- these tables entirely. Migration is NOT applied automatically;
-- review + apply via Supabase MCP or psql once the feature flag
-- is about to flip in production.
--
-- Baileys note: the library uses in-memory auth state by default.
-- We keep creds + signal keys in this table (jsonb blobs) so a
-- redeploy does not force a re-pair. Only the service_role writes
-- here; the dashboard reads via authMiddleware → tenant check.
-- ============================================================

-- ── WhatsApp session persistence (Baileys auth state) ─────────
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  brand_id         UUID PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  instance_name    TEXT NOT NULL DEFAULT 'empirika',
  creds            JSONB,                   -- Baileys creds.json
  keys             JSONB,                   -- Baileys signal keys (pre-keys, sender keys, sessions)
  phone_number     TEXT,                    -- connected MSISDN once authenticated
  status           TEXT NOT NULL DEFAULT 'DISCONNECTED',
                                            -- DISCONNECTED | QR_PENDING | CONNECTED | LOGGED_OUT
  connected_at     TIMESTAMPTZ,
  last_ping_at     TIMESTAMPTZ,
  qr_code_pending  TEXT,                    -- base64 QR for dashboard (expires ~20s)
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_sessions_status_check
    CHECK (status IN ('DISCONNECTED','QR_PENDING','CONNECTED','LOGGED_OUT'))
);

COMMENT ON TABLE public.whatsapp_sessions IS
  'Per-brand Baileys (@whiskeysockets/baileys) auth state. Persists creds + signal keys so Render redeploys do not force a re-pair. Written exclusively by tools/baileysWhatsApp.js.';

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_status
  ON public.whatsapp_sessions (status);

-- ── WhatsApp warmup tracker (per-brand, per-day) ──────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_warmup (
  brand_id          UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  ymd               DATE NOT NULL,
  sends_count       INTEGER NOT NULL DEFAULT 0,
  cap               INTEGER NOT NULL DEFAULT 5,
  week_since_start  INTEGER NOT NULL DEFAULT 1,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (brand_id, ymd)
);

COMMENT ON TABLE public.whatsapp_warmup IS
  'Daily WhatsApp send counters for per-brand warmup ramp (week1=5 → week4+=50). Consulted by dispatcher before every WA send and incremented on success.';

CREATE INDEX IF NOT EXISTS idx_whatsapp_warmup_brand_ymd
  ON public.whatsapp_warmup (brand_id, ymd DESC);

-- ── Row Level Security (mirrors migration 014 policy) ─────────
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_warmup   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_sessions_service_role ON public.whatsapp_sessions;
CREATE POLICY whatsapp_sessions_service_role
  ON public.whatsapp_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS whatsapp_sessions_authenticated_tenant ON public.whatsapp_sessions;
CREATE POLICY whatsapp_sessions_authenticated_tenant
  ON public.whatsapp_sessions
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

DROP POLICY IF EXISTS whatsapp_warmup_service_role ON public.whatsapp_warmup;
CREATE POLICY whatsapp_warmup_service_role
  ON public.whatsapp_warmup
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS whatsapp_warmup_authenticated_tenant ON public.whatsapp_warmup;
CREATE POLICY whatsapp_warmup_authenticated_tenant
  ON public.whatsapp_warmup
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

-- ── outreach_status extension (documentation-only) ────────────
-- campaign_enriched_data.outreach_status is a free-text column
-- (no CHECK constraint). The new multichannel values are:
--   WHATSAPP_QUEUED, WHATSAPP_SENT, WHATSAPP_DELIVERED,
--   WHATSAPP_READ, WHATSAPP_FAILED,
--   SMS_QUEUED, SMS_SENT, SMS_DELIVERED, SMS_FAILED,
--   CALL_SCHEDULED (human follow-up when no digital channel works).
COMMENT ON COLUMN public.campaign_enriched_data.outreach_status IS
  'Multi-channel outreach status. Legacy values: PENDING, DRAFT, DRAFT_PHONE, APPROVED, SENT, BOUNCED, SEND_FAIL, SMTP_ERROR, DELIVERY_FAILED, SKIPPED_NO_CONTACT, RENDER_ERROR, BLOCKED_LOW_QUALITY, CONTACTED, RESPONDED. Sprint 5 additions: WHATSAPP_QUEUED, WHATSAPP_SENT, WHATSAPP_DELIVERED, WHATSAPP_READ, WHATSAPP_FAILED, SMS_QUEUED, SMS_SENT, SMS_DELIVERED, SMS_FAILED, CALL_SCHEDULED.';
