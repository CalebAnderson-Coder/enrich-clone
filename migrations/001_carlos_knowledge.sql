-- ============================================================
-- Migration: Create carlos_knowledge table
-- Run this in Supabase Dashboard > SQL Editor
-- URL: https://supabase.com/dashboard/project/wzdhxnnpupbybxzbdrna/sql/new
-- ============================================================

CREATE TABLE IF NOT EXISTS carlos_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR NOT NULL DEFAULT 'instagram_post',
    caption TEXT,
    transcription TEXT,
    hashtags TEXT[],
    topic_tags TEXT[],
    likes_count INT DEFAULT 0,
    comments_count INT DEFAULT 0,
    engagement_score FLOAT DEFAULT 0,
    post_date TIMESTAMP WITH TIME ZONE,
    source_url VARCHAR,
    raw_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- GIN index for fast array overlap queries (topic filtering)
CREATE INDEX IF NOT EXISTS idx_carlos_knowledge_topic_tags 
    ON carlos_knowledge USING GIN (topic_tags);

-- B-tree index for filtering by source type
CREATE INDEX IF NOT EXISTS idx_carlos_knowledge_source_type 
    ON carlos_knowledge (source_type);

-- Engagement index for sorting by best performing content
CREATE INDEX IF NOT EXISTS idx_carlos_knowledge_engagement
    ON carlos_knowledge (engagement_score DESC);

-- Enable Row Level Security (allow service role full access)
ALTER TABLE carlos_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to carlos_knowledge"
  ON carlos_knowledge
  USING (true)
  WITH CHECK (true);
