-- ============================================================
-- migrations/017_agent_autonomy.sql
-- Database foundation for long-lived autonomous worker agents.
-- Converts 11 LLM agents from cron scripts to persistent workers
-- with inter-agent messaging, heartbeat registration, and durable
-- per-agent key/value state.
--
-- Memory ref: project_empirika_autonomy_helena_first_2026-05-07.md
--
-- Tables created:
--   agent_messages   — inter-agent queue (SELECT FOR UPDATE SKIP LOCKED)
--   agent_processes  — heartbeat registry (boot registration + health)
--   agent_state      — durable per-agent k/v store
--
-- NOTE: NOT applied automatically. Review and apply manually via
-- psql or the Supabase MCP. Do NOT apply via apply_migration MCP.
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- Helper: generic updated_at trigger function (idempotent)
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- Table 1: agent_messages — inter-agent queue
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_messages (
  id              BIGSERIAL PRIMARY KEY,
  brand_id        UUID        NOT NULL,
  from_agent      TEXT        NOT NULL,
  to_agent        TEXT        NOT NULL,
  payload         JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'pending',
  claimed_by      TEXT,
  claimed_at      TIMESTAMPTZ,
  processed_at    TIMESTAMPTZ,
  result          JSONB,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_msg_status CHECK (status IN ('pending','claimed','processed','failed'))
);

-- Primary recv() index — used for SELECT FOR UPDATE SKIP LOCKED polling
CREATE INDEX IF NOT EXISTS idx_agent_messages_recv
  ON public.agent_messages (to_agent, brand_id, status, created_at);

-- Sender audit index
CREATE INDEX IF NOT EXISTS idx_agent_messages_sender
  ON public.agent_messages (from_agent, created_at DESC);

-- Orphan-claim detection index (find messages claimed by a crashed worker)
CREATE INDEX IF NOT EXISTS idx_agent_messages_claimed
  ON public.agent_messages (claimed_by, status);

-- updated_at auto-maintenance
DROP TRIGGER IF EXISTS trg_agent_messages_updated_at ON public.agent_messages;
CREATE TRIGGER trg_agent_messages_updated_at
  BEFORE UPDATE ON public.agent_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_messages_service_role ON public.agent_messages;
CREATE POLICY agent_messages_service_role
  ON public.agent_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.agent_messages IS
  'Inter-agent message queue. Consumers poll with SELECT FOR UPDATE SKIP LOCKED on (to_agent, brand_id, status, created_at). status lifecycle: pending→claimed→processed|failed.';
COMMENT ON COLUMN public.agent_messages.claimed_by IS
  'process_id (UUID) of the worker that claimed this message. Used to detect orphans after a crash.';

-- ──────────────────────────────────────────────────────────────
-- Table 2: agent_processes — heartbeat registry
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_processes (
  id                  BIGSERIAL   PRIMARY KEY,
  agent_name          TEXT        NOT NULL,
  brand_id            UUID        NOT NULL,
  process_id          TEXT        NOT NULL UNIQUE,
  host                TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status              TEXT        NOT NULL DEFAULT 'running',
  metadata            JSONB       NOT NULL DEFAULT '{}',
  CONSTRAINT chk_proc_status CHECK (status IN ('running','stopped','crashed'))
);

-- Primary liveness index — find running processes per agent quickly
CREATE INDEX IF NOT EXISTS idx_agent_processes_liveness
  ON public.agent_processes (agent_name, brand_id, status, last_heartbeat_at DESC);

ALTER TABLE public.agent_processes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_processes_service_role ON public.agent_processes;
CREATE POLICY agent_processes_service_role
  ON public.agent_processes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.agent_processes IS
  'Worker boot registry + heartbeat table. One row per live process. Workers INSERT on boot (process_id = UUID), UPDATE last_heartbeat_at every ~30s, set status=stopped on clean shutdown or status=crashed on SIGKILL detection.';
COMMENT ON COLUMN public.agent_processes.process_id IS
  'UUID generated at boot by each worker instance. UNIQUE enforces single-row-per-process semantics.';

-- ──────────────────────────────────────────────────────────────
-- Table 3: agent_state — durable per-agent k/v store
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_state (
  agent_name  TEXT        NOT NULL,
  brand_id    UUID        NOT NULL,
  key         TEXT        NOT NULL,
  value       JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_name, brand_id, key)
);

-- updated_at auto-maintenance
DROP TRIGGER IF EXISTS trg_agent_state_updated_at ON public.agent_state;
CREATE TRIGGER trg_agent_state_updated_at
  BEFORE UPDATE ON public.agent_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.agent_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_state_service_role ON public.agent_state;
CREATE POLICY agent_state_service_role
  ON public.agent_state
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.agent_state IS
  'Durable per-agent key/value store. PK is (agent_name, brand_id, key). Example keys: last_run_at, gemini_circuit_open_until, paused_by_owner. Use UPSERT (INSERT ... ON CONFLICT DO UPDATE) for all writes.';

COMMIT;
