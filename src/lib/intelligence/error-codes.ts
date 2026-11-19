import crypto from 'node:crypto';
import type { AiErrorCode } from '@/types/domain';
import { AppError } from '@/lib/server/error-handler';

export interface AiErrorCatalogEntry {
  code: AiErrorCode;
  httpStatus: number;
  retryable: boolean;
  userMessage: string;
}

export const AI_ERROR_CATALOG: Record<AiErrorCode, AiErrorCatalogEntry> = {
  AI_PROVIDER_NOT_CONFIGURED: {
    code: 'AI_PROVIDER_NOT_CONFIGURED',
    httpStatus: 503,
    retryable: false,
    userMessage:
      'No AI inference provider is configured in server environment variables (GEMINI_API_KEY, AI_GATEWAY_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY). Non-AI workspace features remain fully operational.',
  },
  AI_PROVIDER_TIMEOUT: {
    code: 'AI_PROVIDER_TIMEOUT',
    httpStatus: 504,
    retryable: true,
    userMessage: 'The AI model provider timed out before completing structured generation.',
  },
  AI_RATE_LIMITED: {
    code: 'AI_RATE_LIMITED',
    httpStatus: 429,
    retryable: true,
    userMessage: 'The AI provider rate limit was reached. Retry briefly or route to a secondary provider.',
  },
  AI_BILLING_LIMIT: {
    code: 'AI_BILLING_LIMIT',
    httpStatus: 402,
    retryable: false,
    userMessage: 'The active AI provider or workspace token budget limit was reached.',
  },
  INVALID_STRUCTURED_OUTPUT: {
    code: 'INVALID_STRUCTURED_OUTPUT',
    httpStatus: 422,
    retryable: true,
    userMessage: 'The model response did not conform to the required AgentResult schema.',
  },
  AGENT_STEP_LIMIT_REACHED: {
    code: 'AGENT_STEP_LIMIT_REACHED',
    httpStatus: 422,
    retryable: false,
    userMessage: 'Agent execution reached its bounded step or tool-call ceiling cleanly.',
  },
  WORKSPACE_ACCESS_DENIED: {
    code: 'WORKSPACE_ACCESS_DENIED',
    httpStatus: 403,
    retryable: false,
    userMessage: 'Active workspace membership or required RBAC permission is missing.',
  },
  BRAND_CONTEXT_UNAVAILABLE: {
    code: 'BRAND_CONTEXT_UNAVAILABLE',
    httpStatus: 404,
    retryable: false,
    userMessage: 'Requested brand profile does not exist inside this workspace.',
  },
  RESEARCH_SOURCE_UNAVAILABLE: {
    code: 'RESEARCH_SOURCE_UNAVAILABLE',
    httpStatus: 503,
    retryable: true,
    userMessage: 'Live external web research sources are unreachable or unconfigured.',
  },
  SOURCE_VERIFICATION_FAILED: {
    code: 'SOURCE_VERIFICATION_FAILED',
    httpStatus: 422,
    retryable: false,
    userMessage: 'External source failed SSRF, scheme, or content verification policies.',
  },
  TOOL_PERMISSION_DENIED: {
    code: 'TOOL_PERMISSION_DENIED',
    httpStatus: 403,
    retryable: false,
    userMessage: 'Agent attempted to call a tool outside its allowed registry permissions.',
  },
  DUPLICATE_TASK: {
    code: 'DUPLICATE_TASK',
    httpStatus: 409,
    retryable: false,
    userMessage: 'Duplicate run or event idempotency key already processed in this workspace.',
  },
  TASK_EXECUTION_FAILED: {
    code: 'TASK_EXECUTION_FAILED',
    httpStatus: 500,
    retryable: true,
    userMessage: 'Specialist agent task failed during execution.',
  },
  WORKFLOW_PARTIALLY_COMPLETED: {
    code: 'WORKFLOW_PARTIALLY_COMPLETED',
    httpStatus: 207,
    retryable: true,
    userMessage: 'One or more dependent workflow branches failed while upstream results were saved.',
  },
};

export function createCorrelationId(): string {
  return `corr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function createAiAppError(
  code: AiErrorCode,
  overrideMessage?: string,
  correlationId?: string,
): AppError {
  const entry = AI_ERROR_CATALOG[code];
  const suffix = correlationId ? ` [Correlation: ${correlationId}]` : '';
  return new AppError(
    entry.httpStatus,
    entry.code,
    `${overrideMessage || entry.userMessage}${suffix}`,
  );
}

export function classifyProviderError(err: unknown): AiErrorCode {
  if (err instanceof AppError && err.code in AI_ERROR_CATALOG) {
    return err.code as AiErrorCode;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('abort') || msg.includes('timeout') || msg.includes('timed out')) {
    return 'AI_PROVIDER_TIMEOUT';
  }
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
    return 'AI_RATE_LIMITED';
  }
  if (msg.includes('billing') || msg.includes('insufficient_quota') || msg.includes('credit')) {
    return 'AI_BILLING_LIMIT';
  }
  if (msg.includes('not configured') || msg.includes('api key') && msg.includes('missing')) {
    return 'AI_PROVIDER_NOT_CONFIGURED';
  }
  return 'TASK_EXECUTION_FAILED';
}
