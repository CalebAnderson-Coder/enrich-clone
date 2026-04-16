-- ============================================================
-- schema.sql — Production-aligned schema for Empirika enrich-clone
-- Last synced with Supabase production: 2026-04-12
--
-- This schema backs the Empírika AI Marketing Fleet:
--   • leads            — Prospected businesses (Scout agent)
--   • campaign_…       — Enrichment + outreach artifacts per lead
--   • brands           — Client/brand configurations
--   • marketing_jobs   — Async job queue for agent tasks
--   • agent_memory     — Persistent KV store for agent learning
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- LEADS — Core prospect table
-- Populated by the Scout agent via Google Maps scraping.
-- Enriched by Helena (SEO), Sam (Ads), Kai (Social), Carlos (Strategy).
-- Column names match PRODUCTION Supabase (verified via check_schema.js).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity & classification
    business_name VARCHAR NOT NULL,          -- Official business name from Google Maps
    owner_name VARCHAR,                      -- Owner name (if discovered during enrichment)
    industry VARCHAR,                        -- Niche/vertical: landscaping, remodeling, etc.
    metro_area VARCHAR,                      -- Metro market (e.g. "Miami FL", "Houston TX")

    -- Contact info
    phone VARCHAR,
    email VARCHAR,                           -- Generic contact email (from Maps)
    email_address VARCHAR,                   -- Verified outreach email (discovered later)
    website VARCHAR,

    -- Google Maps presence
    google_maps_url VARCHAR,
    gmb_active BOOLEAN,                      -- TRUE = passed GATE filter (has active GMB listing)
    review_count INTEGER DEFAULT 0,          -- Total Google reviews (NOTE: prod column = review_count, NOT reviews_count)
    rating NUMERIC(2,1) DEFAULT 0,           -- Google rating 1.0–5.0

    -- Qualification & scoring (computed by Scout)
    has_website BOOLEAN,                     -- Quick flag: does the business have any website?
    qualification_score NUMERIC DEFAULT 0,   -- 0–100 composite score from GATE filters
    lead_tier VARCHAR DEFAULT 'COLD',        -- HOT | WARM | COOL | COLD
    score_breakdown JSONB,                   -- Per-category score detail (SEO, Social, Ads, etc.)

    -- Enrichment data
    scraped_by VARCHAR,                      -- Agent that created this lead (usually 'scout')
    mega_profile JSONB,                      -- Full enrichment payload from all specialist agents
    profiled_by VARCHAR,                     -- Agents that contributed to mega_profile

    -- Multi-tenancy
    brand_id UUID NOT NULL REFERENCES brands(id),  -- Tenant (client) that owns this lead

    -- Social presence URLs (discovered during enrichment)
    facebook_url VARCHAR,
    instagram_url VARCHAR,
    linkedin_url VARCHAR,

    -- Outreach tracking
    outreach_status VARCHAR,                 -- PENDING | CONTACTED | RESPONDED | MEETING_SET | CLOSED | NURTURING | DEAD
    first_contact_date TIMESTAMPTZ,          -- When first outreach was sent
    last_contact_date TIMESTAMPTZ,           -- Most recent outreach touchpoint
    notes TEXT,                              -- Free-form notes from agents or operators

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);


-- ────────────────────────────────────────────────────────────
-- CAMPAIGN_ENRICHED_DATA — Per-lead enrichment & outreach artifacts
-- Created after the "Francotirador" (Sniper) macro-flow:
--   1. Technical radiography (Helena+Sam+Kai)
--   2. Attack angle (Carlos)
--   3. Outreach copy (Angela)
-- Also tracks lead magnet generation (DaVinci) and email dispatch.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_enriched_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prospect_id UUID REFERENCES leads(id) ON DELETE CASCADE,  -- FK to leads table
    brand_id UUID NOT NULL REFERENCES brands(id),             -- Tenant (client) that owns this campaign

    -- Agent-generated content
    radiography_technical TEXT,              -- Technical audit: SEO, speed, ads, social presence
    attack_angle TEXT,                       -- Carlos's strategic sales angle
    outreach_copy TEXT,                      -- Angela's multi-channel outreach messages
    status VARCHAR DEFAULT 'PENDING',        -- PENDING | ENRICHED | SENT | FAILED

    -- Lead magnet pipeline (DaVinci agent)
    lead_magnet_status VARCHAR DEFAULT 'IDLE',  -- IDLE | GENERATING | COMPLETED | FAILED
    lead_magnets_data JSONB,                    -- Generated landing page / creative assets

    -- Email dispatch tracking
    outreach_status VARCHAR DEFAULT NULL,    -- NULL = not dispatched | SENT | FAILED
    email_sent_at TIMESTAMPTZ,              -- When the outreach email was sent
    email_resend_id TEXT,                    -- Resend.com message ID for tracking

    -- Human-in-the-loop approval workflow
    approval_status VARCHAR DEFAULT 'DRAFT',       -- DRAFT | APPROVED | REJECTED
    rejection_reason TEXT,                          -- Operator's reason for rejection
    email_draft_subject TEXT,                       -- Pre-rendered subject line for preview
    email_draft_html TEXT,                          -- Pre-rendered HTML body for preview
    approved_at TIMESTAMPTZ,                        -- Timestamp of approval

    -- GoHighLevel CRM integration
    ghl_contact_id VARCHAR,                         -- GHL contact ID (synced after dispatch)
    ghl_tag VARCHAR DEFAULT NULL,                   -- Pipeline tag: 'Enviado' | 'Interesado'

    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);


