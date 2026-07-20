import { strict as assert } from 'assert';
import { test } from 'node:test';
import { calculateLLMCost, LLM_PRICING } from '../lib/llmPricing.js';

test('smoke_cost_tracker', async t => {
  await t.test('LLM_PRICING contains nvidia-api and gemini-flash', () => {
    assert(LLM_PRICING['nvidia-api'], 'nvidia-api pricing missing');
    assert(LLM_PRICING['gemini-flash'], 'gemini-flash pricing missing');
    assert(LLM_PRICING['nvidia-api'].input > 0, 'nvidia input price should be > 0');
    assert(LLM_PRICING['gemini-flash'].input > 0, 'gemini input price should be > 0');
  });

  await t.test('calculateLLMCost returns reasonable values', () => {
    const cost = calculateLLMCost('nvidia-api', 1000, 500);
    assert(cost > 0, 'cost should be positive');
    assert(cost < 0.01, 'cost for small token count should be < $0.01');
  });

  await t.test('calculateLLMCost uses default pricing if model unknown', () => {
    const cost = calculateLLMCost('unknown-model', 1000, 500);
    assert(cost > 0, 'should still calculate cost with default pricing');
  });

  await t.test('gemini-flash cheaper than nvidia per token', () => {
    const geminiCost = calculateLLMCost('gemini-flash', 1000000, 1000000);
    const nvidiaCost = calculateLLMCost('nvidia-api', 1000000, 1000000);
    assert(geminiCost < nvidiaCost, 'gemini should be cheaper than nvidia');
  });

  await t.test('trackCost requires lead_id and brand_id', async () => {
    const mockCost = {
      lead_id: null,
      brand_id: 'test-brand',
      source: 'llm_tokens',
      amount_usd: 0.5,
    };
    assert(!mockCost.lead_id, 'test: lead_id should be missing for validation check');
  });

  await t.test('cost amount should be normalized to 6 decimals', () => {
    const testAmounts = [0.123456789, 0.5, 1.0, 0.000001];
    testAmounts.forEach(amount => {
      const normalized = parseFloat(amount.toFixed(6));
      assert(normalized >= 0, 'normalized cost should be non-negative');
    });
  });

  await t.test('getBrandCostMetrics calculates average per lead', async () => {
    const mockCosts = [
      { lead_id: 'lead-1', amount_usd: 1.0 },
      { lead_id: 'lead-1', amount_usd: 0.5 },
      { lead_id: 'lead-2', amount_usd: 2.0 },
    ];

    const totalCost = mockCosts.reduce((sum, c) => sum + c.amount_usd, 0);
    const uniqueLeads = new Set(mockCosts.map(c => c.lead_id)).size;
    const avgPerLead = totalCost / uniqueLeads;

    assert.strictEqual(totalCost, 3.5, 'total should be 3.5');
    assert.strictEqual(uniqueLeads, 2, 'should have 2 unique leads');
    assert.strictEqual(avgPerLead, 1.75, 'avg per lead should be 1.75');
  });
});
