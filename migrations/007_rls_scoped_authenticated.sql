-- ============================================================
-- 007_rls_scoped_authenticated.sql
-- Additive policies for the 'authenticated' role: users see/write
-- only data for brands they're members of. service_role retains
-- full bypass (daemons, workers, admin).
-- Applied via MCP as supabase_migrations version 20260416200900.
-- ============================================================

-- ── leads ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "leads_authenticated_tenant" ON leads;
CREATE POLICY "leads_authenticated_tenant" ON leads
    FOR ALL TO authenticated
    USING (
        brand_id IN (
            SELECT brand_id FROM user_brand_memberships
            WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        brand_id IN (
            SELECT brand_id FROM user_brand_memberships
            WHERE user_id = auth.uid()
        )
    );

-- ── campaign_enriched_data ─────────────────────────────────
DROP POLICY IF EXISTS "campaign_authenticated_tenant" ON campaign_enriched_data;
CREATE POLICY "campaign_authenticated_tenant" ON campaign_enriched_data
    FOR ALL TO authenticated
    USING (
        brand_id IN (
            SELECT brand_id FROM user_brand_memberships
            WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        brand_id IN (
            SELECT brand_id FROM user_brand_memberships
            WHERE user_id = auth.uid()
        )
    );

-- ── brands ─────────────────────────────────────────────────
-- Users can SELECT their own brands. Writes restricted to service_role.
DROP POLICY IF EXISTS "brands_authenticated_read_own" ON brands;
CREATE POLICY "brands_authenticated_read_own" ON brands
    FOR SELECT TO authenticated
    USING (
        id IN (
            SELECT brand_id FROM user_brand_memberships
            WHERE user_id = auth.uid()
        )
    );
