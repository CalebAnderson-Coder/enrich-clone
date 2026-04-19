// ============================================================
// tests/dispatcher_first_contact_sync.spec.js
// Guards the fix that keeps leads.first_contact_date synchronized
// with campaign_enriched_data on every successful email send.
// Pattern follows tests/instagram_parser.spec.js + autonomy.spec.js:
// tiny test() helper, fake Supabase chain, exit !=0 on failure.
// ============================================================

import { handlePostSendActions } from '../tools/email.js';

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

// ── Fake Supabase builder ─────────────────────────────────────
// Records every table/update/filter/etc. call on `ops` so we can
// assert (a) correct payloads, (b) correct order, (c) `.is(col,null)`
// idempotency guard was applied.
function makeFakeClient({ lead, ops }) {
  return {
    from(table) {
      const record = { table, filters: [], payload: null };
      const chain = {
        select() { return chain; },
        eq(col, val) { record.filters.push(['eq', col, val]); return chain; },
        is(col, val) { record.filters.push(['is', col, val]); return chain; },
        limit() { return chain; },
        single: async () => ({ data: lead, error: null }),
        update(payload) {
          record.op = 'update';
          record.payload = payload;
          ops.push(record);
          return chain;
        },
        then(onFulfilled, onRejected) {
          // When awaited directly (no terminal .single()), resolve like PostgREST.
          return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

console.log('\n══════════════════════════════════════════════');
console.log('  DISPATCHER → first_contact_date SYNC SPEC');
console.log('══════════════════════════════════════════════\n');

// ── Test 1 — fix is wired: sync fires with sentAt, idempotency guard, correct order
await test('handlePostSendActions updates leads.first_contact_date AFTER campaign_enriched_data, guarded by is(null)', async () => {
  const lead = { id: 'lead-abc', brand_id: 'brand-x', email_address: 'test@example.com' };
  const ops = [];
  const client = makeFakeClient({ lead, ops });

  const before = Date.now();
  await handlePostSendActions('test@example.com', { client });
  const after = Date.now();

  // (1) Locate the three update ops in the order they were issued.
  const updates = ops.filter(o => o.op === 'update');
  assert(updates.length >= 3,
    `expected at least 3 update calls (campaign + leads.status + leads.first_contact_date), got ${updates.length}`);

  const cedUpdate = updates.find(u => u.table === 'campaign_enriched_data');
  const leadStatusUpdate = updates.find(u => u.table === 'leads' && 'outreach_status' in (u.payload || {}));
  const fcdUpdate = updates.find(u => u.table === 'leads' && 'first_contact_date' in (u.payload || {}));

  assert(cedUpdate,        'campaign_enriched_data update must be issued');
  assert(leadStatusUpdate, 'leads.outreach_status update must be issued');
  assert(fcdUpdate,        'leads.first_contact_date update must be issued');

  // (2) Payload contract.
  const stamp = fcdUpdate.payload.first_contact_date;
  assert(typeof stamp === 'string', 'first_contact_date payload must be an ISO string');
  const stampMs = new Date(stamp).getTime();
  assert(stampMs >= before && stampMs <= after + 50,
    `first_contact_date must be sentAt (now), got ${stamp}`);

  // (3) Idempotency guard — must only touch rows where first_contact_date IS NULL.
  const hasIsNullGuard = (fcdUpdate.filters || []).some(f => f[0] === 'is' && f[1] === 'first_contact_date' && f[2] === null);
  assert(hasIsNullGuard, 'first_contact_date update MUST include .is("first_contact_date", null) guard');

  // (4) Filter by the correct lead id.
  const hasLeadIdFilter = (fcdUpdate.filters || []).some(f => f[0] === 'eq' && f[1] === 'id' && f[2] === lead.id);
  assert(hasLeadIdFilter, 'first_contact_date update MUST filter by eq("id", leadId)');

  // (5) Ordering — sync fires AFTER campaign_enriched_data write (never before).
  const cedIdx = updates.indexOf(cedUpdate);
  const fcdIdx = updates.indexOf(fcdUpdate);
  assert(fcdIdx > cedIdx, `first_contact_date update must come AFTER campaign_enriched_data (got indices ced=${cedIdx}, fcd=${fcdIdx})`);
});

// ── Test 2 — does nothing when the lead lookup returns null
await test('handlePostSendActions is a no-op when no lead matches the recipient', async () => {
  const ops = [];
  const client = makeFakeClient({ lead: null, ops });
  await handlePostSendActions('ghost@example.com', { client });
  const updates = ops.filter(o => o.op === 'update');
  assert(updates.length === 0, `expected zero updates when lead not found, got ${updates.length}`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════');
console.log('  RESULTS');
console.log('══════════════════════════════════════════════\n');
console.log(`  Total : ${passed + failed}`);
console.log(`  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}\n`);

process.exit(failed > 0 ? 1 : 0);
