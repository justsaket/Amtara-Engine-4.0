import type { AiProviderStatusDescriptor } from '@/types/domain';
import { classifyProviderError, createAiAppError } from '@/lib/intelligence/error-codes';
import { estimateStringTokens, selectModelForTask } from '../model-router';
import type {
  ModelGenerateRequest,
  ModelProviderAdapter,
  ModelRawResponse,
} from '../types';

export class AnthropicModelAdapter implements ModelProviderAdapter {
  public readonly providerId = 'anthropic' as const;
  public readonly isMock = false;

  private getApiKey(): string {
    return (process.env.ANTHROPIC_API_KEY || '').trim();
  }

  public getStatus(): AiProviderStatusDescriptor {
    const key = this.getApiKey();
    const configured = Boolean(key && key.length >= 8);
    return {
      provider: 'anthropic',
      label: 'Anthropic Claude',
      state: configured ? 'configured' : 'not_configured',
      source: configured ? 'ANTHROPIC_API_KEY' : 'unset',
      supportedTaskClasses: [
        'fast_routing',
        'classification',
        'research_synthesis',
        'deep_reasoning',
        'copy_generation',
        'qa_critique',
      ],
      defaultModels: {
        fast_routing: selectModelForTask('anthropic', 'fast_routing'),
        deep_reasoning: selectModelForTask('anthropic', 'deep_reasoning'),
        copy_generation: selectModelForTask('anthropic', 'copy_generation'),
      },
      reason: configured
        ? 'Configured via server-side ANTHROPIC_API_KEY.'
        : 'ANTHROPIC_API_KEY is not set in server environment.',
      isMock: false,
    };
  }

  public async generateText(req: ModelGenerateRequest): Promise<ModelRawResponse> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw createAiAppError('AI_PROVIDER_NOT_CONFIGURED');
    }

    const model = selectModelForTask('anthropic', req.taskClass);
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 45_000);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxOutputTokens ?? 2048,
          temperature: req.temperature ?? 0.2,
          system: req.systemInstruction,
          messages: [{ role: 'user', content: req.userPrompt }],
        }),
      });

      const body = (await res.json().catch(() => null)) as {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        error?: { message?: string };
      } | null;

      if (!res.ok) {
        if (res.status === 429) {
          throw createAiAppError('AI_RATE_LIMITED', body?.error?.message);
        }
        if (res.status === 402) {
          throw createAiAppError('AI_BILLING_LIMIT', body?.error?.message);
        }
        throw createAiAppError(
          'TASK_EXECUTION_FAILED',
          body?.error?.message || `Anthropic HTTP ${res.status}`,
        );
      }

      const text = (body?.content || [])
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text)
        .join('\n');

      return {
        provider: 'anthropic',
        model,
        text,
        inputTokens:
          body?.usage?.input_tokens ??
          estimateStringTokens(`${req.systemInstruction}\n${req.userPrompt}`),
        outputTokens: body?.usage?.output_tokens ?? estimateStringTokens(text),
        latencyMs: Date.now() - started,
        citations: [],
        isMock: false,
      };
    } catch (err) {
      const code = classifyProviderError(err);
      throw createAiAppError(code, err instanceof Error ? err.message : undefined);
    } finally {
      clearTimeout(timer);
    }
  }
}
