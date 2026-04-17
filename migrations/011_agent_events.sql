-- ============================================================
-- Migration 011: agent_events — Fleet observability sink
--
-- Persists every significant event emitted by the AgentRuntime
-- (run lifecycle, tool calls, Zod validation errors, delegations,
-- agent errors) so the Creator Cockpit dashboard can aggregate
-- stats, replay traces, and stream live activity.
--
-- Write path: lib/agentEventsSink.js (fire-and-forget batch insert).
-- Read path : GET /api/cockpit/stats | /events | /stream (SSE).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_events (
  id            BIGSERIAL PRIMARY KEY,
  trace_id      TEXT NOT NULL,
  brand_id      UUID REFERENCES public.brands(id),
  agent         TEXT NOT NULL,
  event_type    TEXT NOT NULL,   -- run_started | run_completed | tool_call | tool_result | zod_error | delegation | agent_error
  tool          TEXT,
  status        TEXT,            -- ok | fail | blocked
  duration_ms   INTEGER,
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  error_message TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Hot-path indexes for cockpit queries
CREATE INDEX IF NOT EXISTS idx_agent_events_created
  ON public.agent_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_events_agent_created
  ON public.agent_events (agent, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_events_trace
  ON public.agent_events (trace_id);

CREATE INDEX IF NOT EXISTS idx_agent_events_brand
  ON public.agent_events (brand_id);

-- ── Row Level Security ──────────────────────────────────────
ALTER TABLE public.agent_events ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by server-side writes/reads)
DROP POLICY IF EXISTS agent_events_service_role ON public.agent_events;
CREATE POLICY agent_events_service_role
  ON public.agent_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can only see events for brands they belong to
DROP POLICY IF EXISTS agent_events_authenticated_tenant ON public.agent_events;
CREATE POLICY agent_events_authenticated_tenant
  ON public.agent_events
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

COMMENT ON TABLE public.agent_events IS
  'Append-only event log of AgentRuntime activity. Powers the Creator Cockpit dashboard (stats / events / SSE stream).';
