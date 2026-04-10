// Temporary script to check/create carlos_knowledge table
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Check if table exists
const { data, error } = await supabase.from('carlos_knowledge').select('id').limit(1);

if (error && error.code === '42P01') {
  console.log('⚠️  Table carlos_knowledge does NOT exist in Supabase yet.');
  console.log('');
  console.log('Please run this SQL in Supabase Dashboard > SQL Editor:');
  console.log('https://supabase.com/dashboard/project/wzdhxnnpupbybxzbdrna/sql');
  console.log('');
  console.log(`
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
CREATE INDEX IF NOT EXISTS idx_carlos_knowledge_topic_tags ON carlos_knowledge USING GIN (topic_tags);
CREATE INDEX IF NOT EXISTS idx_carlos_knowledge_source_type ON carlos_knowledge (source_type);
  `);
} else if (error) {
  console.error('❌ Unexpected error:', error.message);
} else {
  console.log('✅ Table carlos_knowledge exists! Ready to seed.');
}
