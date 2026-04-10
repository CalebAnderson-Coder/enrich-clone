// Create carlos_knowledge table via direct PostgreSQL connection to Supabase
import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT_REF    = SUPABASE_URL.match(/https:\/\/([^.]+)/)?.[1];

// Supabase direct DB connection uses postgres user + password = service_role JWT
// Connection string format for Supabase Transaction Pooler
// Password for direct DB is NOT the service_role key — we need the DB password
// Let's try the pooler connection string
// Supabase pooler: postgresql://postgres.[ref]@aws-0-us-east-2.pooler.supabase.com:6543/postgres
// But we don't have the DB password... Let's use a different approach

// Supabase exposes a SQL execution endpoint via their CLI-compatible REST API
// Actually the correct endpoint is: POST /query to the db endpoint
const dbUrl = `https://db.${PROJECT_REF}.supabase.co/query`;
console.log(`Trying direct DB query API: ${dbUrl}`);

const sql = `
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
`;

const res = await fetch(dbUrl, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

console.log(`Status: ${res.status} ${res.statusText}`);
const body = await res.text();
console.log('Response:', body.slice(0, 400));
