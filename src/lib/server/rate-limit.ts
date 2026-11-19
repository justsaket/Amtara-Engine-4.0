import { AppError } from './error-handler';

export interface RateLimitConfig {
  key: string;
  maxRequests: number;
  windowMs: number;
  nowMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
  retryAfterSeconds: number;
}

const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 2000;

export function checkRateLimit(config: RateLimitConfig): RateLimitResult {
  const now = config.nowMs ?? Date.now();
  const cutoff = now - config.windowMs;

  if (buckets.size > MAX_BUCKETS) {
    // Evict stale keys to keep memory strictly bounded
    for (const [k, stamps] of buckets.entries()) {
      const fresh = stamps.filter((t) => t > cutoff);
      if (fresh.length === 0) buckets.delete(k);
      else buckets.set(k, fresh);
    }
  }

  const existing = (buckets.get(config.key) || []).filter((t) => t > cutoff);
  if (existing.length >= config.maxRequests) {
    const oldest = existing[0] ?? now;
    const resetAtMs = oldest + config.windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
    buckets.set(config.key, existing);
    return {
      allowed: false,
      remaining: 0,
      resetAtMs,
      retryAfterSeconds,
    };
  }

  existing.push(now);
  buckets.set(config.key, existing);
  return {
    allowed: true,
    remaining: Math.max(0, config.maxRequests - existing.length),
    resetAtMs: (existing[0] ?? now) + config.windowMs,
    retryAfterSeconds: 0,
  };
}

export function enforceRateLimit(config: RateLimitConfig): RateLimitResult {
  const res = checkRateLimit(config);
  if (!res.allowed) {
    throw new AppError(
      429,
      'RATE_LIMITED',
      `Rate limit exceeded. Retry after ${res.retryAfterSeconds} second(s).`,
    );
  }
  return res;
}

export function resetRateLimitBucketsForTests(): void {
  buckets.clear();
}

export function assertRequestPayloadSize(contentLengthHeader: string | null, maxBytes: number): void {
  if (!contentLengthHeader) return;
  const parsed = Number(contentLengthHeader);
  if (Number.isFinite(parsed) && parsed > maxBytes) {
    throw new AppError(
      413,
      'PAYLOAD_TOO_LARGE',
      `Request body exceeds maximum permitted size of ${Math.round(maxBytes / 1024)} KB.`,
    );
  }
}

/**
 * Ensures post-auth / UI redirects strictly target internal relative paths
 * and never allow open redirects (`//evil.com`, `https://evil.com`, `javascript:`).
 */
export function sanitizeInternalRedirect(target: string | null | undefined, fallback = '/dashboard'): string {
  if (!target) return fallback;
  const trimmed = target.trim();
  if (!trimmed.startsWith('/')) return fallback;
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return fallback;
  if (/[\r\n\0]/.test(trimmed)) return fallback;
  return trimmed;
}
