-- Extracted basic prospect info
CREATE TABLE IF NOT EXISTS prospects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    niche_id INT,
    city VARCHAR,
    business_name VARCHAR NOT NULL,
    website VARCHAR,
    phone VARCHAR,
    rating FLOAT,
    reviews_count INT,
    google_maps_url VARCHAR,
    raw_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- AI Enriched data and campaign copies
CREATE TABLE IF NOT EXISTS campaign_enriched_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prospect_id UUID REFERENCES prospects(id) ON DELETE CASCADE,
    radiography_technical TEXT,
    attack_angle TEXT,
    outreach_copy TEXT,
    status VARCHAR DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);
