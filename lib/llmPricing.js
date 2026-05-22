// ============================================================
// lib/llmPricing.js — LLM Provider Pricing (per 1M tokens)
//
// Centralized pricing for all LLM providers used in Empírika.
// Used by costTracker.js to calculate exact spend per token.
//
// Prices are kept current with provider dashboards.
// Update quarterly or when notified of price changes.
// ============================================================

export const LLM_PRICING = {
  // NVIDIA — NIM hosted API
  // Reference: https://cloud.nvidia.com/pricing
  'nvidia-nim': {
    input_per_1m: 0.60,
    output_per_1m: 1.80,
    model_default: 'llama-3.1-70b',
  },

  // Google Gemini Flash 2.0
  // Reference: https://ai.google.dev/pricing
  'gemini-2.0-flash': {
    input_per_1m: 0.075,
    output_per_1m: 0.30,
    model_default: 'gemini-2.0-flash',
  },

  // OpenAI GPT-4o (fallback, if used)
  'gpt-4o': {
    input_per_1m: 2.5,
    output_per_1m: 10.0,
    model_default: 'gpt-4o',
  },

  // Anthropic Claude 3.5 Sonnet (fallback, if used)
  'claude-3.5-sonnet': {
    input_per_1m: 3.0,
    output_per_1m: 15.0,
    model_default: 'claude-3.5-sonnet',
  },
};

/**
 * Calculate cost for an LLM call given input and output tokens.
 *
 * @param {string} provider - key in LLM_PRICING (e.g., 'nvidia-nim', 'gemini-2.0-flash')
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number} cost in USD
 */
export function calculateLlmCost(provider, inputTokens, outputTokens) {
  const pricing = LLM_PRICING[provider];
  if (!pricing) {
    console.warn(`Unknown LLM provider: ${provider}, returning 0`);
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input_per_1m;
  const outputCost = (outputTokens / 1_000_000) * pricing.output_per_1m;
  return inputCost + outputCost;
}

/**
 * Get the default model name for a provider.
 */
export function getDefaultModel(provider) {
  return LLM_PRICING[provider]?.model_default ?? provider;
}
