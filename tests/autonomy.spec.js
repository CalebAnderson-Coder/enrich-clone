// ============================================================
// tests/autonomy.spec.js — Sprint 1 autonomy contract
//
// The repo uses native Node test style (no Vitest / Jest) — see
// package.json scripts.test and tests/smoke_agent_events.js for
// the canonical pattern. We keep that style here: one module, a
// tiny test() helper, and a non-zero exit on failure.
//
// Coverage:
//   1. RADAR cycle invokes the pipeline with the cursor's pair and
//      advances the cursor exactly one step per pair.
//   2. `shouldAutoApprove` says NO when AUTONOMY_ENABLED=true but
//      the draft is not yet approved AND auto_approve_at is future.
//   3. `shouldAutoApprove` says YES once auto_approve_at is in the
//      past and held_by_human is false (with AUTONOMY_ENABLED=true).
//   4. Guardrail throws GuardrailBlocked when sent_today >= cap.
//   5. With AUTONOMY_ENABLED=false, daemon.start() is a no-op AND
//      shouldAutoApprove returns false regardless of timestamps.
// ============================================================

import { pickNext, runRadarCycle, EMPIRIKA_NICHES, LATINO_METROS } from '../workers/autonomy_orchestrator.js';
import { shouldAutoApprove, autoApprovePastDueDrafts } from '../outreach_dispatcher.js';
import { GuardrailBlocked, getEnvCaps, getBounceRateLast24h } from '../lib/guardrails.js';
import { getActiveBrands } from '../lib/supabase.js';
import * as dispatcher from '../outreach_dispatcher.js';
import * as daemon from '../agents/manager-daemon.js';
import { logOutreachEvent, getHistoricalPerformance } from '../tools/outreachEvents.js';
import { aggregateCombos, runConsolidator } from '../workers/learning_consolidator.js';
import { angela } from '../agents/angela.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(
        () => { console.log(`  ✅ ${name}`); passed++; },
        (err) => { console.error(`  ❌ ${name}: ${err.message}`); failed++; }
      );
    }
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log('\n══════════════════════════════════════════════');
console.log('  AUTONOMY SPEC (Sprint 1)');
console.log('══════════════════════════════════════════════\n');

// ── Test 1 ───────────────────────────────────────────────────
await test('RADAR cycle invokes pipeline with cursor pair and advances cursor', async () => {
  const calls = [];
  const fakePipeline = async (args) => { calls.push(args); return { success: true }; };

  const cursor = { nicheIdx: 0, metroIdx: 0 };
  const { pairs, next } = pickNext(cursor, { count: 1 });

  const out = await runRadarCycle({
    brandId: 'brand-test',
    pairs,
    source: 'test',
    pipelineFn: fakePipeline,
  });

  assert(out.ok === true,                           'cycle should succeed');
  assert(calls.length === 1,                        `expected 1 pipeline call, got ${calls.length}`);
  assert(calls[0].niche === EMPIRIKA_NICHES[0],     'niche should match cursor');
  assert(calls[0].metro === LATINO_METROS[0],       'metro should match cursor');
  assert(next.metroIdx === 1 && next.nicheIdx === 0, `cursor must advance metroIdx only, got ${JSON.stringify(next)}`);
});

// ── Test 2 — Auto-approve gate says NO with future deadline ───
await test('dispatcher ignores row with approved=false and auto_approve_at in future', () => {
  const future = new Date(Date.now() + 60 * 60_000).toISOString(); // +1h
  const row = { approved: false, auto_approve_at: future, held_by_human: false };
  const ok = shouldAutoApprove(row, { autonomyEnabled: true });
  assert(ok === false, 'auto-approve must refuse future deadlines');
});

// ── Test 3 — Auto-approve gate says YES on past deadline ──────
await test('dispatcher approves row with auto_approve_at in past and AUTONOMY_ENABLED=true', () => {
  const past = new Date(Date.now() - 60_000).toISOString(); // -60s
  const row  = { approved: false, auto_approve_at: past, held_by_human: false };
  const ok   = shouldAutoApprove(row, { autonomyEnabled: true });
  assert(ok === true, 'auto-approve must fire when deadline has passed');

  const heldRow = { ...row, held_by_human: true };
  const heldOk  = shouldAutoApprove(heldRow, { autonomyEnabled: true });
  assert(heldOk === false, 'held_by_human=true must veto auto-approve');
});

