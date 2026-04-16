// ============================================================
// lib/auth.js — Authentication middleware for /api/*
// Accepts two modes during Bloque 1 transition:
//   1. Supabase JWT (new)    — Bearer <access_token>
//   2. Legacy shared secret  — Bearer <API_SECRET_KEY> (Fase A.2)
// Populates req.user = { userId, brandId, role, authMode }
//
// Once the dashboard is fully on JWT and daemons iterate brands
// explicitly, set ALLOW_LEGACY_BEARER=false in env and remove the
// legacy branch.
// ============================================================

import { supabase } from './supabase.js';

const API_SECRET          = process.env.API_SECRET_KEY;
const LEGACY_BRAND_ID     = process.env.BRAND_ID || null;
const ALLOW_LEGACY_BEARER = process.env.ALLOW_LEGACY_BEARER !== 'false';

export async function authMiddleware(req, res, next) {
  if (req.method === 'OPTIONS') return next();

  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: missing Bearer token' });
  }

  // ── Legacy: shared API_SECRET_KEY ──────────────────────────
  if (ALLOW_LEGACY_BEARER && API_SECRET && token === API_SECRET) {
    if (!LEGACY_BRAND_ID) {
      return res.status(500).json({
        error: 'Legacy auth requires BRAND_ID env var. Configure it or migrate to JWT.'
      });
    }
    req.user = {
      userId:   null,
      brandId:  LEGACY_BRAND_ID,
      role:     'legacy',
      authMode: 'legacy_bearer',
    };
    return next();
  }

  // ── JWT: Supabase session token ────────────────────────────
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase client not initialized' });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }

    const userId = data.user.id;

    const { data: membership, error: memErr } = await supabase
      .from('user_brand_memberships')
      .select('brand_id, role')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (memErr) {
      console.error('[Auth] membership lookup error:', memErr.message);
      return res.status(500).json({ error: 'Auth lookup failed' });
    }
    if (!membership) {
      return res.status(403).json({ error: 'Forbidden: user has no brand membership' });
    }

    req.user = {
      userId,
      brandId:  membership.brand_id,
      role:     membership.role,
      authMode: 'jwt',
    };
    return next();
  } catch (err) {
    console.error('[Auth] unexpected error:', err.message);
    return res.status(500).json({ error: 'Auth error' });
  }
}
