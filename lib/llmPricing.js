export const LLM_PRICING = {
  nvidia: {
    model: 'meta/llama-3.1-70b-instruct',
    inputPerMillion: 0.6,
    outputPerMillion: 0.6,
  },
  gemini: {
    model: 'gemini-2.0-flash',
    inputPerMillion: 0.075,
    outputPerMillion: 0.3,
  },
};

export function calculateTokenCost(model, inputTokens, outputTokens) {
  const pricing = LLM_PRICING[model];
  if (!pricing) return 0;

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;

  return +(inputCost + outputCost).toFixed(6);
}
