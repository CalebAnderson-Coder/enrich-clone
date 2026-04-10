-- ============================================================
-- schema_update_outreach.sql
-- Aplica en Supabase SQL Editor
-- Agrega campos de outreach a las tablas existentes
-- ============================================================

-- 1. Columna email_address en leads (tabla real donde están los prospectos)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS email_address VARCHAR;

-- 2. Columnas de tracking de outreach y magnet en campaign_enriched_data
ALTER TABLE campaign_enriched_data
  ADD COLUMN IF NOT EXISTS lead_magnet_status VARCHAR DEFAULT 'IDLE',
  ADD COLUMN IF NOT EXISTS lead_magnets_data JSONB,
  ADD COLUMN IF NOT EXISTS outreach_status  VARCHAR DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_resend_id  TEXT;

-- 3. Índice compuesto para que el dispatcher encuentre leads elegibles rápido
CREATE INDEX IF NOT EXISTS idx_outreach_dispatch
  ON campaign_enriched_data(outreach_status, lead_magnet_status)
  WHERE outreach_status IS NULL AND lead_magnet_status = 'COMPLETED';

-- 4. RPC helper: actualiza el campo lead_magnets_data (JSONB merge) sin sobrescribir todo
CREATE OR REPLACE FUNCTION update_magnet_data(
  p_campaign_id UUID,
  p_data        JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE campaign_enriched_data
  SET lead_magnets_data = COALESCE(lead_magnets_data, '{}'::jsonb) || p_data,
      updated_at        = now()
  WHERE id = p_campaign_id;
END;
$$;

-- 5. Verificación rápida — debe mostrar las columnas nuevas
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('leads', 'campaign_enriched_data')
  AND column_name IN (
    'email_address',
    'outreach_status',
    'email_sent_at',
    'email_resend_id'
  )
ORDER BY table_name, column_name;
