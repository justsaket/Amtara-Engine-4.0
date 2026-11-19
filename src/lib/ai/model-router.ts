import type { AiProviderId, ModelTaskClass } from '@/types/domain';

export const PROVIDER_MODEL_MATRIX: Record<
  Exclude<AiProviderId, 'test_mock'>,
  Record<ModelTaskClass, string>
> = {
  gemini: {
    fast_routing: 'gemini-3.1-flash-lite',
    classification: 'gemini-3.1-flash-lite',
    research_synthesis: 'gemini-4-hydrogen',
    deep_reasoning: 'gemini-4-argon',
    copy_generation: 'gemini-4-hydrogen',
    qa_critique: 'gemini-4-hydrogen',
    embedding: 'gemini-embedding-2',
  },
  vercel_ai_gateway: {
    fast_routing: 'google/gemini-2.5-flash-lite',
    classification: 'google/gemini-2.5-flash-lite',
    research_synthesis: 'google/gemini-2.5-flash',
    deep_reasoning: 'anthropic/claude-3.7-sonnet',
    copy_generation: 'openai/gpt-4o-mini',
    qa_critique: 'openai/gpt-4o-mini',
    embedding: 'openai/text-embedding-3-small',
  },
  openai: {
    fast_routing: 'gpt-4o-mini',
    classification: 'gpt-4o-mini',
    research_synthesis: 'gpt-4o-mini',
    deep_reasoning: 'gpt-4o',
    copy_generation: 'gpt-4o-mini',
    qa_critique: 'gpt-4o-mini',
    embedding: 'text-embedding-3-small',
  },
  anthropic: {
    fast_routing: 'claude-3-5-haiku-latest',
    classification: 'claude-3-5-haiku-latest',
    research_synthesis: 'claude-3-7-sonnet-latest',
    deep_reasoning: 'claude-3-7-sonnet-latest',
    copy_generation: 'claude-3-7-sonnet-latest',
    qa_critique: 'claude-3-5-haiku-latest',
    embedding: 'unsupported',
  },
};

/**
 * Known indicative rates (USD per 1M tokens) strictly for transparent local accounting.
 * Unknown or variable pricing models explicitly return pricingKnown = false, estimatedCostUsd = null.
 */
const INDICATIVE_PRICE_PER_1M: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'claude-3-5-haiku-latest': { input: 0.8, output: 4.0 },
  'claude-3-7-sonnet-latest': { input: 3.0, output: 15.0 },
  'gemini-3.1-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-4-hydrogen': { input: 0.15, output: 0.6 },
  'gemini-4-argon': { input: 1.25, output: 5.0 },
};

export function selectModelForTask(
  provider: AiProviderId,
  taskClass: ModelTaskClass,
): string {
  if (provider === 'test_mock') {
    return `mock-${taskClass}`;
  }
  return PROVIDER_MODEL_MATRIX[provider][taskClass];
}

export function estimateTokenCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  isMock = false,
): { estimatedCostUsd: number | null; pricingKnown: boolean } {
  if (isMock) {
    return { estimatedCostUsd: 0, pricingKnown: true };
  }
  const rate = INDICATIVE_PRICE_PER_1M[model];
  if (!rate) {
    return { estimatedCostUsd: null, pricingKnown: false };
  }
  const cost = (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
  return {
    estimatedCostUsd: Number(cost.toFixed(6)),
    pricingKnown: true,
  };
}

export function estimateStringTokens(text: string): number {
  const clean = (text || '').trim();
  if (!clean) return 0;
  return Math.max(1, Math.ceil(clean.length / 4));
}
