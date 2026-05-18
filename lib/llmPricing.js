export const LLM_PRICING = {
  'meta/llama-3.1-70b-instruct': {
    provider: 'nvidia',
    input_per_1m_tokens: 0.6,
    output_per_1m_tokens: 0.6,
  },
  'gemini-1.5-flash': {
    provider: 'gemini',
    input_per_1m_tokens: 0.075,
    output_per_1m_tokens: 0.3,
  },
  'gemini-2.0-flash': {
    provider: 'gemini',
    input_per_1m_tokens: 0.075,
    output_per_1m_tokens: 0.3,
  },
};

export function calculateTokenCost(model, inputTokens, outputTokens) {
  const pricing = LLM_PRICING[model];
  if (!pricing) {
    return 0;
  }
  const inputCost = (inputTokens / 1_000_000) * pricing.input_per_1m_tokens;
  const outputCost = (outputTokens / 1_000_000) * pricing.output_per_1m_tokens;
  return inputCost + outputCost;
}
