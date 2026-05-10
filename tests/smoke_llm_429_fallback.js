// ============================================================
// tests/smoke_llm_429_fallback.js
// BK-014 — Manager 429 fallback verification.
//
// Stubs lib/AgentRuntime.js openai (primary) client so it throws a
// 429 from the OpenAI SDK; verifies that:
//   1. runtime.run returns a non-empty response from the Gemini fallback.
//   2. agent_events receives ≥1 row with provider='nvidia' + is_429=true
//      AND ≥1 row with provider='Gemini' + fallback_used=true,
//      both sharing the same trace_id.
//   3. The primary circuit breaker opens after QUOTA_CB_HITS consecutive
//      429s (test sets QUOTA_CB_HITS=3 for speed) AND fallback CB stays CLOSED.
//
// The smoke writes test rows to public.agent_events tagged with
// process.env.BRAND_ID || Empírika fixture and cleans them up via
// DELETE on trace_id at end of run inside try/finally so a mid-run
// crash does not leave orphan rows.
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

import { randomUUID } from 'crypto';
import { AgentRuntime } from '../lib/AgentRuntime.js';
import { flushAgentEvents } from '../lib/agentEventsSink.js';
import { supabase } from '../lib/supabase.js';

if (!supabase) {
  console.log('SKIPPED: supabase client unavailable — cannot verify agent_events writes');
  process.exit(0);
}

const TEST_BRAND_ID = process.env.BRAND_ID || 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

let passed = 0;
let failed = 0;
const traceIdsToCleanup = [];

async function t(name, fn) {
  try {
    await fn();
    console.log(`  OK  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.message}`);
    failed++;
  }
}

function makePrimary429Client() {
  return {
    chat: { completions: { create: async () => {
      const err = new Error('rate limit exceeded (test stub 429)');
      err.status = 429;
      err.code   = 'rate_limit_exceeded';
      throw err;
    }}},
  };
}

function makeFallbackOkClient(content = 'fallback ok response (stub)') {
  return {
    chat: { completions: { create: async () => ({
      choices: [{ message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })}},
  };
}

function buildStubRuntime() {
  const runtime = new AgentRuntime({
    apiKey: 'stub-nvidia-key',
    model:  'meta/llama-stub',
  });
  runtime.openai       = makePrimary429Client();
  runtime.geminiClient = makeFallbackOkClient();
  runtime.registerAgent({
    name: 'StubAgent',
    systemPrompt: 'You are a stub agent for testing.',
    tools: [],
  });
  return runtime;
}

console.log('\n[smoke_llm_429_fallback] Running 429 fallback smoke tests...\n');

const traceIdFallback = randomUUID();
traceIdsToCleanup.push(traceIdFallback);

try {

await t('Primary 429 triggers Gemini fallback with non-empty response', async () => {
  const runtime = buildStubRuntime();
  const result = await runtime.run('StubAgent', 'hello', {
    brandId: TEST_BRAND_ID,
    trace_id: traceIdFallback,
  });
  if (!result.fallbackUsed) {
    throw new Error(`fallbackUsed=${result.fallbackUsed}; expected true`);
  }
  if (!result.response || result.response === '') {
    throw new Error('Empty response after fallback');
  }
  if (typeof result.response === 'string' && result.response.startsWith('Agent encountered')) {
    throw new Error(`Fallback also failed: ${result.response}`);
  }
  console.log(`     response="${String(result.response).slice(0, 60)}..."`);
});

await flushAgentEvents();
await new Promise(r => setTimeout(r, 1500));

await t('agent_events has nvidia+is_429 row AND Gemini+fallback_used row in same trace', async () => {
  const { data, error } = await supabase
    .from('agent_events')
    .select('event_type, metadata')
    .eq('trace_id', traceIdFallback);
  if (error) throw new Error(`supabase query error: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`No agent_events rows for traceId ${traceIdFallback}`);
  }

  const nvidiaErr = data.find(r =>
    r.event_type === 'agent_error'
    && String(r.metadata?.provider || '').toLowerCase() === 'nvidia'
    && r.metadata?.is_429 === true
  );
  if (!nvidiaErr) {
    throw new Error(`No agent_error row with provider=nvidia + is_429=true. Saw: ${JSON.stringify(data.map(r => ({et:r.event_type, p:r.metadata?.provider, is429:r.metadata?.is_429})))}`);
  }

  const geminiOk = data.find(r =>
    r.event_type === 'run_completed'
    && r.metadata?.fallback_used === true
    && r.metadata?.provider === 'Gemini'
  );
  if (!geminiOk) {
    throw new Error(`No run_completed row with fallback_used=true + provider=Gemini.`);
  }
  console.log(`     trace_id=${traceIdFallback} has nvidia/is_429 + Gemini/fallback_used`);
});

await t('Primary circuit breaker opens after QUOTA_CB_HITS consecutive 429s', async () => {
  const prevHits = process.env.QUOTA_CB_HITS;
  process.env.QUOTA_CB_HITS = '3';
  try {
    const runtime = buildStubRuntime();
    if (runtime.primaryCB?.failureThreshold !== 3) {
      throw new Error(`primaryCB.failureThreshold=${runtime.primaryCB?.failureThreshold}; expected 3`);
    }
    for (let i = 0; i < 3; i++) {
      const tr = randomUUID();
      traceIdsToCleanup.push(tr);
      await runtime.run('StubAgent', `hit ${i}`, { brandId: TEST_BRAND_ID, trace_id: tr });
    }
    if (runtime.primaryCB.state !== 'OPEN') {
      throw new Error(`Expected primaryCB.state=OPEN after 3 hits, got ${runtime.primaryCB.state}`);
    }
    if (runtime.fallbackCB.state !== 'CLOSED') {
      throw new Error(`Expected fallbackCB.state=CLOSED, got ${runtime.fallbackCB.state}`);
    }
    console.log(`     primaryCB=${runtime.primaryCB.state}, fallbackCB=${runtime.fallbackCB.state} after 3 simulated 429s`);
  } finally {
    if (prevHits === undefined) delete process.env.QUOTA_CB_HITS;
    else process.env.QUOTA_CB_HITS = prevHits;
  }
});

} finally {
  await flushAgentEvents();
  await new Promise(r => setTimeout(r, 500));
  try {
    for (const tr of traceIdsToCleanup) {
      await supabase.from('agent_events').delete().eq('trace_id', tr);
    }
  } catch (err) {
    console.warn(`  ⚠️  cleanup error: ${err.message}`);
  }
}

console.log(`\n[smoke_llm_429_fallback] ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
