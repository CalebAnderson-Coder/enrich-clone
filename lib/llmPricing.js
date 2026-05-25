const LLM_PRICING = {
  nvidia: {
    name: 'NVIDIA',
    input: 0.6 / 1_000_000,
    output: 0.6 / 1_000_000,
  },
  gemini: {
    name: 'Google Gemini Flash',
    input: 0.075 / 1_000_000,
    output: 0.3 / 1_000_000,
  },
  openai: {
    name: 'OpenAI GPT-4',
    input: 0.5 / 1_000_000,
    output: 1.5 / 1_000_000,
  },
};

function calculateTokenCost(model, inputTokens, outputTokens) {
  const pricing = LLM_PRICING[model] || LLM_PRICING.gemini;
  const inputCost = (inputTokens || 0) * pricing.input;
  const outputCost = (outputTokens || 0) * pricing.output;
  return inputCost + outputCost;
}

export { LLM_PRICING, calculateTokenCost };
