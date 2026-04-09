-- ============================================================
-- Supabase Schema Migration: AI Marketing Agency
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Brand Profiles — Client/Brand configurations
CREATE TABLE IF NOT EXISTS brand_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT,
  tone TEXT DEFAULT 'professional',
  target_audience TEXT,
  brand_voice TEXT,
  website_url TEXT,
  social_links JSONB DEFAULT '{}',
  goals JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Marketing Jobs — The task queue (state machine)
CREATE TABLE IF NOT EXISTS marketing_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id UUID REFERENCES brand_profiles(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  task_type TEXT NOT NULL CHECK (task_type IN (
    'blog', 'email_campaign', 'social_batch', 'seo_audit',
    'ad_campaign', 'competitor_analysis', 'newsletter',
    'content_calendar', 'cold_outreach', 'custom'
  )),
  payload JSONB DEFAULT '{}',
  result JSONB,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'IN_PROGRESS', 'AWAITING_APPROVAL',
    'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED'
  )),
  created_at TIMESTAMPTZ DEFAULT now(),
  executed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Agent Memory — Persistent knowledge per agent per brand
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name TEXT NOT NULL,
  brand_id UUID REFERENCES brand_profiles(id) ON DELETE CASCADE,
  memory_key TEXT NOT NULL,
  memory_value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_name, brand_id, memory_key)
);

-- 4. Content Library — Published/Draft content archive
CREATE TABLE IF NOT EXISTS content_library (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_id UUID REFERENCES brand_profiles(id) ON DELETE CASCADE,
  job_id UUID REFERENCES marketing_jobs(id) ON DELETE SET NULL,
  content_type TEXT NOT NULL CHECK (content_type IN (
    'blog_post', 'email', 'social_post', 'ad_copy',
    'landing_page', 'newsletter', 'other'
  )),
  title TEXT,
  content TEXT,
  metadata JSONB DEFAULT '{}',
  channels TEXT[] DEFAULT '{}',
  published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Performance Metrics — Track content performance over time
CREATE TABLE IF NOT EXISTS performance_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  content_id UUID REFERENCES content_library(id) ON DELETE CASCADE,
  brand_id UUID REFERENCES brand_profiles(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL,
  metric_value NUMERIC,
  recorded_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Indexes for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_jobs_status ON marketing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_brand ON marketing_jobs(brand_id);
CREATE INDEX IF NOT EXISTS idx_jobs_agent ON marketing_jobs(agent_name);
CREATE INDEX IF NOT EXISTS idx_memory_agent_brand ON agent_memory(agent_name, brand_id);
CREATE INDEX IF NOT EXISTS idx_content_brand ON content_library(brand_id);
CREATE INDEX IF NOT EXISTS idx_content_type ON content_library(content_type);
CREATE INDEX IF NOT EXISTS idx_metrics_content ON performance_metrics(content_id);

-- ============================================================
-- Updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER tr_brand_profiles_updated
  BEFORE UPDATE ON brand_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER tr_marketing_jobs_updated
  BEFORE UPDATE ON marketing_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Enable RLS
-- ============================================================
ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (for server-side operations)
CREATE POLICY "Service role full access" ON brand_profiles
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON marketing_jobs
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON agent_memory
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON content_library
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON performance_metrics
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Seed demo brand profile
-- ============================================================
INSERT INTO brand_profiles (name, industry, tone, target_audience, brand_voice, website_url, goals)
VALUES (
  'Demo Brand',
  'Technology / SaaS',
  'professional-casual',
  'Founders, CTOs, and tech leaders at Series A-C startups (25-45 years old)',
  'Confident, data-driven, no corporate jargon. We speak like a smart friend who happens to be an expert.',
  'https://demo-brand.example.com',
  '["Increase organic traffic by 40%", "Build email list to 10K subscribers", "Launch LinkedIn thought leadership program"]'
) ON CONFLICT DO NOTHING;
