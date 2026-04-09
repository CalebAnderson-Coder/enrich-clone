-- Tabla para almacenar prospectos encontrados (Leads)
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name text,
    industry text,
    metro_area text,
    qualification_score integer DEFAULT 0,
    phone text,
    email text,
    google_maps_url text,
    website text,
    rating numeric,
    review_count integer,
    mega_profile jsonb,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);

-- Tabla para rastrear la ejecución de los flujos de n8nH (Jobs)
CREATE TABLE IF NOT EXISTS public.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name text,
    task_type text,
    status text DEFAULT 'PENDING',
    payload jsonb,
    result jsonb,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);
