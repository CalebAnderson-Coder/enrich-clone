// ============================================================
// tests/smoke_agent_memory.js — Smoke test for agent memory tools
// Verifies saveMemory writes to new schema cols and recallMemory reads them back.
// ============================================================

import { saveMemory, recallMemory } from '../tools/database.js';

const BRAND_ID = process.env.BRAND_ID || 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';
const context = { brand_id: BRAND_ID };

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

async function run() {
  console.log('\n=== smoke_agent_memory.js ===\n');

  // (a) Save two memories with different agents and keys
  const save1 = JSON.parse(await saveMemory.fn(
    { key: 'smoke_test_key_1', value: 'smoke_value_one', agent: 'angela' },
    context
  ));
  assert(save1.success === true, 'saveMemory #1 returns success=true');

  const save2 = JSON.parse(await saveMemory.fn(
    { key: 'smoke_test_key_2', value: 'smoke_value_two', agent: 'carlos' },
    context
  ));
  assert(save2.success === true, 'saveMemory #2 returns success=true');

  // (b) Recall by exact key + agent — should return matching value
  const recall1 = JSON.parse(await recallMemory.fn(
    { key: 'smoke_test_key_1', agent: 'angela' },
    context
  ));
  assert(Array.isArray(recall1), 'recallMemory returns an array');
  assert(recall1.length >= 1, 'recallMemory found at least one result');
  assert(
    recall1[0]?.memory_value === 'smoke_value_one',
    `recallMemory value matches: got "${recall1[0]?.memory_value}"`
  );

  // (c) Prefix scan: key starting with "[" should return all keys with that prefix
  const recallPrefix = JSON.parse(await recallMemory.fn(
    { key: '[smoke_test_key', agent: 'angela' },
    context
  ));
  assert(Array.isArray(recallPrefix), 'prefix scan returns an array');
  assert(
    recallPrefix.some(r => r.memory_key === 'smoke_test_key_1'),
    'prefix scan finds smoke_test_key_1'
  );

  // (d) Recall for wrong agent should return empty
  const recallWrong = JSON.parse(await recallMemory.fn(
    { key: 'smoke_test_key_1', agent: 'nonexistent_agent_xyz' },
    context
  ));
  assert(Array.isArray(recallWrong) && recallWrong.length === 0, 'wrong agent returns empty array');

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
