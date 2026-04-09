-- ============================================================
-- Empírika Lead Pipeline — Table: leads
-- Run this in your Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Basic Info (from Google Maps scraping)
  business_name TEXT NOT NULL,
  owner_name TEXT,
  industry TEXT,
  metro_area TEXT,
  address TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  google_maps_url TEXT,
  
  -- Qualification Data
  gmb_active BOOLEAN DEFAULT false,
  review_count INTEGER DEFAULT 0,
  rating DECIMAL(2,1) DEFAULT 0,
  last_review_date TIMESTAMPTZ,
  has_website BOOLEAN DEFAULT false,
  
  -- Scoring
  qualification_score INTEGER DEFAULT 0,  -- 0-100
  lead_tier TEXT CHECK (lead_tier IN ('HOT', 'WARM', 'COOL', 'COLD', 'DISQUALIFIED')),
  score_breakdown JSONB DEFAULT '{}',  -- { web_quality: 20, instagram: 15, ... }
  
  -- Enrichment (MEGA Profile)
  mega_profile JSONB,  -- Full enrichment output from all agents
  competitor_analysis JSONB,
  review_sentiment JSONB,
  tech_stack JSONB,
  social_presence JSONB,
  
  -- Outreach Tracking
  outreach_status TEXT DEFAULT 'PENDING' CHECK (outreach_status IN ('PENDING', 'CONTACTED', 'RESPONDED', 'MEETING_SET', 'CLOSED', 'NURTURING', 'DEAD')),
  outreach_channel TEXT,
  first_contact_date TIMESTAMPTZ,
  last_contact_date TIMESTAMPTZ,
  notes TEXT,
  
  -- Meta
  scraped_by TEXT DEFAULT 'scout',
  profiled_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_leads_tier
  ON leads(lead_tier);
CREATE INDEX IF NOT EXISTS idx_leads_metro
  ON leads(metro_area);
CREATE INDEX IF NOT EXISTS idx_leads_industry
  ON leads(industry);
CREATE INDEX IF NOT EXISTS idx_leads_outreach
  ON leads(outreach_status);
CREATE INDEX IF NOT EXISTS idx_leads_score
  ON leads(qualification_score DESC);

-- Convenience view: leads ready for outreach (HOT first)
CREATE OR REPLACE VIEW leads_outreach_queue AS
SELECT
  id,
  business_name,
  industry,
  metro_area,
  phone,
  email,
  website,
  rating,
  review_count,
  qualification_score,
  lead_tier,
  outreach_status,
  mega_profile IS NOT NULL AS has_mega_profile,
  created_at
FROM leads
WHERE outreach_status = 'PENDING'
  AND lead_tier IN ('HOT', 'WARM')
ORDER BY 
  CASE lead_tier WHEN 'HOT' THEN 1 WHEN 'WARM' THEN 2 ELSE 3 END,
  qualification_score DESC;

-- RLS (Row Level Security) — Allow anon key full access for this project
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on leads" ON leads
  FOR ALL
  USING (true)
  WITH CHECK (true);
