-- ============================================================
-- 019_atlas_hardening.sql — Atlas v2 audit fixes
--
-- Auditor finding F8: anon SELECT con USING(true) sobre fleet_audits
-- expone process_id UUIDs y mensajes de error de DB en findings.detail.
-- Fix: drop the open policy y reemplazar por una vista filtrada que
-- redacta los detalles internos antes de exponerlos al dashboard.
-- ============================================================

DROP POLICY IF EXISTS fleet_audits_anon_demo_select ON public.fleet_audits;

CREATE OR REPLACE VIEW public.fleet_audits_public AS
SELECT
  id,
  brand_id,
  status,
  alive_count,
  stale_count,
  crashed_count,
  stuck_messages,
  failed_1h,
  -- Sanitized findings: keep kind/severity/agent/detail but strip
  -- raw process_id UUIDs and error-message bodies from detail.
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'kind',     f->>'kind',
        'severity', f->>'severity',
        'agent',    f->>'agent',
        'detail',   regexp_replace(
                      regexp_replace(coalesce(f->>'detail', ''),
                        '\(process_id [0-9a-f-]+\)', '', 'g'),
                      'failed: .*$', 'failed', 'g')
      )
    )
    FROM jsonb_array_elements(findings) AS f
  ) AS findings,
  jsonb_build_object(
    'recovered_orphans', metrics->'recovered_orphans',
    'audited_at',        metrics->'audited_at',
    'failed_1h',         metrics->'failed_1h',
    'circuits_open',     metrics->'circuits_open',
    'fingerprint',       metrics->'fingerprint'
  ) AS metrics,
  alerted,
  created_at
FROM public.fleet_audits;

GRANT SELECT ON public.fleet_audits_public TO anon;
