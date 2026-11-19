import type { AiProviderId, AiProviderStatusDescriptor } from '@/types/domain';
import { classifyProviderError, createAiAppError } from '@/lib/intelligence/error-codes';
import { estimateStringTokens, selectModelForTask } from '../model-router';
import type {
  ModelEmbeddingResponse,
  ModelGenerateRequest,
  ModelProviderAdapter,
  ModelRawResponse,
} from '../types';

export class OpenAiCompatibleAdapter implements ModelProviderAdapter {
  public readonly providerId: Exclude<AiProviderId, 'gemini' | 'anthropic' | 'test_mock'>;
  public readonly isMock = false;

  constructor(providerId: 'vercel_ai_gateway' | 'openai') {
    this.providerId = providerId;
  }

  private getCredentials(): { apiKey: string; baseUrl: string; source: string } {
    if (this.providerId === 'vercel_ai_gateway') {
      const key = (
        process.env.AI_GATEWAY_API_KEY ||
        process.env.VERCEL_AI_GATEWAY_API_KEY ||
        ''
      ).trim();
      const baseUrl = (
        process.env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.vercel.sh/v1'
      ).replace(/\/+$/, '');
      return {
        apiKey: key,
        baseUrl,
        source: key ? 'AI_GATEWAY_API_KEY' : 'unset',
      };
    }

    const key = (process.env.OPENAI_API_KEY || '').trim();
    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(
      /\/+$/,
      '',
    );
    return {
      apiKey: key,
      baseUrl,
      source: key ? 'OPENAI_API_KEY' : 'unset',
    };
  }

  public getStatus(): AiProviderStatusDescriptor {
    const creds = this.getCredentials();
    const configured = Boolean(creds.apiKey && creds.apiKey.length >= 8);
    return {
      provider: this.providerId,
      label:
        this.providerId === 'vercel_ai_gateway'
          ? 'Vercel AI Gateway'
          : 'OpenAI Chat Completions',
      state: configured ? 'configured' : 'not_configured',
      source: creds.source,
      supportedTaskClasses: [
        'fast_routing',
        'classification',
        'research_synthesis',
        'deep_reasoning',
        'copy_generation',
        'qa_critique',
        'embedding',
      ],
      defaultModels: {
        fast_routing: selectModelForTask(this.providerId, 'fast_routing'),
        research_synthesis: selectModelForTask(this.providerId, 'research_synthesis'),
        deep_reasoning: selectModelForTask(this.providerId, 'deep_reasoning'),
        copy_generation: selectModelForTask(this.providerId, 'copy_generation'),
        embedding: selectModelForTask(this.providerId, 'embedding'),
      },
      reason: configured
        ? `Configured via server-side ${creds.source}.`
        : `${this.providerId === 'vercel_ai_gateway' ? 'AI_GATEWAY_API_KEY' : 'OPENAI_API_KEY'} is not set.`,
      isMock: false,
    };
  }

  public async generateText(req: ModelGenerateRequest): Promise<ModelRawResponse> {
    const creds = this.getCredentials();
    if (!creds.apiKey) {
      throw createAiAppError('AI_PROVIDER_NOT_CONFIGURED');
    }

    const model = selectModelForTask(this.providerId, req.taskClass);
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 45_000);

    try {
      const res = await fetch(`${creds.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxOutputTokens ?? 2048,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: req.systemInstruction },
            { role: 'user', content: req.userPrompt },
          ],
        }),
      });

      const body = (await res.json().catch(() => null)) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
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
          body?.error?.message || `Provider HTTP ${res.status}`,
        );
      }

      const text = body?.choices?.[0]?.message?.content || '';
      return {
        provider: this.providerId,
        model,
        text,
        inputTokens:
          body?.usage?.prompt_tokens ??
          estimateStringTokens(`${req.systemInstruction}\n${req.userPrompt}`),
        outputTokens: body?.usage?.completion_tokens ?? estimateStringTokens(text),
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

  public async embedText(text: string): Promise<ModelEmbeddingResponse> {
    const creds = this.getCredentials();
    if (!creds.apiKey) {
      throw createAiAppError('AI_PROVIDER_NOT_CONFIGURED');
    }
    const model = selectModelForTask(this.providerId, 'embedding');
    const res = await fetch(`${creds.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: text.slice(0, 4000),
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      data?: Array<{ embedding?: number[] }>;
      usage?: { prompt_tokens?: number };
    } | null;
    if (!res.ok || !body?.data?.[0]?.embedding) {
      throw createAiAppError('TASK_EXECUTION_FAILED', 'Embedding request failed.');
    }
    return {
      provider: this.providerId,
      model,
      values: body.data[0].embedding,
      inputTokens: body.usage?.prompt_tokens ?? estimateStringTokens(text),
      isMock: false,
    };
  }
}
