-- UPDATE SCHEMA
ALTER TABLE campaign_enriched_data ADD COLUMN lead_magnet_status VARCHAR DEFAULT 'IDLE';
ALTER TABLE campaign_enriched_data ADD COLUMN lead_magnets_data JSONB;
