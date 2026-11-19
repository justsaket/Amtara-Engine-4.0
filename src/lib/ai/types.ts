import type { z } from 'zod';
import type {
  AiProviderId,
  AiProviderStatusDescriptor,
  ModelTaskClass,
} from '@/types/domain';

export interface GroundingCitation {
  url: string;
  title: string;
  snippet?: string;
}

export interface ModelGenerateRequest {
  taskClass: ModelTaskClass;
  systemInstruction: string;
  userPrompt: string;
  maxOutputTokens?: number;
  temperature?: number;
  enableWebGrounding?: boolean;
  preferredProvider?: AiProviderId;
  timeoutMs?: number;
}

export interface ModelStructuredRequest<T> extends ModelGenerateRequest {
  schema: z.ZodType<T>;
  schemaDescription: string;
}

export interface ModelRawResponse {
  provider: AiProviderId;
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  citations: GroundingCitation[];
  isMock: boolean;
}

export interface ModelStructuredResponse<T> {
  provider: AiProviderId;
  model: string;
  data: T;
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  citations: GroundingCitation[];
  estimatedCostUsd: number | null;
  pricingKnown: boolean;
  isMock: boolean;
}

export interface ModelEmbeddingResponse {
  provider: AiProviderId;
  model: string;
  values: number[];
  inputTokens: number;
  isMock: boolean;
}

export interface ModelProviderAdapter {
  readonly providerId: AiProviderId;
  readonly isMock: boolean;
  getStatus(): AiProviderStatusDescriptor;
  generateText(req: ModelGenerateRequest): Promise<ModelRawResponse>;
  embedText?(text: string): Promise<ModelEmbeddingResponse>;
}
