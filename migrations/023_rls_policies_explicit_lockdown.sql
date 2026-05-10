-- Migration 023: Explicit RLS lockdown for service-role-only tables (BK-005)
-- Date: 2026-05-08
-- Branch: chore/empirika-schema-2026-05-08
--
-- Renumbered from 013 (collision with master's 013_autonomy_locks.sql).
-- Already applied to production Supabase via MCP on 2026-05-08; this file
-- lands the IaC trail. DROP POLICY IF EXISTS makes it safe to re-run.
--
-- Pre-condition (verified 2026-05-08 via MCP supabase):
--   8 tables had RLS=on AND 0 policies (implicit lockdown):
--     agent_memory, autonomy_audits, autonomy_briefings, brand_profiles,
--     carlos_knowledge, client_knowledge, jobs, marketing_jobs.
--   brand_profiles is dropped in BK-003 / migration 021 — skipped here.
--
-- All 7 remaining are accessed exclusively by server-side service-role
-- code paths — verified via grep across agents/, workers/, scripts/,
-- lib/, tools/, index.js, and dashboard/src/. The dashboard frontend
-- never queries these tables directly (zero `.from('<tbl>')` hits in
-- dashboard/src/).
--
-- Implicit lockdown (RLS on, 0 policies) IS secure against anon and
-- authenticated callers (deny by default). However, an empty policy list
-- is ambiguous to a future engineer who might assume "policies haven't
-- been written yet" and add an open one by mistake.
--
-- This migration makes the lockdown EXPLICIT:
--   CREATE POLICY "service_role_only" ON <tbl> FOR ALL TO public
--     USING (false) WITH CHECK (false);
-- service_role bypasses RLS by design, so this only restricts anon and
-- authenticated. No behavior change for current code.
--
-- COMMENT ON TABLE documents the intent for future readers.

BEGIN;

-- Idempotent CREATE POLICY: drop the existing one first if present.
DROP POLICY IF EXISTS "service_role_only" ON public.agent_memory;
CREATE POLICY "service_role_only" ON public.agent_memory
  FOR ALL TO public USING (false) WITH CHECK (false);
COMMENT ON TABLE public.agent_memory IS
  'Service-role only. Per-agent memory store written by lib/AgentRuntime.js + tools/database.js. RLS denies anon/authenticated access; service_role bypasses RLS by design.';

DROP POLICY IF EXISTS "service_role_only" ON public.autonomy_audits;
CREATE POLICY "service_role_only" ON public.autonomy_audits
  FOR ALL TO public USING (false) WITH CHECK (false);
COMMENT ON TABLE public.autonomy_audits IS
  'Service-role only. Layer 1 nightly auditor output (workers/nightly_auditor.js). When dashboard exposure is needed, add a brand-scoped READ policy ON TOP of this deny rule (PostgreSQL RLS is permissive — additional policies broaden access).';

DROP POLICY IF EXISTS "service_role_only" ON public.autonomy_briefings;
CREATE POLICY "service_role_only" ON public.autonomy_briefings
  FOR ALL TO public USING (false) WITH CHECK (false);
COMMENT ON TABLE public.autonomy_briefings IS
  'Service-role only. Layer 2 morning briefing session ledger written by scripts/morning_briefing.js. RLS denies anon/authenticated access; service_role bypasses RLS by design.';

DROP POLICY IF EXISTS "service_role_only" ON public.carlos_knowledge;
CREATE POLICY "service_role_only" ON public.carlos_knowledge
  FOR ALL TO public USING (false) WITH CHECK (false);
COMMENT ON TABLE public.carlos_knowledge IS
  'Service-role only. Carlos agent vector knowledge store written by tools/carlosKnowledge.js + scripts/seed_*.js + scripts/vectorize_knowledge.js. Server-side only.';

DROP POLICY IF EXISTS "service_role_only" ON public.client_knowledge;
CREATE POLICY "service_role_only" ON public.client_knowledge
  FOR ALL TO public USING (false) WITH CHECK (false);
COMMENT ON TABLE public.client_knowledge IS
  'Service-role only. Client-knowledge store written by tools/apifyInstagram.js + workers/transcription_worker.js. Server-side only.';

DROP POLICY IF EXISTS "service_role_only" ON public.jobs;
CREATE POLICY "service_role_only" ON public.jobs
  FOR ALL TO public USING (false) WITH CHECK (false);
COMMENT ON TABLE public.jobs IS
  'Service-role only. Background job queue accessed via getPendingJobs/updateJobStatus helpers in lib/supabase.js. Cron at index.js polls for APPROVED status. Server-side only.';

DROP POLICY IF EXISTS "service_role_only" ON public.marketing_jobs;
CREATE POLICY "service_role_only" ON public.marketing_jobs
  FOR ALL TO public USING (false) WITH CHECK (false);
COMMENT ON TABLE public.marketing_jobs IS
  'Service-role only. Marketing job records (currently empty). Server-side only.';

COMMIT;

-- Post-condition:
--   SELECT tablename, COUNT(*) AS policy_count FROM pg_policies
--   WHERE schemaname='public' AND tablename IN
--     ('agent_memory','autonomy_audits','autonomy_briefings',
--      'carlos_knowledge','client_knowledge','jobs','marketing_jobs')
--   GROUP BY tablename;
-- Expected: each tablename has policy_count >= 1.
