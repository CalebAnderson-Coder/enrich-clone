import test from 'node:test';
import assert from 'node:assert';
import { createClient } from '@supabase/supabase-js';
import { trackCost } from '../lib/costTracker.js';
import { calculateLlmCost } from '../lib/llmPricing.js';
import 'dotenv/config';

function buildSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

test('costTracker — LLM pricing calculation', async (t) => {
  // Test NVIDIA pricing: $0.6/M input, $1.8/M output
  const cost1 = calculateLlmCost('nvidia', 100_000, 50_000);
  assert.ok(cost1 > 0.05 && cost1 < 0.15, `NVIDIA cost should be ~$0.09, got ${cost1}`);

  // Test Gemini pricing: $0.075/M input, $0.3/M output
  const cost2 = calculateLlmCost('gemini_flash', 100_000, 50_000);
  assert.ok(cost2 > 0.01 && cost2 < 0.05, `Gemini cost should be ~$0.022, got ${cost2}`);

  console.log('✓ Test passed: LLM pricing calculations are correct');
});

test('costTracker — insert cost event to database', async (t) => {
  const sb = buildSupabase();
  const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

  // 1. Create a test lead
  const { data: insertedLead, error: leadError } = await sb
    .from('leads')
    .insert([
      {
        brand_id: BRAND_ID,
        email: `test-cost-${Date.now()}@example.com`,
        business_name: 'Test Cost Tracking',
        outreach_status: 'NEW',
      },
    ])
    .select('id')
    .single();

  if (leadError) {
    throw new Error(`Failed to insert test lead: ${leadError.message}`);
  }

  const leadId = insertedLead.id;

  // 2. Track a cost using trackCost()
  const success = await trackCost({
    lead_id: leadId,
    brand_id: BRAND_ID,
    source: 'llm_tokens',
    amount_usd: 0.15,
    metadata: {
      provider: 'nvidia',
      input_tokens: 100_000,
      output_tokens: 50_000,
    },
    sb,
  });

  assert.ok(success, 'trackCost should return true on success');

  // 3. Verify the cost was inserted
  const { data: costs, error: costsError } = await sb
    .from('lead_costs')
    .select('*')
    .eq('lead_id', leadId)
    .eq('source', 'llm_tokens');

  assert.equal(costsError, null, 'Should fetch costs without error');
  assert.ok(costs.length > 0, 'Should have at least one cost record');
  assert.equal(costs[0].amount_usd, '0.1500', 'Cost amount should be 0.15');
  assert.equal(costs[0].source, 'llm_tokens', 'Source should be llm_tokens');

  // 4. Cleanup
  await sb.from('lead_costs').delete().eq('lead_id', leadId);
  await sb.from('leads').delete().eq('id', leadId);

  console.log('✓ Test passed: costs can be tracked and retrieved correctly');
});

test('costTracker — validation of inputs', async (t) => {
  const sb = buildSupabase();
  const BRAND_ID = process.env.BRAND_ID ?? 'eca1d833-77e3-4690-8cf1-2a44db20dcf8';

  // Test missing lead_id
  const result1 = await trackCost({
    lead_id: null,
    brand_id: BRAND_ID,
    source: 'llm_tokens',
    amount_usd: 0.1,
    sb,
  });
  assert.equal(result1, false, 'Should reject null lead_id');

  // Test invalid source
  const result2 = await trackCost({
    lead_id: 'test-uuid',
    brand_id: BRAND_ID,
    source: 'invalid_source',
    amount_usd: 0.1,
    sb,
  });
  assert.equal(result2, false, 'Should reject invalid source');

  // Test negative amount
  const result3 = await trackCost({
    lead_id: 'test-uuid',
    brand_id: BRAND_ID,
    source: 'llm_tokens',
    amount_usd: -0.1,
    sb,
  });
  assert.equal(result3, false, 'Should reject negative amount_usd');

  console.log('✓ Test passed: input validation works correctly');
});
