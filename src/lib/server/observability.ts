import crypto from 'node:crypto';

export type FailureClassification =
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'CONFIGURATION'
  | 'AUTHORIZATION'
  | 'VALIDATION'
  | 'RATE_LIMIT'
  | 'UNKNOWN';

export interface StructuredLogEntry {
  eventId: string;
  timestamp: string;
  correlationId: string;
  workspaceId?: string;
  userId?: string;
  operation: string;
  provider?: string;
  status: 'ok' | 'warning' | 'error';
  errorClassification?: FailureClassification;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_KEY_PATTERN =
  /(secret|token|password|apikey|api_key|privatekey|private_key|authorization|cookie|envelope|credential|encryption_key|session_secret|client_secret|refresh)/i;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /ya29\.[A-Za-z0-9\-_]+/g,
  /AIza[0-9A-Za-z\-_]{20,}/g,
  /sk-[A-Za-z0-9]{16,}/g,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
];

export function createCorrelationId(prefix = 'corr'): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function redactSensitiveString(input: string): string {
  let out = input;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

export function redactSensitiveObject(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactSensitiveString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactSensitiveObject(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSensitiveObject(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export function classifyOperationalError(err: unknown): FailureClassification {
  if (!err || typeof err !== 'object') return 'UNKNOWN';
  const rec = err as { code?: string; statusCode?: number; httpStatus?: number; message?: string };
  const code = String(rec.code || '').toUpperCase();
  const status = Number(rec.statusCode || rec.httpStatus || 0);
  const msg = String(rec.message || '').toLowerCase();

  if (code.includes('RATE_LIMIT') || status === 429 || msg.includes('rate limit')) {
    return 'RATE_LIMIT';
  }
  if (
    code.includes('NOT_CONFIGURED') ||
    code.includes('MISCONFIGURED') ||
    code.includes('PROJECT_CONFLICT') ||
    msg.includes('not configured')
  ) {
    return 'CONFIGURATION';
  }
  if (
    code.includes('UNAUTHORIZED') ||
    code.includes('FORBIDDEN') ||
    code.includes('PERMISSION') ||
    code.includes('TOKEN_EXPIRED') ||
    code.includes('APPROVAL') ||
    code.includes('AUTH') ||
    status === 401 ||
    status === 403
  ) {
    return 'AUTHORIZATION';
  }
  if (code.includes('VALIDATION') || code.includes('INVALID') || status === 400 || status === 422) {
    return 'VALIDATION';
  }
  if (
    code.includes('TEMPORARY') ||
    code.includes('TIMEOUT') ||
    code.includes('UNAVAILABLE') ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes('timeout') ||
    msg.includes('econnreset')
  ) {
    return 'TRANSIENT';
  }
  if (
    code.includes('PERMANENT') ||
    code.includes('UNSUPPORTED') ||
    code.includes('NOT_FOUND') ||
    status === 404 ||
    status === 409
  ) {
    return 'PERMANENT';
  }
  return 'UNKNOWN';
}

const recentStructuredLogs: StructuredLogEntry[] = [];
const MAX_IN_MEMORY_LOGS = 200;

export function buildStructuredLog(
  entry: Omit<StructuredLogEntry, 'eventId' | 'timestamp' | 'correlationId'> & {
    correlationId?: string;
  },
): StructuredLogEntry {
  const safe: StructuredLogEntry = {
    eventId: `evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`,
    timestamp: new Date().toISOString(),
    correlationId: entry.correlationId || createCorrelationId(),
    workspaceId: entry.workspaceId,
    userId: entry.userId,
    operation: entry.operation,
    provider: entry.provider,
    status: entry.status,
    errorClassification: entry.errorClassification,
    durationMs: entry.durationMs,
    metadata: entry.metadata
      ? (redactSensitiveObject(entry.metadata) as Record<string, unknown>)
      : undefined,
  };
  return safe;
}

export function logStructuredEvent(
  entry: Omit<StructuredLogEntry, 'eventId' | 'timestamp' | 'correlationId'> & {
    correlationId?: string;
  },
): StructuredLogEntry {
  const safe = buildStructuredLog(entry);
  recentStructuredLogs.unshift(safe);
  if (recentStructuredLogs.length > MAX_IN_MEMORY_LOGS) {
    recentStructuredLogs.length = MAX_IN_MEMORY_LOGS;
  }

  if (process.env.NODE_ENV !== 'test') {
    const serialized = JSON.stringify(safe);
    if (safe.status === 'error') {
      console.error(serialized);
    } else if (safe.status === 'warning') {
      console.warn(serialized);
    } else {
      console.info(serialized);
    }
  }

  return safe;
}

export function listRecentStructuredLogs(workspaceId?: string, limit = 40): StructuredLogEntry[] {
  const filtered = workspaceId
    ? recentStructuredLogs.filter((l) => l.workspaceId === workspaceId)
    : recentStructuredLogs;
  return filtered.slice(0, Math.min(limit, MAX_IN_MEMORY_LOGS));
}
