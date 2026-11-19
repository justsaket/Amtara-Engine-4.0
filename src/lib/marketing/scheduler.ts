import crypto from 'node:crypto';
import type { ScheduledPostRecord } from '@/types/domain';

export const DEFAULT_LEASE_MS = 120_000; // 2 minutes
export const MAX_DISPATCH_BATCH_SIZE = 20;

export function isValidIanaTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function formatUtcInTimezone(utcIso: string, timezone: string): {
  valid: boolean;
  formatted: string;
  timezone: string;
  utcIso: string;
} {
  const safeTz = isValidIanaTimezone(timezone) ? timezone : 'Asia/Kolkata';
  const parsed = new Date(utcIso);
  if (Number.isNaN(parsed.getTime())) {
    return { valid: false, formatted: 'Invalid date', timezone: safeTz, utcIso };
  }
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
  return {
    valid: true,
    formatted: formatter.format(parsed),
    timezone: safeTz,
    utcIso: parsed.toISOString(),
  };
}

export function buildScheduleIdempotencyKey(params: {
  workspaceId: string;
  contentItemId: string;
  platform: string;
  accountId: string;
  scheduledForUtc: string;
}): string {
  const bucketMinute = params.scheduledForUtc.slice(0, 16);
  const raw = `${params.workspaceId}|${params.contentItemId}|${params.platform}|${params.accountId}|${bucketMinute}`;
  return `sch_${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)}`;
}

export function detectDuplicateScheduledPost(
  existingPosts: ScheduledPostRecord[],
  candidate: {
    contentItemId: string;
    platform: string;
    accountId: string;
    scheduledForUtc: string;
    idempotencyKey?: string;
  },
): ScheduledPostRecord | undefined {
  const activeStatuses = new Set(['scheduled', 'claimed', 'publishing', 'processing', 'publish_status_unknown']);
  return existingPosts.find((post) => {
    if (!activeStatuses.has(post.status)) return false;
    if (candidate.idempotencyKey && post.idempotencyKey === candidate.idempotencyKey) return true;
    const sameTarget =
      post.contentItemId === candidate.contentItemId &&
      post.platform === candidate.platform &&
      post.accountId === candidate.accountId;
    if (!sameTarget) return false;
    const diffMs = Math.abs(Date.parse(post.scheduledForUtc) - Date.parse(candidate.scheduledForUtc));
    return diffMs <= 5 * 60 * 1000; // within 5 minutes for same content/platform/account
  });
}

/**
 * Selects eligible due jobs for a bounded Vercel Cron dispatch batch.
 * - Claims `scheduled` jobs whose `scheduledForUtc <= nowIso` (and `nextRetryAtUtc <= nowIso` if retrying)
 * - Recovers `claimed` / `publishing` jobs whose lease expired ONLY if status is not `publish_status_unknown`
 * - NEVER auto-claims `publish_status_unknown` jobs (they require explicit reconciliation first!)
 */
export function selectDueScheduledPosts(
  posts: ScheduledPostRecord[],
  nowIso: string = new Date().toISOString(),
  limit: number = MAX_DISPATCH_BATCH_SIZE,
): {
  dueForExecution: ScheduledPostRecord[];
  recoveredExpiredLeases: ScheduledPostRecord[];
  blockedReconciliationCount: number;
} {
  const nowMs = Date.parse(nowIso);
  const dueForExecution: ScheduledPostRecord[] = [];
  const recoveredExpiredLeases: ScheduledPostRecord[] = [];
  let blockedReconciliationCount = 0;

  const sorted = [...posts].sort((a, b) => a.scheduledForUtc.localeCompare(b.scheduledForUtc));

  for (const post of sorted) {
    if (post.status === 'publish_status_unknown' || post.reconciliationRequired) {
      blockedReconciliationCount += 1;
      continue;
    }

    if (dueForExecution.length >= Math.min(limit, MAX_DISPATCH_BATCH_SIZE)) break;

    if (post.status === 'scheduled') {
      const dueMs = Date.parse(post.scheduledForUtc);
      const retryMs = post.nextRetryAtUtc ? Date.parse(post.nextRetryAtUtc) : 0;
      if (dueMs <= nowMs && retryMs <= nowMs) {
        dueForExecution.push(post);
      }
      continue;
    }

    if (post.status === 'claimed' && post.leaseExpiresAt) {
      if (Date.parse(post.leaseExpiresAt) <= nowMs) {
        recoveredExpiredLeases.push(post);
        dueForExecution.push(post);
      }
    }
  }

  return { dueForExecution, recoveredExpiredLeases, blockedReconciliationCount };
}

