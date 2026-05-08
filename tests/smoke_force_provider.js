// ============================================================
// tests/smoke_force_provider.js
// BK-028 — _forceProvider context key support.
//
// Stubs both clients so we can observe which one is called:
//   - openai (primary):    a tracking proxy that throws if invoked
//   - geminiClient (fb):   returns a valid response
//
// With context._forceProvider='Gemini':
//   1. The primary client must NOT be invoked (assert via tracking proxy).
//   2. Result must come from Gemini and have fallbackUsed=true +
//      forcedProvider='gemini'.
//
// With no _forceProvider (sanity check):
//   3. The primary client IS invoked (control case).
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

import { AgentRuntime } from '../lib/AgentRuntime.js';

let passed = 0;
let failed = 0;

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

function makeTrackingClient({ throwOnCall = false, response = 'ok' } = {}) {
  const calls = [];
  return {
    calls,
    chat: {
      completions: {
        create: async (args) => {
          calls.push(args);
          if (throwOnCall) {
            const err = new Error('primary should not have been called');
            err.code = 'TEST_VIOLATION';
            throw err;
          }
          return {
            choices: [{ message: { role: 'assistant', content: response } }],
            usage: { prompt_tokens: 5, completion_tokens: 3 },
          };
        },
      },
    },
  };
}

function buildRuntime({ primaryThrows = false } = {}) {
  const runtime = new AgentRuntime({ apiKey: 'stub-key', model: 'meta/llama-stub' });
  runtime.openai       = makeTrackingClient({ throwOnCall: primaryThrows, response: 'PRIMARY' });
  runtime.geminiClient = makeTrackingClient({ throwOnCall: false, response: 'GEMINI' });
  runtime.registerAgent({ name: 'StubAgent', systemPrompt: 'stub', tools: [] });
  return runtime;
}

console.log('\n[smoke_force_provider] Running _forceProvider smoke tests...\n');

await t('_forceProvider=Gemini routes to fallback client only (primary not called)', async () => {
  const runtime = buildRuntime({ primaryThrows: true });
  const result = await runtime.run('StubAgent', 'hello', {
    brandId: process.env.BRAND_ID || 'eca1d833-77e3-4690-8cf1-2a44db20dcf8',
    _forceProvider: 'Gemini',
  });
  if (runtime.openai.calls.length !== 0) {
    throw new Error(`primary client was called ${runtime.openai.calls.length}× — expected 0`);
  }
  if (runtime.geminiClient.calls.length === 0) {
    throw new Error(`gemini client never called`);
  }
  if (result.response !== 'GEMINI') {
    throw new Error(`response did not come from Gemini stub: ${String(result.response).slice(0,40)}`);
  }
  if (!result.fallbackUsed) throw new Error(`fallbackUsed=${result.fallbackUsed}; expected true`);
  if (result.forcedProvider !== 'gemini') {
    throw new Error(`forcedProvider=${result.forcedProvider}; expected 'gemini'`);
  }
});

await t('No _forceProvider → primary IS called (control)', async () => {
  const runtime = buildRuntime({ primaryThrows: false });
  await runtime.run('StubAgent', 'hello', {
    brandId: process.env.BRAND_ID || 'eca1d833-77e3-4690-8cf1-2a44db20dcf8',
  });
  if (runtime.openai.calls.length === 0) {
    throw new Error(`primary client was NOT called when _forceProvider absent`);
  }
});

await t('_forceProvider=NVIDIA (unsupported value) falls back to normal flow', async () => {
  const runtime = buildRuntime({ primaryThrows: false });
  await runtime.run('StubAgent', 'hello', {
    brandId: process.env.BRAND_ID || 'eca1d833-77e3-4690-8cf1-2a44db20dcf8',
    _forceProvider: 'NVIDIA',
  });
  if (runtime.openai.calls.length === 0) {
    throw new Error(`primary client was NOT called when _forceProvider='NVIDIA' (only fallback name should bypass)`);
  }
});

await t('_forceProvider=Gemini with fallbackCB OPEN → falls back to normal flow', async () => {
  const runtime = buildRuntime({ primaryThrows: false });
  if (runtime.fallbackCB) runtime.fallbackCB.state = 'OPEN';
  await runtime.run('StubAgent', 'hello', {
    brandId: process.env.BRAND_ID || 'eca1d833-77e3-4690-8cf1-2a44db20dcf8',
    _forceProvider: 'Gemini',
  });
  if (runtime.openai.calls.length === 0) {
    throw new Error(`primary client was NOT called when fallback CB is OPEN`);
  }
});

console.log(`\n[smoke_force_provider] ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
