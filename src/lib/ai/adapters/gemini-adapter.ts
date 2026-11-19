import { GoogleGenAI } from '@google/genai';
import type { AiProviderStatusDescriptor } from '@/types/domain';
import { classifyProviderError, createAiAppError } from '@/lib/intelligence/error-codes';
import { estimateStringTokens, selectModelForTask } from '../model-router';
import type {
  GroundingCitation,
  ModelEmbeddingResponse,
  ModelGenerateRequest,
  ModelProviderAdapter,
  ModelRawResponse,
} from '../types';

export class GeminiModelAdapter implements ModelProviderAdapter {
  public readonly providerId = 'gemini' as const;
  public readonly isMock = false;

  private getApiKey(): string {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    if (!key || key === 'MY_GEMINI_API_KEY') return '';
    return key;
  }

  public getStatus(): AiProviderStatusDescriptor {
    const apiKey = this.getApiKey();
    const configured = Boolean(apiKey);
    const paidEnabled = process.env.GEMINI_ENABLE_PAID_MODELS === 'true';
    return {
      provider: 'gemini',
      label: 'Google Gemini (@google/genai)',
      state: configured ? 'configured' : 'not_configured',
      source: configured ? 'GEMINI_API_KEY' : 'unset',
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
        fast_routing: 'gemini-3.1-flash-lite',
        research_synthesis: 'gemini-4-hydrogen',
        deep_reasoning: paidEnabled ? 'gemini-4-argon' : 'gemini-4-hydrogen',
        copy_generation: 'gemini-4-hydrogen',
        embedding: 'gemini-embedding-2',
      },
      reason: configured
        ? 'Configured via server-side GEMINI_API_KEY with native Google Search grounding support.'
        : 'GEMINI_API_KEY is not set in server environment variables.',
      isMock: false,
    };
  }

  public async generateText(req: ModelGenerateRequest): Promise<ModelRawResponse> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw createAiAppError('AI_PROVIDER_NOT_CONFIGURED');
    }

    const paidEnabled = process.env.GEMINI_ENABLE_PAID_MODELS === 'true';
    let model = selectModelForTask('gemini', req.taskClass);
    if (model === 'gemini-4-argon' && !paidEnabled) {
      model = 'gemini-4-hydrogen';
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' },
      },
    });

    const started = Date.now();
    const timeoutMs = req.timeoutMs ?? 45_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const config: Record<string, unknown> = {
        systemInstruction: req.systemInstruction,
        maxOutputTokens: req.maxOutputTokens ?? 2048,
        temperature: req.temperature ?? 0.2,
        abortSignal: controller.signal,
      };

      if (req.enableWebGrounding) {
        config.tools = [{ googleSearch: {} }];
      } else {
        config.responseMimeType = 'application/json';
      }

      const response = await ai.models.generateContent({
        model,
        contents: req.userPrompt,
        config,
      });

      const text = response.text || '';
      const latencyMs = Date.now() - started;

      const groundingChunks =
        (
          response.candidates?.[0] as
            | {
                groundingMetadata?: {
                  groundingChunks?: Array<{
                    web?: { uri?: string; title?: string };
                  }>;
                };
              }
            | undefined
        )?.groundingMetadata?.groundingChunks || [];

      const citations: GroundingCitation[] = groundingChunks
        .map((c) => c.web)
        .filter((w): w is { uri: string; title?: string } => Boolean(w?.uri))
        .map((w) => ({
          url: w.uri,
          title: w.title || w.uri,
        }));

      const usageMeta = (
        response as {
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
          };
        }
      ).usageMetadata;

      return {
        provider: 'gemini',
        model,
        text,
        inputTokens:
          usageMeta?.promptTokenCount ??
          estimateStringTokens(`${req.systemInstruction}\n${req.userPrompt}`),
        outputTokens: usageMeta?.candidatesTokenCount ?? estimateStringTokens(text),
        latencyMs,
        citations,
        isMock: false,
      };
    } catch (err) {
      const code = classifyProviderError(err);
      throw createAiAppError(
        code,
        err instanceof Error ? err.message : 'Gemini request failed.',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  public async embedText(text: string): Promise<ModelEmbeddingResponse> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw createAiAppError('AI_PROVIDER_NOT_CONFIGURED');
    }
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' },
      },
    });
    const model = 'gemini-embedding-2';
    const res = await ai.models.embedContent({
      model,
      contents: text.slice(0, 4000),
    });
    const values = res.embeddings?.[0]?.values || [];
    return {
      provider: 'gemini',
      model,
      values,
      inputTokens: estimateStringTokens(text),
      isMock: false,
    };
  }
}
