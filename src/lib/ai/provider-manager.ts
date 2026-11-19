import { z } from 'zod';
import type {
  AiProviderId,
  AiProviderStatusDescriptor,
  ModelTaskClass,
} from '@/types/domain';
import { createAiAppError } from '@/lib/intelligence/error-codes';
import { AnthropicModelAdapter } from './adapters/anthropic-adapter';
import { GeminiModelAdapter } from './adapters/gemini-adapter';
import { OpenAiCompatibleAdapter } from './adapters/openai-compatible-adapter';
import { estimateTokenCostUsd } from './model-router';
import type {
  ModelEmbeddingResponse,
  ModelProviderAdapter,
  ModelRawResponse,
  ModelStructuredRequest,
  ModelStructuredResponse,
} from './types';

function extractJsonText(raw: string): string {
  const trimmed = (raw || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export class ModelProviderManager {
  private readonly adapters: Map<AiProviderId, ModelProviderAdapter> = new Map();
  private readonly fallbackOrder: AiProviderId[] = [
    'vercel_ai_gateway',
    'gemini',
    'openai',
    'anthropic',
  ];

  constructor(options?: {
    customAdapters?: ModelProviderAdapter[];
    includeDefaultEnvAdapters?: boolean;
  }) {
    if (options?.includeDefaultEnvAdapters !== false) {
      const defaults: ModelProviderAdapter[] = [
        new GeminiModelAdapter(),
        new OpenAiCompatibleAdapter('vercel_ai_gateway'),
        new OpenAiCompatibleAdapter('openai'),
        new AnthropicModelAdapter(),
      ];
      for (const adapter of defaults) {
        this.adapters.set(adapter.providerId, adapter);
      }
    }
    if (options?.customAdapters) {
      for (const adapter of options.customAdapters) {
        this.adapters.set(adapter.providerId, adapter);
      }
    }
  }

  public getProviderStatuses(): AiProviderStatusDescriptor[] {
    return Array.from(this.adapters.values()).map((a) => a.getStatus());
  }

  public hasConfiguredProvider(): boolean {
    return this.getProviderStatuses().some(
      (s) => s.state === 'configured' || s.state === 'test_only',
    );
  }

  public selectAdapter(
    taskClass: ModelTaskClass,
    preferredProvider?: AiProviderId,
  ): ModelProviderAdapter | null {
    if (preferredProvider) {
      const explicit = this.adapters.get(preferredProvider);
      if (explicit) {
        const status = explicit.getStatus();
        if (
          (status.state === 'configured' || status.state === 'test_only') &&
          status.supportedTaskClasses.includes(taskClass)
        ) {
          return explicit;
        }
      }
    }

    // If a test_mock adapter was explicitly registered, prioritize it in tests
    const testMock = this.adapters.get('test_mock');
    if (testMock && testMock.getStatus().supportedTaskClasses.includes(taskClass)) {
      return testMock;
    }

    for (const id of this.fallbackOrder) {
      const adapter = this.adapters.get(id);
      if (!adapter) continue;
      const status = adapter.getStatus();
      if (
        status.state === 'configured' &&
        status.supportedTaskClasses.includes(taskClass)
      ) {
        return adapter;
      }
    }
    return null;
  }

  public async generateStructured<T>(
    req: ModelStructuredRequest<T>,
  ): Promise<ModelStructuredResponse<T>> {
    const adapter = this.selectAdapter(req.taskClass, req.preferredProvider);
    if (!adapter) {
      throw createAiAppError('AI_PROVIDER_NOT_CONFIGURED');
    }

    const strictPrompt = [
      req.userPrompt,
      '',
      '[OUTPUT FORMAT REQUIREMENT]',
      'Return strictly valid JSON only (no markdown prose outside JSON). Match this specification:',
      req.schemaDescription,
    ].join('\n');

    let lastRaw: ModelRawResponse | null = null;
    let lastErrorMessage = 'Invalid JSON structure';

    // Maximum 1 retry with schema repair feedback if parsing/validation fails
    for (let attempt = 0; attempt < 2; attempt++) {
      const promptToUse =
        attempt === 0
          ? strictPrompt
          : `${strictPrompt}\n\n[PREVIOUS SCHEMA ERROR — FIX AND RETURN VALID JSON ONLY]\n${lastErrorMessage}`;

      const rawRes = await adapter.generateText({
        ...req,
        userPrompt: promptToUse,
      });
      lastRaw = rawRes;

      try {
        const jsonText = extractJsonText(rawRes.text);
        const parsedJson = JSON.parse(jsonText) as unknown;
        const validated = req.schema.parse(parsedJson);
        const cost = estimateTokenCostUsd(
          rawRes.model,
          rawRes.inputTokens,
          rawRes.outputTokens,
          rawRes.isMock,
        );
        return {
          provider: rawRes.provider,
          model: rawRes.model,
          data: validated,
          rawText: rawRes.text,
          inputTokens: rawRes.inputTokens,
          outputTokens: rawRes.outputTokens,
          latencyMs: rawRes.latencyMs,
          citations: rawRes.citations,
          estimatedCostUsd: cost.estimatedCostUsd,
          pricingKnown: cost.pricingKnown,
          isMock: rawRes.isMock,
        };
      } catch (err) {
        if (err instanceof z.ZodError) {
          lastErrorMessage = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        } else {
          lastErrorMessage = err instanceof Error ? err.message : String(err);
        }
      }
    }

    throw createAiAppError(
      'INVALID_STRUCTURED_OUTPUT',
      `Model ${lastRaw?.model || 'unknown'} failed structured validation: ${lastErrorMessage}`,
    );
  }

  public async embedText(text: string): Promise<ModelEmbeddingResponse | null> {
    const adapter = this.selectAdapter('embedding');
    if (!adapter?.embedText) return null;
    return adapter.embedText(text);
  }
}

export function createDefaultModelProviderManager(): ModelProviderManager {
  return new ModelProviderManager();
}
