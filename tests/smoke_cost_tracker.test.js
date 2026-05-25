import assert from 'assert';
import { trackCost, trackLLMCost, LLM_PRICING } from '../lib/costTracker.js';
import { calculateTokenCost } from '../lib/llmPricing.js';

console.log('✓ Testing cost tracker...\n');

assert(LLM_PRICING.gemini.input > 0, 'Gemini input pricing should be > 0');
assert(LLM_PRICING.nvidia.output > 0, 'NVIDIA output pricing should be > 0');
console.log('✓ LLM_PRICING constants are correct');

const cost1 = calculateTokenCost('gemini', 1000, 500);
assert(cost1 > 0, 'Token cost should be > 0');
assert(cost1 < 0.01, 'Cost for 1000 input + 500 output should be < $0.01');
console.log(`✓ calculateTokenCost('gemini', 1000, 500) = $${cost1.toFixed(6)}`);

const cost2 = calculateTokenCost('openai', 2000, 1000);
assert(cost2 > cost1, 'OpenAI should be more expensive than Gemini');
console.log(`✓ calculateTokenCost('openai', 2000, 1000) = $${cost2.toFixed(6)}`);

const cost3 = calculateTokenCost('nvidia', 500, 250);
assert(cost3 > 0, 'NVIDIA cost should be > 0');
console.log(`✓ calculateTokenCost('nvidia', 500, 250) = $${cost3.toFixed(6)}`);

console.log('\n✅ All cost tracker tests passed!');
process.exit(0);
