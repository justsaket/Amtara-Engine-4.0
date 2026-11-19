import type { Phase4ErrorCode, Phase4ProviderId } from '@/types/domain';

export interface Phase4StructuredError {
  code: Phase4ErrorCode;
  message: string;
  provider?: Phase4ProviderId;
  httpStatus: number;
  retryable: boolean;
  reconciliationRequired: boolean;
  nextAction: string;
  details?: Record<string, unknown>;
}

const SECRET_KEYS = [
  'token',
  'access_token',
  'refresh_token',
  'client_secret',
  'secret',
  'authorization',
  'apikey',
  'api_key',
  'password',
];

export function redactSecrets(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return input
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/(access_token|refresh_token|client_secret)=([^&\s]+)/gi, '$1=[REDACTED]');
  }
  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item));
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const lowered = key.toLowerCase();
      if (SECRET_KEYS.some((k) => lowered.includes(k))) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactSecrets(value);
      }
    }
    return out;
  }
  return input;
}

export class Phase4ExecutionError extends Error {
  public readonly code: Phase4ErrorCode;
  public readonly provider?: Phase4ProviderId;
  public readonly httpStatus: number;
  public readonly retryable: boolean;
  public readonly reconciliationRequired: boolean;
  public readonly nextAction: string;
  public readonly details?: Record<string, unknown>;

  constructor(params: Phase4StructuredError) {
    super(String(redactSecrets(params.message)));
    this.name = 'Phase4ExecutionError';
    this.code = params.code;
    this.provider = params.provider;
    this.httpStatus = params.httpStatus;
    this.retryable = params.retryable;
    this.reconciliationRequired = params.reconciliationRequired;
    this.nextAction = params.nextAction;
    this.details = params.details
      ? (redactSecrets(params.details) as Record<string, unknown>)
      : undefined;
  }

  toJSON(): Phase4StructuredError {
    return {
      code: this.code,
      message: this.message,
      provider: this.provider,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      reconciliationRequired: this.reconciliationRequired,
      nextAction: this.nextAction,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function classifyProviderHttpError(
  provider: Phase4ProviderId,
  httpStatus: number,
  rawMessage: string,
  extra?: { codeHint?: string; duringCommitPublish?: boolean },
): Phase4ExecutionError {
  const safeMsg = String(redactSecrets(rawMessage || 'Provider request failed.'));
  const lower = safeMsg.toLowerCase();

  if (extra?.duringCommitPublish && (httpStatus === 0 || httpStatus === 408 || httpStatus === 504)) {
    return new Phase4ExecutionError({
      code: 'PUBLISH_STATUS_UNKNOWN',
      provider,
      httpStatus: 504,
      retryable: false,
      reconciliationRequired: true,
      message: `Publishing request timed out or lost connection before ${provider} confirmed completion: ${safeMsg}`,
      nextAction:
        'Do not automatically blind-retry. Run Reconciliation Check in Publishing Recovery to verify whether the post already exists on the provider.',
    });
  }

  if (httpStatus === 401 || lower.includes('expired') || lower.includes('invalid_token')) {
    return new Phase4ExecutionError({
      code: 'TOKEN_EXPIRED',
      provider,
      httpStatus: 401,
      retryable: false,
      reconciliationRequired: false,
      message: `Authorization token expired or invalidated for ${provider}.`,
      nextAction: 'Reconnect or reauthorize the account under Publishing Accounts.',
    });
  }

  if (
    httpStatus === 403 ||
    lower.includes('permission') ||
    lower.includes('scope') ||
    lower.includes('insufficient')
  ) {
    const needsReview = lower.includes('review') || lower.includes('unaudited') || lower.includes('approved');
    return new Phase4ExecutionError({
      code: needsReview ? 'APP_REVIEW_REQUIRED' : 'PERMISSION_MISSING',
      provider,
      httpStatus: 403,
      retryable: false,
      reconciliationRequired: false,
      message: safeMsg,
      nextAction: needsReview
        ? `Complete ${provider} app review / API access approval before enabling public actions.`
        : `Grant the required ${provider} OAuth scopes or account role permissions.`,
    });
  }

  if (httpStatus === 429 || lower.includes('rate limit') || lower.includes('quota')) {
    return new Phase4ExecutionError({
      code: 'RATE_LIMITED',
      provider,
      httpStatus: 429,
      retryable: true,
      reconciliationRequired: false,
      message: `Provider rate limit reached for ${provider}: ${safeMsg}`,
      nextAction: 'Scheduler will back off and retry after the provider quota window resets.',
    });
  }

  if (httpStatus >= 500 || httpStatus === 0) {
    return new Phase4ExecutionError({
      code: 'PROVIDER_TEMPORARY_ERROR',
      provider,
      httpStatus: httpStatus || 503,
      retryable: true,
      reconciliationRequired: false,
      message: `Temporary ${provider} service error (${httpStatus || 'network'}): ${safeMsg}`,
      nextAction: 'Safe to retry with exponential backoff.',
    });
  }

  return new Phase4ExecutionError({
    code: 'PROVIDER_PERMANENT_ERROR',
    provider,
    httpStatus: httpStatus || 400,
    retryable: false,
    reconciliationRequired: false,
    message: `${provider} rejected the request (${httpStatus}): ${safeMsg}`,
    nextAction: 'Inspect payload, media dimensions, and account configuration before resubmitting.',
  });
}