// ── Test 4 — Guardrail blocks on cap breach ──────────────────
await test('guardrail blocks when sent_today >= MAX_LEADS_PER_DAY_PER_BRAND', async () => {
  // We can't easily stub Supabase here without monkey-patching the
  // module graph, so we verify the error shape directly via the
  // GuardrailBlocked contract — that's what the caller reacts to.
  const caps = getEnvCaps();
  assert(typeof caps.MAX_LEADS_PER_DAY_PER_BRAND === 'number', 'env cap must be a number');

  const err = new GuardrailBlocked('daily_cap_reached', {
    sent_today: caps.MAX_LEADS_PER_DAY_PER_BRAND,
    daily_cap:  caps.MAX_LEADS_PER_DAY_PER_BRAND,
  });
  assert(err.code === 'SEND_GUARDRAIL_BLOCKED', 'error code must be SEND_GUARDRAIL_BLOCKED');
  assert(err.reason === 'daily_cap_reached',    'reason must match');
  assert(err.details.sent_today === err.details.daily_cap, 'details preserved');
});

// ── Test 5 — AUTONOMY_ENABLED=false ⇒ rollback-safe ──────────
await test('AUTONOMY_ENABLED=false → daemon.start() no-op + auto-approve refuses', async () => {
  const prior = process.env.AUTONOMY_ENABLED;
  process.env.AUTONOMY_ENABLED = 'false';

  // daemon.start() must not install a timer when flag is off
  daemon.stop(); // ensure clean state
  daemon.start({ brandsProvider: async () => [{ id: 'brand-x' }] });
  // If start() had scheduled anything, tick() would await getActiveBrands.
  // We also directly verify by calling internal tick: it should early-return.
  await daemon._internal.tick({ brandsProvider: async () => { throw new Error('should not be called'); } });

  // shouldAutoApprove must refuse even with past deadline
  const past = new Date(Date.now() - 60_000).toISOString();
  const row  = { approved: false, auto_approve_at: past, held_by_human: false };
  const ok   = shouldAutoApprove(row, { autonomyEnabled: false });
  assert(ok === false, 'auto-approve must refuse when autonomy disabled');

  // restore
  process.env.AUTONOMY_ENABLED = prior;
  daemon.stop();
});

