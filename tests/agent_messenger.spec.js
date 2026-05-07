// ============================================================
// tests/agent_messenger.spec.js — AgentMessenger unit tests
//
// Uses the same native-Node test pattern as autonomy.spec.js:
// a tiny test() helper, no Jest/Vitest, process.exit(1) on failure.
// Supabase client is fully mocked — no real DB is touched.
// ============================================================

import { AgentMessenger, AgentMessengerError } from '../lib/AgentMessenger.js';

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

// ─── Mock builder ─────────────────────────────────────────────
//
// makeDb() returns a minimal Supabase client stub.
// Each table method returns a chainable builder whose `then` hook
// (or explicit terminal methods) returns the supplied result.
// `calls` records every operation for assertion.
//
function makeDb(tableHandlers = {}) {
  return {
    from(table) {
      const handler = tableHandlers[table] || {};
      const calls = handler.calls || [];

      let _operation = null;
      let _payload   = null;

      const chain = {
        insert(row)   { _operation = 'insert'; _payload = row; calls.push({ op: 'insert', row }); return chain; },
        update(row)   { _operation = 'update'; _payload = row; calls.push({ op: 'update', row }); return chain; },
        upsert(row)   { _operation = 'upsert'; _payload = row; calls.push({ op: 'upsert', row }); return chain; },
        select(cols)  { return chain; },
        eq(col, val)  { return chain; },
        is(col, val)  { return chain; },
        order()       { return chain; },
        limit()       { return chain; },
        single() {
          const resolve = handler.resolve ?? (() => ({ data: { id: 1, ..._payload }, error: null }));
          return resolve({ op: _operation, payload: _payload });
        },
        maybeSingle() {
          const resolve = handler.resolveMaybe ?? handler.resolve ?? (() => ({ data: { id: 1, ..._payload }, error: null }));
          return resolve({ op: _operation, payload: _payload });
        },
        then(onFulfilled, onRejected) {
          const resolve = handler.resolve ?? (() => ({ data: [], error: null }));
          return Promise.resolve(resolve({ op: _operation, payload: _payload })).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

const BASE_OPTS = {
  agentName: 'helena',
  processId: 'proc-111',
  brandId:   'eca1d833-0000-0000-0000-000000000001',
};

console.log('\n══════════════════════════════════════════════');
console.log('  AGENT MESSENGER SPEC');
console.log('══════════════════════════════════════════════\n');

// ── Test 1 — constructor validation ─────────────────────────
await test('constructor throws AgentMessengerError when required opts are missing', () => {
  let threw = false;
  try { new AgentMessenger({ agentName: 'x', processId: 'p', brandId: 'b' }); }
  catch (e) { threw = e instanceof AgentMessengerError && /supabase/.test(e.message); }
  assert(threw, 'missing supabase must throw AgentMessengerError');

  let threw2 = false;
  try { new AgentMessenger({ supabase: {}, processId: 'p', brandId: 'b' }); }
  catch (e) { threw2 = e instanceof AgentMessengerError && /agentName/.test(e.message); }
  assert(threw2, 'missing agentName must throw');
});

// ── Test 2 — send() inserts a row with the right shape ───────
await test('send() inserts a row with the correct shape', async () => {
  const inserts = [];

  const db = makeDb({
    agent_messages: {
      calls: inserts,
      resolve: ({ payload }) => ({
        data: {
          id: 42,
          brand_id:   BASE_OPTS.brandId,
          from_agent: BASE_OPTS.agentName,
          to_agent:   'manager',
          payload:    payload?.payload,
          status:     'pending',
          created_at: new Date().toISOString(),
        },
        error: null,
      }),
    },
  });

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  const row = await m.send({ to: 'manager', payload: { type: 'pattern_detected', score: 0.9 } });

  assert(row.id === 42,                   'row id must be 42');
  assert(row.from_agent === 'helena',     'from_agent must be helena');
  assert(row.to_agent   === 'manager',    'to_agent must be manager');
  assert(row.status     === 'pending',    'status must be pending');

  const insertCall = inserts.find(c => c.op === 'insert');
  assert(!!insertCall,                                  'must have called insert');
  assert(insertCall.row.from_agent === 'helena',        'inserted from_agent=helena');
  assert(insertCall.row.to_agent   === 'manager',       'inserted to_agent=manager');
  assert(insertCall.row.status     === 'pending',       'inserted status=pending');
  assert(insertCall.row.brand_id   === BASE_OPTS.brandId, 'inserted brand_id matches');
});

// ── Test 3 — send() throws on Supabase error ─────────────────
await test('send() throws AgentMessengerError when Supabase returns an error', async () => {
  const db = makeDb({
    agent_messages: {
      resolve: () => ({ data: null, error: { message: 'connection refused' } }),
    },
  });

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  let threw = false;
  try {
    await m.send({ to: 'manager', payload: { type: 'test' } });
  } catch (e) {
    threw = e instanceof AgentMessengerError && /send failed/.test(e.message);
  }
  assert(threw, 'must throw AgentMessengerError on DB error');
});

// ── Test 4 — recv() claims pending messages ───────────────────
await test('recv() claims pending messages and returns them as claimed', async () => {
  // Step 1 select → 2 candidate ids; step 2 update → each row claimed.
  const pendingRows = [{ id: 10 }, { id: 11 }];
  let selectCalled = 0;
  let updateCount  = 0;

  const db = {
    from(table) {
      assert(table === 'agent_messages', `unexpected table: ${table}`);
      const chain = {};
      const pass  = () => chain;
      ['select','eq','is','order','limit'].forEach(m => { chain[m] = pass; });

      chain.update = (row) => {
        updateCount++;
        // Return the claimed row
        chain._updatePayload = row;
        return chain;
      };
      chain.maybeSingle = () => {
        if (chain._updatePayload) {
          const id = updateCount === 1 ? 10 : 11;
          return { data: { id, status: 'claimed', claimed_by: BASE_OPTS.processId, ...chain._updatePayload }, error: null };
        }
        return { data: pendingRows, error: null };
      };
      chain.then = (onFulfilled, onRejected) => {
        selectCalled++;
        return Promise.resolve({ data: pendingRows, error: null }).then(onFulfilled, onRejected);
      };
      return chain;
    },
  };

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  const msgs = await m.recv({ limit: 5 });

  assert(Array.isArray(msgs),                         'recv must return array');
  assert(msgs.length === 2,                           `expected 2 claimed msgs, got ${msgs.length}`);
  assert(msgs[0].status === 'claimed',                'first msg status=claimed');
  assert(msgs[0].claimed_by === BASE_OPTS.processId,  'claimed_by=processId');
  assert(updateCount === 2,                           `expected 2 updates, got ${updateCount}`);
});

// ── Test 5 — recv() returns [] when no pending messages ──────
await test('recv() returns empty array when no pending messages exist', async () => {
  const db = {
    from() {
      const chain = {};
      const pass = () => chain;
      ['select','eq','is','order','limit'].forEach(m => { chain[m] = pass; });
      chain.then = (onFulfilled) => Promise.resolve({ data: [], error: null }).then(onFulfilled);
      return chain;
    },
  };

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  const msgs = await m.recv();
  assert(Array.isArray(msgs) && msgs.length === 0, 'must return empty array');
});

// ── Test 6 — ack() transitions claimed→processed ─────────────
await test('ack() transitions claimed→processed and persists result', async () => {
  const updates = [];

  const db = makeDb({
    agent_messages: {
      calls: updates,
      resolveMaybe: ({ payload }) => ({
        data: {
          id: 10,
          status: 'processed',
          processed_at: new Date().toISOString(),
          result: payload?.result ?? null,
          claimed_by: BASE_OPTS.processId,
        },
        error: null,
      }),
    },
  });

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  const row = await m.ack(10, { result: { ok: true, count: 3 } });

  assert(row.status === 'processed',              'status must be processed');
  assert(!!row.processed_at,                      'processed_at must be set');

  const updateCall = updates.find(c => c.op === 'update');
  assert(!!updateCall,                             'must have called update');
  assert(updateCall.row.status === 'processed',   'update payload status=processed');
  assert(!!updateCall.row.processed_at,           'update payload has processed_at');
});

// ── Test 7 — ack() throws when claimed_by does not match ─────
await test('ack() throws AgentMessengerError when message not claimed by this process', async () => {
  const db = makeDb({
    agent_messages: {
      resolveMaybe: () => ({ data: null, error: null }), // no row returned ⇒ wrong owner
    },
  });

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  let threw = false;
  try {
    await m.ack(99, {});
  } catch (e) {
    threw = e instanceof AgentMessengerError && /not found or not claimed/.test(e.message);
  }
  assert(threw, 'must throw when claimed_by mismatch');
});

// ── Test 8 — nack() transitions claimed→failed ───────────────
await test('nack() transitions claimed→failed and stores error reason', async () => {
  const updates = [];

  const db = makeDb({
    agent_messages: {
      calls: updates,
      resolveMaybe: ({ payload }) => ({
        data: {
          id: 10,
          status: 'failed',
          error: payload?.error ?? null,
          claimed_by: BASE_OPTS.processId,
        },
        error: null,
      }),
    },
  });

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  const row = await m.nack(10, 'rate_limited');

  assert(row.status === 'failed',   'status must be failed');

  const updateCall = updates.find(c => c.op === 'update');
  assert(!!updateCall,                            'must have called update');
  assert(updateCall.row.status === 'failed',      'update payload status=failed');
  assert(updateCall.row.error  === 'rate_limited', 'update payload error=rate_limited');
});

// ── Test 9 — nack() throws when claimed_by does not match ────
await test('nack() throws AgentMessengerError when message not claimed by this process', async () => {
  const db = makeDb({
    agent_messages: {
      resolveMaybe: () => ({ data: null, error: null }),
    },
  });

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  let threw = false;
  try {
    await m.nack(99, 'some_error');
  } catch (e) {
    threw = e instanceof AgentMessengerError && /not found or not claimed/.test(e.message);
  }
  assert(threw, 'must throw when claimed_by mismatch');
});

// ── Test 10 — heartbeat() updates last_heartbeat_at ──────────
await test('heartbeat() updates last_heartbeat_at for this processId', async () => {
  const updates = [];

  const db = makeDb({
    agent_processes: {
      calls: updates,
      resolveMaybe: ({ payload }) => ({
        data: {
          process_id:        BASE_OPTS.processId,
          last_heartbeat_at: payload?.last_heartbeat_at,
        },
        error: null,
      }),
    },
  });

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  const before = Date.now();
  const row = await m.heartbeat();
  const after = Date.now();

  assert(!!row,                                       'must return row');
  assert(!!row.last_heartbeat_at,                    'last_heartbeat_at must be set');

  const ts = new Date(row.last_heartbeat_at).getTime();
  assert(ts >= before && ts <= after + 100,          'heartbeat timestamp must be approximately now');

  const updateCall = updates.find(c => c.op === 'update');
  assert(!!updateCall,                               'must have called update');
  assert(!!updateCall.row.last_heartbeat_at,         'update payload has last_heartbeat_at');
});

// ── Test 11 — register() inserts into agent_processes ────────
await test('register() upserts process record with status=running', async () => {
  const upserts = [];

  const db = makeDb({
    agent_processes: {
      calls: upserts,
      resolveMaybe: ({ payload }) => ({
        data: { process_id: BASE_OPTS.processId, status: 'running', ...payload },
        error: null,
      }),
    },
  });

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  const row = await m.register({ host: 'test-host', metadata: { version: '1.0.0' } });

  const upsertCall = upserts.find(c => c.op === 'upsert');
  assert(!!upsertCall,                                        'must have called upsert');
  assert(upsertCall.row.process_id  === BASE_OPTS.processId, 'process_id matches');
  assert(upsertCall.row.agent_name  === BASE_OPTS.agentName,  'agent_name matches');
  assert(upsertCall.row.brand_id    === BASE_OPTS.brandId,    'brand_id matches');
  assert(upsertCall.row.host        === 'test-host',          'host matches');
  assert(upsertCall.row.status      === 'running',            'status=running');
  assert(!!upsertCall.row.started_at,                        'started_at set');
  assert(!!upsertCall.row.last_heartbeat_at,                 'last_heartbeat_at set');
});

// ── Test 12 — deregister() sets status=stopped ───────────────
await test('deregister() sets status=stopped for this processId', async () => {
  const updates = [];

  const db = makeDb({
    agent_processes: {
      calls: updates,
      resolveMaybe: () => ({
        data: { process_id: BASE_OPTS.processId, status: 'stopped' },
        error: null,
      }),
    },
  });

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  const row = await m.deregister();

  const updateCall = updates.find(c => c.op === 'update');
  assert(!!updateCall,                          'must have called update');
  assert(updateCall.row.status === 'stopped',   'update payload status=stopped');
  assert(row.status === 'stopped',              'returned row status=stopped');
});

// ── Test 13 — getState() returns null for missing key ────────
await test('getState() returns null when key does not exist', async () => {
  const db = makeDb({
    agent_state: {
      resolveMaybe: () => ({ data: null, error: null }),
    },
  });

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  const v = await m.getState('last_run_at');
  assert(v === null, 'must return null for missing key');
});

// ── Test 14 — getState() returns stored value ────────────────
await test('getState() returns the stored value when key exists', async () => {
  const stored = '2026-05-07T00:00:00.000Z';

  const db = makeDb({
    agent_state: {
      resolveMaybe: () => ({ data: { value: stored }, error: null }),
    },
  });

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  const v = await m.getState('last_run_at');
  assert(v === stored, `expected stored value, got ${v}`);
});

// ── Test 15 — setState() upserts the value ───────────────────
await test('setState() upserts agent_state with correct key/value', async () => {
  const upserts = [];

  const db = makeDb({
    agent_state: {
      calls: upserts,
      resolveMaybe: ({ payload }) => ({
        data: { agent_name: BASE_OPTS.agentName, key: payload?.key, value: payload?.value },
        error: null,
      }),
    },
  });

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  const now = new Date().toISOString();
  await m.setState('last_run_at', now);

  const upsertCall = upserts.find(c => c.op === 'upsert');
  assert(!!upsertCall,                                       'must have called upsert');
  assert(upsertCall.row.agent_name === BASE_OPTS.agentName,  'agent_name matches');
  assert(upsertCall.row.brand_id   === BASE_OPTS.brandId,    'brand_id matches');
  assert(upsertCall.row.key        === 'last_run_at',        'key matches');
  assert(upsertCall.row.value      === now,                  'value matches');
  assert(!!upsertCall.row.updated_at,                       'updated_at set');
});

// ── Test 16 — setState() throws on Supabase error ────────────
await test('setState() throws AgentMessengerError when Supabase returns an error', async () => {
  const db = makeDb({
    agent_state: {
      resolveMaybe: () => ({ data: null, error: { message: 'write conflict' } }),
    },
  });

  const m = new AgentMessenger({ supabase: db, ...BASE_OPTS });
  let threw = false;
  try {
    await m.setState('key', 'value');
  } catch (e) {
    threw = e instanceof AgentMessengerError && /setState failed/.test(e.message);
  }
  assert(threw, 'must throw AgentMessengerError on DB error');
});

// ─────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════');
console.log('  RESULTS');
console.log('══════════════════════════════════════════════\n');
console.log(`  Total : ${passed + failed}`);
console.log(`  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}\n`);

process.exit(failed > 0 ? 1 : 0);
