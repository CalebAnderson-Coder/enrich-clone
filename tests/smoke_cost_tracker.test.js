import test from 'node:test';
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { trackCost, getMonthlyStats } from '../lib/costTracker.js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;

function buildSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

const BRAND_ID = 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

test('cost tracker — insert and retrieve', async (t) => {
  const supabase = buildSupabase();

  let leadId = null;
  let costId1 = null;
  let costId2 = null;

  await t.test('setup: create test lead', async () => {
    const { data: testLead, error: leadErr } = await supabase
      .from('leads')
      .insert({
        brand_id: BRAND_ID,
        business_name: 'Test Cost Lead',
        industry: 'roofing',
        metro_area: 'Houston',
      })
      .select('id')
      .single();

    assert.strictEqual(leadErr, null, `lead insert error: ${leadErr?.message}`);
    assert.ok(testLead?.id, 'lead should have id');
    leadId = testLead.id;
  });

  await t.test('trackCost should insert llm_tokens cost', async () => {
    const result = await trackCost({
      leadId,
      brandId: BRAND_ID,
      source: 'llm_tokens',
      amountUsd: 0.123,
      metadata: { model: 'nvidia', inputTokens: 1000, outputTokens: 500 },
    });

    assert.ok(result?.id, 'cost should have id');
    assert.strictEqual(result?.source, 'llm_tokens');
    assert.strictEqual(Number(result?.amount_usd), 0.123);
    costId1 = result.id;
  });

  await t.test('trackCost should insert smtp cost', async () => {
    const result = await trackCost({
      leadId,
      brandId: BRAND_ID,
      source: 'smtp',
      amountUsd: 0.01,
      metadata: { transport: 'gmail', subject: 'Test Email' },
    });

    assert.ok(result?.id, 'cost should have id');
    assert.strictEqual(result?.source, 'smtp');
    assert.strictEqual(Number(result?.amount_usd), 0.01);
    costId2 = result.id;
  });

  await t.test('trackCost should reject invalid source', async () => {
    const result = await trackCost({
      leadId,
      brandId: BRAND_ID,
      source: 'invalid_source',
      amountUsd: 0.05,
    });

    assert.strictEqual(result, null, 'should reject invalid source');
  });

  await t.test('trackCost should reject negative amount', async () => {
    const result = await trackCost({
      leadId,
      brandId: BRAND_ID,
      source: 'llm_tokens',
      amountUsd: -0.05,
    });

    assert.strictEqual(result, null, 'should reject negative amount');
  });

  await t.test('getMonthlyStats should return aggregated data', async () => {
    const stats = await getMonthlyStats(BRAND_ID);

    assert.ok(Number.isFinite(stats.totalCost), 'totalCost should be numeric');
    assert.ok(stats.totalCost > 0, 'totalCost should be > 0');
    assert.ok(stats.count > 0, 'count should be > 0');
    assert.ok(Object.keys(stats.bySource).length > 0, 'should have sources');
  });

  await t.test('cleanup: remove test costs', async () => {
    const { error: err1 } = await supabase
      .from('lead_costs')
      .delete()
      .eq('id', costId1);
    const { error: err2 } = await supabase
      .from('lead_costs')
      .delete()
      .eq('id', costId2);

    assert.strictEqual(err1, null, `cleanup cost1 error: ${err1?.message}`);
    assert.strictEqual(err2, null, `cleanup cost2 error: ${err2?.message}`);
  });

  await t.test('cleanup: remove test lead', async () => {
    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('id', leadId);

    assert.strictEqual(error, null, `cleanup lead error: ${error?.message}`);
  });
});
