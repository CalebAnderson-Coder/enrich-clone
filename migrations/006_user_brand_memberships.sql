-- ============================================================
-- 006_user_brand_memberships.sql
-- Per-user tenant membership table for JWT multi-tenancy (Fase C).
-- Applied via MCP as supabase_migrations version 20260416195752.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_brand_memberships (
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    brand_id   UUID NOT NULL REFERENCES brands(id)    ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','operator','viewer')),
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, brand_id)
);

CREATE INDEX IF NOT EXISTS idx_user_brand_memberships_user
    ON user_brand_memberships(user_id);

CREATE INDEX IF NOT EXISTS idx_user_brand_memberships_brand
    ON user_brand_memberships(brand_id);

ALTER TABLE user_brand_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "memberships_service_role_all" ON user_brand_memberships;
CREATE POLICY "memberships_service_role_all" ON user_brand_memberships
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "memberships_authenticated_read_own" ON user_brand_memberships;
CREATE POLICY "memberships_authenticated_read_own" ON user_brand_memberships
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());
