// ============================================================
// tests/smoke_agent_events.js — Smoke tests for agent_events sink
//
// Verifies:
//   1. recordAgentEvent never throws (even on bad input).
//   2. Sink is fire-and-forget (returns synchronously).
//   3. Batch API accepts arrays without crashing.
//   4. Events with missing required fields are silently dropped.
//   5. flushAgentEvents() is safe to call with empty buffer.
// ============================================================

import {
  recordAgentEvent,
  recordBatch,
  flushAgentEvents,
  _bufferSize,
} from '../lib/agentEventsSink.js';

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

console.log('\n══════════════════════════════════════════════');
console.log('  SMOKE: agent_events sink');
console.log('══════════════════════════════════════════════\n');

await test('recordAgentEvent accepts a well-formed event without throwing', () => {
  const before = _bufferSize();
  recordAgentEvent({
    trace_id: 'trace-smoke-001',
    brand_id: null,
    agent: 'scout',
    event_type: 'run_started',
    metadata: { test: true },
  });
  assert(_bufferSize() >= before, 'buffer did not grow');
});

await test('recordAgentEvent drops events missing required fields (no throw)', () => {
  const before = _bufferSize();
  recordAgentEvent({ agent: 'scout' });                    // missing trace_id + event_type
  recordAgentEvent({ trace_id: 't', event_type: 'x' });   // missing agent
  recordAgentEvent(null);                                  // null
  recordAgentEvent('not-an-object');                      // wrong type
  recordAgentEvent({                                       // unknown event_type
    trace_id: 't',
    agent: 'scout',
    event_type: 'hallucinated_event',
  });
  // None of the above should have been buffered.
  assert(_bufferSize() === before, `expected buffer unchanged, got delta=${_bufferSize() - before}`);
});

await test('recordBatch accepts arrays (and tolerates junk entries)', () => {
  const before = _bufferSize();
  recordBatch([
    { trace_id: 't-batch', agent: 'angela', event_type: 'tool_call', tool: 'send_email' },
    { trace_id: 't-batch', agent: 'angela', event_type: 'tool_result', tool: 'send_email', status: 'ok', duration_ms: 120 },
    null,
    { garbage: true },
  ]);
  assert(_bufferSize() - before === 2, `expected 2 queued, got ${_bufferSize() - before}`);
});

await test('recordBatch(non-array) is a no-op and does not throw', () => {
  const before = _bufferSize();
  recordBatch('nope');
  recordBatch(undefined);
  assert(_bufferSize() === before, 'buffer should not change');
});

await test('flushAgentEvents resolves without throwing even when supabase is unavailable', async () => {
  // In the smoke test env, SUPABASE_URL may or may not be set. Either way,
  // flush must resolve; if unconfigured it warn-logs and drops the buffer.
  await flushAgentEvents();
  // After flush, buffer must be 0.
  assert(_bufferSize() === 0, `expected buffer=0 after flush, got ${_bufferSize()}`);
});

await test('recordAgentEvent is synchronous / non-blocking for the caller', () => {
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) {
    recordAgentEvent({
      trace_id: `perf-${i}`,
      agent: 'scout',
      event_type: 'tool_call',
      tool: 'dummy',
    });
  }
  const elapsed = Date.now() - t0;
  assert(elapsed < 200, `100 enqueues took ${elapsed}ms — sink is blocking the caller`);
});

// ─────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════');
console.log('  RESULTS');
console.log('══════════════════════════════════════════════\n');
console.log(`  Total : ${passed + failed}`);
console.log(`  ✅ Passed: ${passed}`);
console.log(`  ❌ Failed: ${failed}\n`);

// Flush one more time so we don't leak the timer in CI.
await flushAgentEvents();

process.exit(failed > 0 ? 1 : 0);
