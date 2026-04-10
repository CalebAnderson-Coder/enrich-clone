CREATE EXTENSION IF NOT EXISTS vector;

-- Extracted basic prospect info
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    niche_id INT,
    city VARCHAR,
    business_name VARCHAR NOT NULL,
    website VARCHAR,
    phone VARCHAR,
    rating FLOAT,
    reviews_count INT,
    google_maps_url VARCHAR,
    facebook_url VARCHAR,
    instagram_url VARCHAR,
    linkedin_url VARCHAR,
    raw_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- AI Enriched data and campaign copies
CREATE TABLE IF NOT EXISTS campaign_enriched_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prospect_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    radiography_technical TEXT,
    attack_angle TEXT,
    outreach_copy TEXT,
    status VARCHAR DEFAULT 'PENDING',
    lead_magnet_status VARCHAR DEFAULT 'IDLE',
    lead_magnets_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Internal memory of Carlos (Your Agency's tone, offers, etc.)
CREATE TABLE IF NOT EXISTS carlos_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type VARCHAR,
    caption TEXT,
    transcription TEXT,
    engagement_score INT,
    post_date TIMESTAMP WITH TIME ZONE,
    source_url VARCHAR UNIQUE,
    raw_data JSONB,
    embedding VECTOR(768), -- Asumiendo Gemini text-embedding-004. Cambiar a 1536 si usas OpenAI
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Deep context extracted from prospects (Their brand voice, style, videos)
CREATE TABLE IF NOT EXISTS client_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prospect_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    source_type VARCHAR,
    caption TEXT,
    transcription TEXT,
    engagement_score INT,
    post_date TIMESTAMP WITH TIME ZONE,
    source_url VARCHAR UNIQUE,
    raw_data JSONB,
    embedding VECTOR(768),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- Cola de misiones para oh-my-openagent (Cerebro + Manos)
CREATE TABLE IF NOT EXISTS agent_misions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prospect_id UUID REFERENCES leads(id) ON DELETE CASCADE,
    type VARCHAR, -- Ej 'BROWSER_SCRAPE', 'LINKEDIN_CONNECT'
    instruction TEXT,
    payload JSONB,
    result JSONB,
    status VARCHAR DEFAULT 'PENDING', -- PENDING, COMPLETED, FAILED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);
