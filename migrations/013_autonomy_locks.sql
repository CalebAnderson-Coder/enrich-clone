-- ============================================================
-- Migration 013: autonomy_locks
--
-- Serializes autoApprovePastDueDrafts batches across cron + worker
-- + setInterval schedulers. Without this table two dispatchers can
-- pass the same assertSendAllowed() check (sentToday=49) and each
-- approve a full BATCH_LIMIT, burning through the daily cap.
--
-- Contract:
--   • Claim = INSERT ... ON CONFLICT DO UPDATE SET held_until=...
--             WHERE autonomy_locks.held_until < NOW() RETURNING brand_id.
--     0 rows back → another process holds the lock → skip cycle.
--   • Release = DELETE WHERE brand_id=$1 (finally block).
--   • held_until auto-expires (5min default) so a crashed worker
--     does not deadlock the brand forever.
--
-- NOTE: migration is NOT applied automatically. Review and run
-- manually via the Supabase MCP or psql.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.autonomy_locks (
  brand_id     UUID PRIMARY KEY REFERENCES public.brands(id) ON DELETE CASCADE,
  held_until   TIMESTAMPTZ NOT NULL,
  claimed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  owner_tag    TEXT
);

COMMENT ON TABLE public.autonomy_locks IS
  'Per-brand advisory lock table for autoApprovePastDueDrafts. Row present + held_until > NOW() means a batch is in flight. Row absent OR expired means a new batch can claim.';

CREATE INDEX IF NOT EXISTS idx_autonomy_locks_held_until
  ON public.autonomy_locks (held_until);

-- ── Row Level Security — service role only ──────────────────
ALTER TABLE public.autonomy_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS autonomy_locks_service_role ON public.autonomy_locks;
CREATE POLICY autonomy_locks_service_role
  ON public.autonomy_locks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