export function claimScheduledPostLease(
  post: ScheduledPostRecord,
  workerId: string,
  nowIso: string = new Date().toISOString(),
  leaseMs: number = DEFAULT_LEASE_MS,
): { claimed: boolean; updated?: ScheduledPostRecord; reason?: string } {
  const nowMs = Date.parse(nowIso);
  if (post.status === 'publish_status_unknown' || post.reconciliationRequired) {
    return {
      claimed: false,
      reason: 'Job requires reconciliation check before any retry to avoid duplicate publish.',
    };
  }
  if (post.status === 'claimed' && post.leaseExpiresAt && Date.parse(post.leaseExpiresAt) > nowMs) {
    return {
      claimed: false,
      reason: `Job is already leased by "${post.leaseOwner}" until ${post.leaseExpiresAt}.`,
    };
  }
  if (post.status !== 'scheduled' && post.status !== 'claimed') {
    return {
      claimed: false,
      reason: `Job in status "${post.status}" is not eligible for claim.`,
    };
  }

  const leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
  return {
    claimed: true,
    updated: {
      ...post,
      status: 'claimed',
      leaseOwner: workerId,
      leaseExpiresAt,
      attemptCount: post.attemptCount + 1,
      updatedAt: nowIso,
    },
  };
}

export function computeRetryOrDeadLetterTransition(
  post: ScheduledPostRecord,
  outcome: {
    errorCode: ScheduledPostRecord['lastErrorCode'];
    errorMessage: string;
    retryable: boolean;
    reconciliationRequired?: boolean;
  },
  nowIso: string = new Date().toISOString(),
): ScheduledPostRecord {
  const nowMs = Date.parse(nowIso);

  if (outcome.reconciliationRequired || outcome.errorCode === 'PUBLISH_STATUS_UNKNOWN') {
    return {
      ...post,
      status: 'publish_status_unknown',
      reconciliationRequired: true,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      lastErrorCode: 'PUBLISH_STATUS_UNKNOWN',
      lastErrorMessage: outcome.errorMessage,
      updatedAt: nowIso,
    };
  }

  if (outcome.retryable && post.attemptCount < post.maxAttempts) {
    // Exponential backoff: 2min, 8min, 32min
    const delayMs = Math.min(2 * 60 * 1000 * Math.pow(4, Math.max(0, post.attemptCount - 1)), 60 * 60 * 1000);
    return {
      ...post,
      status: 'scheduled',
      nextRetryAtUtc: new Date(nowMs + delayMs).toISOString(),
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      lastErrorCode: outcome.errorCode,
      lastErrorMessage: outcome.errorMessage,
      updatedAt: nowIso,
    };
  }

  return {
    ...post,
    status: post.attemptCount >= post.maxAttempts ? 'dead_letter' : 'failed',
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    lastErrorCode: outcome.errorCode,
    lastErrorMessage: outcome.errorMessage,
    updatedAt: nowIso,
  };
}

export function cancelScheduledPostsForDisconnectedAccount(
  posts: ScheduledPostRecord[],
  accountId: string,
  nowIso: string = new Date().toISOString(),
): ScheduledPostRecord[] {
  return posts
    .filter((p) => p.accountId === accountId && p.status === 'scheduled')
    .map((p) => ({
      ...p,
      status: 'cancelled' as const,
      lastErrorCode: 'ACCOUNT_NOT_CONNECTED' as const,
      lastErrorMessage: 'Cancelled automatically because the connected destination account was disconnected.',
      updatedAt: nowIso,
    }));
}
