// ============================================================
// tests/quota_circuit_breaker.spec.js
//
// Unit tests for lib/resilience.js::QuotaCircuitBreaker.
// Run: node tests/quota_circuit_breaker.spec.js
// ============================================================

import assert from 'node:assert/strict';
import { QuotaCircuitBreaker, QuotaExhaustedError } from '../lib/resilience.js';

let passed = 0, failed = 0;
function test(name, fn) {
  return fn().then(
    ()  => { console.log(`  ✓ ${name}`); passed++; },
    err => { console.error(`  ✗ ${name}\n    ${err.message}`); failed++; },
  );
}

const make429 = () => {
  const e = new Error('429 status code (no body)');
  e.status = 429;
  return e;
};

await test('isRateLimitError detects 429 status', async () => {
  assert.equal(QuotaCircuitBreaker.isRateLimitError(make429()), true);
  assert.equal(QuotaCircuitBreaker.isRateLimitError(new Error('rate_limit exceeded')), true);
  assert.equal(QuotaCircuitBreaker.isRateLimitError(new Error('connection timeout')), false);
  assert.equal(QuotaCircuitBreaker.isRateLimitError(null), false);
});

await test('remains CLOSED under threshold', async () => {
  const cb = new QuotaCircuitBreaker({ name: 't1', failureThreshold: 5 });
  for (let i = 0; i < 4; i++) {
    try { await cb.exec(async () => { throw make429(); }); } catch {}
  }
  assert.equal(cb.getState().state, 'CLOSED');
});

await test('opens on threshold within window', async () => {
  const cb = new QuotaCircuitBreaker({ name: 't2', failureThreshold: 3, windowMs: 10_000 });
  for (let i = 0; i < 3; i++) {
    try { await cb.exec(async () => { throw make429(); }); } catch {}
  }
  assert.equal(cb.getState().state, 'OPEN');
});

await test('OPEN fails fast with QuotaExhaustedError (no fn invocation)', async () => {
  const cb = new QuotaCircuitBreaker({ name: 't3', failureThreshold: 2, cooldownMs: 60_000 });
  for (let i = 0; i < 2; i++) {
    try { await cb.exec(async () => { throw make429(); }); } catch {}
  }
  let called = 0;
  let caught = null;
  try {
    await cb.exec(async () => { called++; return 'ok'; });
  } catch (err) { caught = err; }
  assert.equal(called, 0, 'fn must not be invoked while OPEN');
  assert.ok(caught instanceof QuotaExhaustedError);
  assert.equal(caught.provider, 't3');
});

await test('non-429 errors do not count toward threshold', async () => {
  const cb = new QuotaCircuitBreaker({ name: 't4', failureThreshold: 3 });
  for (let i = 0; i < 10; i++) {
    try { await cb.exec(async () => { throw new Error('connection refused'); }); } catch {}
  }
  assert.equal(cb.getState().state, 'CLOSED');
});

await test('success resets hit count', async () => {
  const cb = new QuotaCircuitBreaker({ name: 't5', failureThreshold: 3 });
  for (let i = 0; i < 2; i++) {
    try { await cb.exec(async () => { throw make429(); }); } catch {}
  }
  await cb.exec(async () => 'ok');
  assert.equal(cb.getState().hits_in_window, 0);
  assert.equal(cb.getState().state, 'CLOSED');
});

await test('window eviction: old hits age out', async () => {
  const cb = new QuotaCircuitBreaker({ name: 't6', failureThreshold: 3, windowMs: 50 });
  for (let i = 0; i < 2; i++) {
    try { await cb.exec(async () => { throw make429(); }); } catch {}
  }
  await new Promise(r => setTimeout(r, 80)); // let window slide
  try { await cb.exec(async () => { throw make429(); }); } catch {}
  assert.equal(cb.getState().state, 'CLOSED');
});

await test('HALF_OPEN after cooldown, re-opens on failure', async () => {
  const cb = new QuotaCircuitBreaker({ name: 't7', failureThreshold: 2, cooldownMs: 40 });
  for (let i = 0; i < 2; i++) {
    try { await cb.exec(async () => { throw make429(); }); } catch {}
  }
  assert.equal(cb.getState().state, 'OPEN');
  await new Promise(r => setTimeout(r, 60));
  try { await cb.exec(async () => { throw make429(); }); } catch {}
  assert.equal(cb.getState().state, 'OPEN'); // re-opened
});

await test('HALF_OPEN closes on success', async () => {
  const cb = new QuotaCircuitBreaker({ name: 't8', failureThreshold: 2, cooldownMs: 40 });
  for (let i = 0; i < 2; i++) {
    try { await cb.exec(async () => { throw make429(); }); } catch {}
  }
  await new Promise(r => setTimeout(r, 60));
  await cb.exec(async () => 'recovered');
  assert.equal(cb.getState().state, 'CLOSED');
});

console.log(`\n[quota_circuit_breaker] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
