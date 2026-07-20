export const LLM_PRICING = {
  'nvidia-api': {
    input: 0.6e-6,
    output: 1.8e-6,
  },
  'gemini-flash': {
    input: 0.075e-6,
    output: 0.3e-6,
  },
  'gemini-pro': {
    input: 0.5e-6,
    output: 1.5e-6,
  },
  'default': {
    input: 0.1e-6,
    output: 0.2e-6,
  },
};

export function calculateLLMCost(model, inputTokens, outputTokens) {
  const pricing = LLM_PRICING[model] || LLM_PRICING['default'];
  const inputCost = inputTokens * pricing.input;
  const outputCost = outputTokens * pricing.output;
  return inputCost + outputCost;
}
