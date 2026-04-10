-- ============================================================
-- schema.sql — Production-aligned schema for Empirika enrich-clone
-- Last synced with Supabase production: 2026-04-10
-- ============================================================

-- Core leads table (production columns verified via check_schema.js)
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name VARCHAR NOT NULL,
    owner_name VARCHAR,
    industry VARCHAR,
    metro_area VARCHAR,
    phone VARCHAR,
    email VARCHAR,
    website VARCHAR,
    google_maps_url VARCHAR,
    gmb_active BOOLEAN,
    review_count INTEGER DEFAULT 0,
    rating NUMERIC(2,1) DEFAULT 0,
    has_website BOOLEAN,
    qualification_score NUMERIC DEFAULT 0,
    lead_tier VARCHAR DEFAULT 'COLD',
    score_breakdown JSONB,
    scraped_by VARCHAR,
    mega_profile JSONB,
    profiled_by VARCHAR,
    outreach_status VARCHAR,
    first_contact_date TIMESTAMPTZ,
    last_contact_date TIMESTAMPTZ,
    notes TEXT,
    facebook_url VARCHAR,
    instagram_url VARCHAR,
    linkedin_url VARCHAR,
    email_address VARCHAR,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Campaign enrichment data (FK → leads.id)
CREATE TABLE IF NOT EXISTS campaign_enriched_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prospect_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    radiography_technical TEXT,
    attack_angle TEXT,
    outreach_copy TEXT,
    status VARCHAR DEFAULT 'PENDING',
    lead_magnet_status VARCHAR DEFAULT 'IDLE',
    lead_magnets_data JSONB,
    outreach_status VARCHAR DEFAULT NULL,
    email_sent_at TIMESTAMPTZ,
    email_resend_id TEXT,
    -- Approval workflow columns
    approval_status VARCHAR DEFAULT 'DRAFT',       -- DRAFT | APPROVED | REJECTED
    rejection_reason TEXT,                          -- Client's reason for rejection
    email_draft_subject TEXT,                       -- Pre-rendered subject line for preview
    email_draft_html TEXT,                          -- Pre-rendered HTML for client preview
    approved_at TIMESTAMPTZ,                        -- When the client approved
    -- GHL integration columns
    ghl_contact_id VARCHAR,                         -- GoHighLevel contact ID
    ghl_tag VARCHAR DEFAULT NULL,                   -- Current GHL tag: 'Enviado' | 'Interesado'
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Brands / clients
CREATE TABLE IF NOT EXISTS brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR NOT NULL,
    industry VARCHAR,
    website VARCHAR,
    brand_profile JSONB,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);

-- Marketing jobs queue
CREATE TABLE IF NOT EXISTS marketing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id),
    task_type VARCHAR NOT NULL,
    payload JSONB,
    status VARCHAR DEFAULT 'PENDING',
    result JSONB,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    completed_at TIMESTAMPTZ
);

-- Agent memory (shared KV store)
CREATE TABLE IF NOT EXISTS agent_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name VARCHAR NOT NULL,
    memory_key VARCHAR NOT NULL,
    memory_value TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    UNIQUE(agent_name, memory_key)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_leads_metro ON leads(metro_area);
CREATE INDEX IF NOT EXISTS idx_leads_tier ON leads(lead_tier);
CREATE INDEX IF NOT EXISTS idx_leads_outreach ON leads(outreach_status);
CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaign_enriched_data(status);
CREATE INDEX IF NOT EXISTS idx_outreach_dispatch
  ON campaign_enriched_data(outreach_status, lead_magnet_status)
  WHERE outreach_status IS NULL AND lead_magnet_status = 'COMPLETED';
CREATE INDEX IF NOT EXISTS idx_jobs_status ON marketing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON agent_memory(agent_name, memory_key);