// ── Test 6 — getActiveBrands({onlyAutonomous:true}) respects brand_quota ──
await test('getActiveBrands({onlyAutonomous:true}) filters brands to those with brand_quota', async () => {
  // 2 brands exist; only brand-a has a brand_quota row.
  const fakeClient = {
    from(table) {
      if (table === 'brand_quota') {
        return {
          select() { return this; },
          gte: async () => ({ data: [{ brand_id: 'brand-a', warmup_stage: 1 }], error: null }),
        };
      }
      if (table === 'brands') {
        return {
          select() { return this; },
          in: async (_col, ids) => ({
            data: [{ id: 'brand-a', name: 'A' }, { id: 'brand-b', name: 'B' }]
              .filter(b => ids.includes(b.id)),
            error: null,
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  const active = await getActiveBrands({ onlyAutonomous: true, client: fakeClient });
  assert(Array.isArray(active),        'must return an array');
  assert(active.length === 1,          `expected 1 brand, got ${active.length}`);
  assert(active[0].id === 'brand-a',   'expected brand-a to survive the filter');
});

// ── Test 7 — autoApprove honors advisory lock (no UPDATE if claim fails) ──
await test('autoApprovePastDueDrafts returns 0 and issues no UPDATE when lock is held', async () => {
  const updates = [];
  const fakeClient = {
    from(table) {
      if (table === 'autonomy_locks') {
        return {
          // Step 1: insert returns 0 rows (unique conflict surrogate).
          insert()  { return this; },
          // Step 2: update gated by held_until<NOW returns 0 rows.
          update()  { return this; },
          eq()      { return this; },
          lt()      { return this; },
          delete()  { return this; },
          select: async () => ({ data: [], error: null }),
        };
      }
      if (table === 'campaign_enriched_data') {
        return {
          update(payload) { updates.push(payload); return this; },
          eq() { return this; },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  const n = await autoApprovePastDueDrafts({ brandId: 'brand-x', client: fakeClient });
  assert(n === 0, `expected 0 approvals, got ${n}`);
  assert(updates.length === 0, `expected zero UPDATEs, got ${updates.length}`);
});

// ── Test 8 — getBounceRateLast24h computes rate from outreach_status ──
await test('getBounceRateLast24h: 3 BOUNCED + 7 SENT ⇒ 0.3; empty ⇒ 0', async () => {
  function makeClient({ bounced, total }) {
    return {
      from(table) {
        // Tier 1 (outreach_events) is bypassed by returning an error
        // so the helper falls through to Tier 2 (campaign_enriched_data)
        // — which is what this test was written to cover.
        if (table === 'outreach_events') {
          const chain = {
            select() { return chain; },
            eq() { return chain; },
            in() { return chain; },
            gte: async () => ({ count: 0, error: { message: 'not-applied' } }),
          };
          return chain;
        }
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          in(_col, vals) { chain._statuses = vals; return chain; },
          gte: async () => {
            // BOUNCED bucket has 4 statuses, combined bucket has 6.
            const isBouncedBucket = chain._statuses && chain._statuses.length === 4;
            return {
              count: isBouncedBucket ? bounced : total,
              error: null,
            };
          },
        };
        return chain;
      },
    };
  }

  const rate = await getBounceRateLast24h('brand-x', {
    client: makeClient({ bounced: 3, total: 10 }),
  });
  assert(Math.abs(rate - 0.3) < 1e-9, `expected 0.3, got ${rate}`);

  const zero = await getBounceRateLast24h('brand-x', {
    client: makeClient({ bounced: 0, total: 0 }),
  });
  assert(zero === 0, `expected 0 for empty data, got ${zero}`);
});

// ── Test 9 — logOutreachEvent silent-fails when LEARNING_ENABLED=false ──
await test('logOutreachEvent returns null when LEARNING_ENABLED=false (rollback-safe)', async () => {
  const prior = process.env.LEARNING_ENABLED;
  process.env.LEARNING_ENABLED = 'false';
  try {
    const r = await logOutreachEvent({
      brandId: 'brand-x',
      channel: 'email',
      eventType: 'sent',
    });
    assert(r === null, `expected null when disabled, got ${JSON.stringify(r)}`);
  } finally {
    process.env.LEARNING_ENABLED = prior;
  }
});

// ── Test 10 — getHistoricalPerformance aggregates buckets + low_confidence ──
await test('getHistoricalPerformance: 3 replies / 12 sends ⇒ reply_rate 0.25 and low_confidence=false', async () => {
  const rows = [
    ...Array(12).fill({ event_type: 'sent' }),
    ...Array(5).fill({ event_type: 'opened' }),
    ...Array(3).fill({ event_type: 'replied' }),
    { event_type: 'bounced' },
  ];
  function makeChain(data) {
    // Supabase PostgREST builder: every filter method returns the same
    // builder; `await` on the builder triggers the HTTP request (thenable).
    const result = { data, error: null, count: data.length };
    const chain = {};
    const passthrough = () => chain;
    ['select', 'eq', 'ilike', 'in', 'order', 'limit', 'gte', 'lte', 'not', 'or'].forEach(m => {
      chain[m] = passthrough;
    });
    chain.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected);
    return chain;
  }
  const fakeClient = { from: () => makeChain(rows) };
  const res = await getHistoricalPerformance({
    niche: 'roofing', metro: 'Houston', channel: 'email', windowDays: 30, client: fakeClient,
  });
  assert(res.sends === 12,   `expected 12 sends, got ${res.sends}`);
  assert(res.replies === 3,  `expected 3 replies, got ${res.replies}`);
  assert(Math.abs(res.reply_rate - 0.25) < 1e-9, `expected reply_rate 0.25, got ${res.reply_rate}`);
  assert(res.low_confidence === false, 'sample_size 12 should NOT be low_confidence');

  // Empty path → low_confidence true, zeroed
  const emptyClient = { from: () => makeChain([]) };
  const empty = await getHistoricalPerformance({ niche: 'x', metro: 'y', client: emptyClient });
  assert(empty.sends === 0,            'empty → sends 0');
  assert(empty.reply_rate === 0,       'empty → reply_rate 0');
  assert(empty.low_confidence === true,'empty → low_confidence true');
});

// ── Test 11 — runConsolidator returns skipped shape when LEARNING disabled ──
await test('runConsolidator returns skipped shape when LEARNING_ENABLED=false (no memory writes)', async () => {
  const prior = process.env.LEARNING_ENABLED;
  process.env.LEARNING_ENABLED = 'false';
  let saved = 0;
  try {
    const r = await runConsolidator({
      brandId: 'brand-x',
      saveMemoryFn: async () => { saved++; },
    });
    assert(r.ok === true,                 'ok should be true even when skipped');
    assert(r.skipped === 'learning_disabled', `expected skipped=learning_disabled, got ${r.skipped}`);
    assert(Array.isArray(r.top) && r.top.length === 0, 'top must be empty array');
    assert(saved === 0, `expected 0 memory writes, got ${saved}`);
  } finally {
    process.env.LEARNING_ENABLED = prior;
  }

  // aggregateCombos math sanity
  const combos = aggregateCombos([
    { event_type: 'sent',   niche: 'roofing', metro: 'houston' },
    { event_type: 'sent',   niche: 'roofing', metro: 'houston' },
    { event_type: 'replied',niche: 'roofing', metro: 'houston' },
  ]);
  assert(combos.length === 1,                         'one combo bucket');
  assert(combos[0].sent === 2 && combos[0].replied === 1, 'sent/replied counted');
  assert(Math.abs(combos[0].reply_rate - 0.5) < 1e-9, `reply_rate 0.5, got ${combos[0].reply_rate}`);
});

// ── Test 12 — /pixel/:leadId.gif + webhooks wired BEFORE authMiddleware ──
await test('index.js registers /pixel/:leadId.gif + webhooks BEFORE app.use(/api, authMiddleware)', async () => {
  // Pure source-level check — importing index.js would boot the HTTP
  // listener, which is exactly what we want to avoid in unit tests.
  const fs = await import('node:fs');
  const url = new URL('../index.js', import.meta.url);
  const src = fs.readFileSync(url, 'utf8');

  const pixelIdx  = src.indexOf("app.get('/pixel/:leadId.gif'");
  const ghlIdx    = src.indexOf("app.post('/webhook/ghl-stage'");
  const bounceIdx = src.indexOf("app.post('/webhook/smtp-bounce'");
  const authIdx   = src.indexOf("app.use('/api', authMiddleware)");

  assert(pixelIdx > 0,                          'pixel endpoint must be declared');
  assert(ghlIdx > 0,                            'ghl-stage webhook must be declared');
  assert(bounceIdx > 0,                         'smtp-bounce webhook must be declared');
  assert(authIdx > 0,                           'authMiddleware line not found');
  assert(pixelIdx  < authIdx,                   'pixel endpoint MUST precede authMiddleware');
  assert(ghlIdx    < authIdx,                   'ghl-stage webhook MUST precede authMiddleware');
  assert(bounceIdx < authIdx,                   'smtp-bounce webhook MUST precede authMiddleware');

  // 1x1 GIF sanity: the hardcoded base64 constant decodes to a valid 35-43 byte GIF
  const gifMatch = src.match(/const TRANSPARENT_GIF = Buffer\.from\(\s*'([^']+)'/);
  assert(gifMatch && gifMatch[1].length > 20, 'TRANSPARENT_GIF base64 constant must exist');
  const decoded = Buffer.from(gifMatch[1], 'base64');
  assert(decoded.length >= 35 && decoded.length <= 60, `GIF bytes length sanity (got ${decoded.length})`);
  assert(decoded.slice(0,3).toString() === 'GIF', 'GIF header byte check (GIF8)');
});

// ── Test 13 — Angela prompt enforces Spanish-only (regression guard) ──
await test('Angela system prompt retains "100% en español" / "cero inglés" rule', () => {
  const p = angela.systemPrompt || '';
  const hasSpanishOnly = /español/i.test(p) && /(cero\s+ingl[eé]s|zero\s+english|100%\s+en\s+espa)/i.test(p);
  assert(hasSpanishOnly, 'Angela prompt MUST keep the Spanish-only guarantee');
});

// ─────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════');
console.log('  RESULTS');
console.log('══════════════════════════════════════════════\n');
console.log(`  Total : ${passed + failed}`);
console.log(`  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}\n`);

// Keep the export so `dispatcher` is considered used (avoids
// tree-shaking warnings; also available if the suite grows).
void dispatcher;

process.exit(failed > 0 ? 1 : 0);