-- ────────────────────────────────────────────────────────────
-- BRANDS — Client/brand configuration
-- Each brand represents an Empírika client with their own profile,
-- tone, audience, and marketing goals.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR NOT NULL,                   -- Brand/client display name
    industry VARCHAR,                        -- Client's industry vertical
    website VARCHAR,                         -- Client's website
    brand_profile JSONB,                     -- Tone, audience, guidelines, brand assets
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now())
);


-- ────────────────────────────────────────────────────────────
-- MARKETING_JOBS — Async job queue for agent tasks
-- Jobs flow: PENDING → APPROVED → EXECUTED | FAILED
-- Created via API dispatch or cron scheduler.
-- Human approval required before execution (HITL pattern).
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id),     -- FK to brands table
    agent_name VARCHAR,                      -- Target agent: Angela, Carlos, Scout, etc.
    task_type VARCHAR NOT NULL,              -- cold_outreach | email_campaign | social_post | seo_audit
    payload JSONB,                           -- Task-specific data (lead info, instructions, etc.)
    status VARCHAR DEFAULT 'PENDING',        -- PENDING | APPROVED | EXECUTED | FAILED | REJECTED
    result JSONB,                            -- Agent's execution result
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    completed_at TIMESTAMPTZ                 -- When job reached terminal state
);


-- ────────────────────────────────────────────────────────────
-- AGENT_MEMORY — Persistent key-value store for agent learning
-- Agents save insights, best practices, and context here.
-- Used by Angela (email patterns), Carlos (strategy knowledge), etc.
-- UPSERT on (agent_name, memory_key) ensures no duplicates.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name VARCHAR NOT NULL,             -- Which agent owns this memory
    memory_key VARCHAR NOT NULL,             -- Topic/key (e.g. "best_subject_lines")
    memory_value TEXT,                       -- The stored knowledge/insight
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()),
    UNIQUE(agent_name, memory_key)           -- One value per agent+key combination
);


-- ════════════════════════════════════════════════════════════
-- INDEXES — Performance optimization for common query patterns
-- ════════════════════════════════════════════════════════════

-- Leads: filter by market, tier, outreach status, rating, and tenant
CREATE INDEX IF NOT EXISTS idx_leads_metro ON leads(metro_area);
CREATE INDEX IF NOT EXISTS idx_leads_tier ON leads(lead_tier);
CREATE INDEX IF NOT EXISTS idx_leads_outreach ON leads(outreach_status);
CREATE INDEX IF NOT EXISTS idx_leads_rating ON leads(rating);
CREATE INDEX IF NOT EXISTS idx_leads_brand ON leads(brand_id);

-- Campaign: lookup by status, FK joins, and tenant
CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaign_enriched_data(status);
CREATE INDEX IF NOT EXISTS idx_campaign_prospect ON campaign_enriched_data(prospect_id);
CREATE INDEX IF NOT EXISTS idx_campaign_brand ON campaign_enriched_data(brand_id);

-- Outreach dispatcher: find leads ready for email (magnet done, not yet sent)
CREATE INDEX IF NOT EXISTS idx_outreach_dispatch
  ON campaign_enriched_data(outreach_status, lead_magnet_status)
  WHERE outreach_status IS NULL AND lead_magnet_status = 'COMPLETED';

-- Jobs: cron scheduler queries pending/approved jobs
CREATE INDEX IF NOT EXISTS idx_jobs_status ON marketing_jobs(status);

-- Memory: agent recall lookups
CREATE INDEX IF NOT EXISTS idx_memory_agent ON agent_memory(agent_name, memory_key);


-- ════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- All tables are RLS-protected. Currently using permissive policies
-- for service_role (internal agent access). Tighten for multi-tenant.
-- ════════════════════════════════════════════════════════════
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_enriched_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

-- Permissive policies: service_role has unrestricted access.
-- Tenant isolation is enforced at the APPLICATION layer (via brand_id injected
-- on every INSERT and filtered on every SELECT). The service_role bypasses RLS
-- because the backend handles scoping deterministically.
-- Phase C (per-tenant JWT auth) will introduce restrictive RLS policies that
-- match a `brand_id` claim from the JWT against each row's brand_id column.
CREATE POLICY "Enable all operations for service_role on leads" on leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on campaign" on campaign_enriched_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on brands" on brands FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on jobs" on marketing_jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on memory" on agent_memory FOR ALL USING (true) WITH CHECK (true);
