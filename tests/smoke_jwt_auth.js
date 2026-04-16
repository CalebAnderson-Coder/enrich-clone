// ============================================================
// tests/smoke_jwt_auth.js — Isolated smoke test for Fase C JWT layer
// ------------------------------------------------------------
// Validates:
//   1. Supabase admin.generateLink → verifyOtp mints a session for Brian
//   2. authMiddleware accepts JWT, populates req.user.{brandId,role,authMode:'jwt'}
//   3. Legacy API_SECRET_KEY Bearer still works (req.user.authMode='legacy_bearer')
//   4. No Bearer → 401
//   5. getLeadsStats(brandId) scopes results to Empírika tenant
//
// Runs a throwaway Express app on an ephemeral port. No production impact.
// ============================================================

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

import { authMiddleware } from '../lib/auth.js';
import { getLeadsStats } from '../tools/database.js';

const BRIAN_EMAIL  = 'brian@doublemybookings.com';
const EMPIRIKA_ID  = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const API_SECRET   = process.env.API_SECRET_KEY;

const FAILS = [];
const PASSES = [];
const pass = (msg) => { PASSES.push(msg); console.log(`  ✅ ${msg}`); };
const fail = (msg) => { FAILS.push(msg);  console.error(`  ❌ ${msg}`); };

function eq(got, want, label) {
  if (got === want) pass(`${label} = ${JSON.stringify(got)}`);
  else fail(`${label} expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
}

async function mintBrianJWT() {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type:  'magiclink',
    email: BRIAN_EMAIL,
  });
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);

  const hashed_token = linkData?.properties?.hashed_token;
  if (!hashed_token) throw new Error(`no hashed_token in generateLink response`);

  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: sess, error: sErr } = await anon.auth.verifyOtp({
    token_hash: hashed_token,
    type:       'magiclink',
  });
  if (sErr) throw new Error(`verifyOtp failed: ${sErr.message}`);
  if (!sess?.session?.access_token) throw new Error(`no access_token in session`);
  return sess.session.access_token;
}

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);

  app.get('/api/me', (req, res) => {
    res.json({ user: req.user });
  });

  app.get('/api/leads-stats', async (req, res) => {
    try {
      const stats = await getLeadsStats(req.user.brandId);
      res.json({ brandId: req.user.brandId, stats });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

async function get(port, path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  console.log('\n═══ Fase C JWT smoke test ═══\n');

  // ── Sanity checks on env ────────────────────────────────────
  for (const v of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'API_SECRET_KEY']) {
    if (!process.env[v]) { fail(`env ${v} missing`); process.exit(1); }
  }
  pass('env vars present');

  // ── Mint JWT via admin.generateLink ────────────────────────
  const jwt = await mintBrianJWT();
  pass(`JWT minted for Brian (len=${jwt.length})`);

  // ── Boot test app ──────────────────────────────────────────
  const app = buildTestApp();
  const server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  console.log(`  → test server on port ${port}\n`);

  // ── 1. No Bearer → 401 ─────────────────────────────────────
  console.log('TEST 1: no Bearer → 401');
  {
    const r = await get(port, '/api/me', null);
    eq(r.status, 401, 'status');
  }

  // ── 2. Legacy Bearer → authMode=legacy_bearer ──────────────
  console.log('\nTEST 2: legacy Bearer → authMode=legacy_bearer');
  {
    const r = await get(port, '/api/me', API_SECRET);
    eq(r.status, 200, 'status');
    eq(r.body?.user?.authMode, 'legacy_bearer', 'authMode');
    eq(r.body?.user?.brandId,  EMPIRIKA_ID,     'brandId (from env BRAND_ID)');
    eq(r.body?.user?.role,     'legacy',        'role');
  }

  // ── 3. JWT Bearer → authMode=jwt + membership lookup ──────
  console.log('\nTEST 3: JWT Bearer → authMode=jwt (real membership lookup)');
  {
    const r = await get(port, '/api/me', jwt);
    eq(r.status, 200, 'status');
    eq(r.body?.user?.authMode, 'jwt',           'authMode');
    eq(r.body?.user?.brandId,  EMPIRIKA_ID,     'brandId (from membership)');
    eq(r.body?.user?.role,     'owner',         'role');
    if (r.body?.user?.userId) pass(`userId = ${r.body.user.userId}`);
    else fail('userId missing');
  }

  // ── 4. Invalid JWT → 401 ───────────────────────────────────
  console.log('\nTEST 4: invalid JWT → 401');
  {
    const r = await get(port, '/api/me', 'not.a.real.jwt');
    eq(r.status, 401, 'status');
  }

  // ── 5. Data-layer scoping via req.user.brandId ─────────────
  console.log('\nTEST 5: getLeadsStats scoped to Empírika brandId');
  {
    const r = await get(port, '/api/leads-stats', jwt);
    eq(r.status, 200, 'status');
    eq(r.body?.brandId, EMPIRIKA_ID, 'brandId echo');
    if (r.body?.stats && typeof r.body.stats === 'object') {
      const totalByTier = Object.values(r.body.stats.byTier || {}).reduce((a, b) => a + b, 0);
      pass(`stats byTier total=${totalByTier} metros=${Object.keys(r.body.stats.byMetro || {}).length}`);
    } else {
      fail('stats object missing');
    }
  }

  // ── Cleanup ────────────────────────────────────────────────
  server.close();

  console.log(`\n═══ Result: ${PASSES.length} passed, ${FAILS.length} failed ═══`);
  if (FAILS.length) {
    console.error('\nFailures:');
    FAILS.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ UNCAUGHT:', err.stack || err.message);
  process.exit(1);
});
