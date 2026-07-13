// ============================================================
// lib/llmPricing.js — LLM token pricing constants
//
// Pricing table for LLM models used in Empírika.
// Prices per 1M tokens as of July 2026.
//
// Sources:
//   - NVIDIA: https://cloud.nvidia.com/pricing
//   - Google Gemini: https://ai.google.dev/pricing
// ============================================================

export const LLM_PRICING = {
  // Google Gemini models
  'gemini-1.5-flash': {
    input_price_per_1m:   0.075,   // $0.075 per 1M input tokens
    output_price_per_1m:  0.3,     // $0.3 per 1M output tokens
    model_type: 'gemini',
  },
  'gemini-1.5-pro': {
    input_price_per_1m:   3.5,
    output_price_per_1m:  10.5,
    model_type: 'gemini',
  },
  'gemini-2.0-flash': {
    input_price_per_1m:   0.075,
    output_price_per_1m:  0.3,
    model_type: 'gemini',
  },

  // NVIDIA models (via API)
  'nvidia-llama-2-70b': {
    input_price_per_1m:   0.6,
    output_price_per_1m:  0.6,
    model_type: 'nvidia',
  },
  'nvidia-mistral-large': {
    input_price_per_1m:   0.4,
    output_price_per_1m:  0.4,
    model_type: 'nvidia',
  },

  // Fallback defaults (if model not in table)
  'default': {
    input_price_per_1m:   0.1,
    output_price_per_1m:  0.3,
    model_type: 'unknown',
  },
};

/**
 * Calculate token cost for a given model and token counts.
 *
 * @param {string} model       — model identifier (e.g., 'gemini-1.5-flash')
 * @param {number} inputTokens — number of input tokens
 * @param {number} outputTokens — number of output tokens
 * @returns {number} cost in USD
 */
export function calculateTokenCost(model, inputTokens, outputTokens) {
  const pricing = LLM_PRICING[model] || LLM_PRICING.default;
  const inputCost = (inputTokens / 1_000_000) * pricing.input_price_per_1m;
  const outputCost = (outputTokens / 1_000_000) * pricing.output_price_per_1m;
  return parseFloat((inputCost + outputCost).toFixed(6));
}

export default LLM_PRICING;
