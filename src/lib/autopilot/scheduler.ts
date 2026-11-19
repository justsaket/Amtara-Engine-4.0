import crypto from 'node:crypto';
import type { ConnectedSocialAccount, ContentFormat, SocialPlatformId } from '@/types/domain';
import type {
  AutopilotDriveFileRecord,
  AutopilotJobRecord,
  AutopilotPolicy,
  AutopilotPolicyStatus,
} from '@/types/autopilot';

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  weekday: number; // 0 = Sun .. 6 = Sat
  hour: number;
  minute: number;
  second: number;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getZonedParts(date: Date, timezone: string): ZonedParts {
  const safeTz = timezone || 'Asia/Kolkata';
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: safeTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const rawHour = Number(map.hour || '0');
  return {
    year: Number(map.year || '1970'),
    month: Number(map.month || '1'),
    day: Number(map.day || '1'),
    weekday: WEEKDAY_MAP[map.weekday || 'Sun'] ?? 0,
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(map.minute || '0'),
    second: Number(map.second || '0'),
  };
}

export function getLocalDateKey(isoUtc: string, timezone: string): string {
  const p = getZonedParts(new Date(isoUtc), timezone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function formatLocalSlot(isoUtc: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: timezone || 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(isoUtc));
  } catch {
    return new Date(isoUtc).toISOString();
  }
}

/**
 * Converts a wall-clock time (year, month, day, hour, minute) in an IANA timezone to a UTC Date.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  // Initial guess in UTC
  const guessMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  // Compute offset by comparing wall-clock parts at guessMs vs desired wall clock
  const zonedAtGuess = getZonedParts(new Date(guessMs), timezone);
  const zonedWallAsUtc = Date.UTC(
    zonedAtGuess.year,
    zonedAtGuess.month - 1,
    zonedAtGuess.day,
    zonedAtGuess.hour,
    zonedAtGuess.minute,
    0,
    0,
  );
  const offsetMs = zonedWallAsUtc - guessMs;
  const correctedMs = guessMs - offsetMs;
  // Second pass handles DST boundaries accurately
  const zonedSecond = getZonedParts(new Date(correctedMs), timezone);
  const zonedSecondAsUtc = Date.UTC(
    zonedSecond.year,
    zonedSecond.month - 1,
    zonedSecond.day,
    zonedSecond.hour,
    zonedSecond.minute,
    0,
    0,
  );
  const secondOffsetMs = zonedSecondAsUtc - correctedMs;
  return new Date(guessMs - secondOffsetMs);
}

/**
 * Computes the next `count` eligible publishing slots in UTC honoring:
 * - workspace timezone
 * - policy.publishingDays
 * - policy.dailyTimeWindows
 * - policy.maxPostsPerDay (strict cap per local date — never forced when count === 0)
 * - policy.minGapMinutes (spacing between consecutive posts across existing & newly planned slots)
 */
export function computeNextEligibleSlots(params: {
  policy: AutopilotPolicy;
  fromIsoUtc: string;
  count: number;
  existingScheduledUtc?: string[];
  maxLookaheadDays?: number;
}): string[] {
  if (params.count <= 0) return [];
  const { policy } = params;
  const timezone = policy.timezone || 'Asia/Kolkata';
  const maxPostsPerDay = Math.max(1, policy.maxPostsPerDay);
  const minGapMs = Math.max(1, policy.minGapMinutes) * 60_000;
  const lookaheadDays = Math.min(Math.max(params.maxLookaheadDays ?? 60, 1), 120);

  const allowedDays = new Set(policy.publishingDays.length > 0 ? policy.publishingDays : [0, 1, 2, 3, 4, 5, 6]);
  const windows = (
    policy.dailyTimeWindows.length > 0
      ? [...policy.dailyTimeWindows]
      : [{ startHour: 10, startMinute: 0, endHour: 20, endMinute: 0 }]
  ).sort((a, b) => a.startHour * 60 + a.startMinute - (b.startHour * 60 + b.startMinute));

  const occupiedMs: number[] = [];
  const countByLocalDate = new Map<string, number>();

  for (const iso of params.existingScheduledUtc || []) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) continue;
    occupiedMs.push(ms);
    const dateKey = getLocalDateKey(iso, timezone);
    countByLocalDate.set(dateKey, (countByLocalDate.get(dateKey) || 0) + 1);
  }

  const fromMs = Date.parse(params.fromIsoUtc);
  const startParts = getZonedParts(new Date(fromMs), timezone);
  const plannedSlots: string[] = [];

  for (let dayOffset = 0; dayOffset < lookaheadDays && plannedSlots.length < params.count; dayOffset++) {
    // Advance calendar day cleanly in UTC reference then project into timezone
    const refUtc = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day + dayOffset, 12, 0, 0));
    const dayParts = getZonedParts(refUtc, timezone);
    if (!allowedDays.has(dayParts.weekday)) continue;

    const dateKey = `${String(dayParts.year).padStart(4, '0')}-${String(dayParts.month).padStart(2, '0')}-${String(dayParts.day).padStart(2, '0')}`;
    let scheduledOnThisDay = countByLocalDate.get(dateKey) || 0;
    if (scheduledOnThisDay >= maxPostsPerDay) continue;

    for (const win of windows) {
      if (scheduledOnThisDay >= maxPostsPerDay || plannedSlots.length >= params.count) break;
      const winStartMs = zonedWallTimeToUtc(
        dayParts.year,
        dayParts.month,
        dayParts.day,
        win.startHour,
        win.startMinute,
        timezone,
      ).getTime();
      const winEndMs = zonedWallTimeToUtc(
        dayParts.year,
        dayParts.month,
        dayParts.day,
        win.endHour,
        win.endMinute,
        timezone,
      ).getTime();

      let candidateMs = Math.max(winStartMs, fromMs);
      // Round up to next minute boundary
      if (candidateMs % 60_000 !== 0) {
        candidateMs = Math.ceil(candidateMs / 60_000) * 60_000;
      }

      while (
        candidateMs <= winEndMs &&
        scheduledOnThisDay < maxPostsPerDay &&
        plannedSlots.length < params.count
      ) {
        const conflict = occupiedMs.find((occ) => Math.abs(occ - candidateMs) < minGapMs);
        if (conflict !== undefined) {
          candidateMs = Math.max(candidateMs + 60_000, conflict + minGapMs);
          continue;
        }
        const slotIso = new Date(candidateMs).toISOString();
        plannedSlots.push(slotIso);
        occupiedMs.push(candidateMs);
        scheduledOnThisDay += 1;
        countByLocalDate.set(dateKey, scheduledOnThisDay);
        candidateMs += minGapMs;
      }
    }
  }

  return plannedSlots;
}

export function resolveVideoFormatForPlatform(
  platform: SocialPlatformId,
  file: AutopilotDriveFileRecord,
  allowedFormats: ContentFormat[],
): ContentFormat {
  const isVerticalShort =
    file.videoMetadata.orientation === 'vertical' &&
    (file.videoMetadata.durationSeconds === null || file.videoMetadata.durationSeconds <= 90);

  if (platform === 'instagram') {
    return allowedFormats.includes('reel') ? 'reel' : 'short_video';
  }
  if (platform === 'youtube') {
    if (isVerticalShort && allowedFormats.includes('youtube_short')) return 'youtube_short';
    return allowedFormats.includes('youtube_video') ? 'youtube_video' : 'youtube_short';
  }
  if (platform === 'tiktok') {
    return allowedFormats.includes('short_video') ? 'short_video' : 'reel';
  }
  return allowedFormats.includes('short_video') ? 'short_video' : allowedFormats[0] || 'short_video';
}

/**
 * Selects eligible analyzed videos and schedules durable publishing jobs
 * without duplicate scheduling, simultaneous conflicts, or exceeding daily caps.
 */
export function planAutopilotScheduleBatch(params: {
  policy: AutopilotPolicy;
  files: AutopilotDriveFileRecord[];
  destinationAccounts: ConnectedSocialAccount[];
  existingJobs: AutopilotJobRecord[];
  nowIso?: string;
}): {
  newJobs: AutopilotJobRecord[];
  updatedFiles: AutopilotDriveFileRecord[];
} {
  const nowIso = params.nowIso || new Date().toISOString();
  const { policy } = params;

  if (policy.status !== 'active' || policy.executionMode === 'DRAFT_ONLY') {
    return { newJobs: [], updatedFiles: [] };
  }

  const targetAccounts = params.destinationAccounts.filter(
    (acc) =>
      policy.destinationAccountIds.includes(acc.id) &&
      acc.provider !== 'canva' &&
      acc.provider !== 'meta_ads',
  );
  if (targetAccounts.length === 0) {
    return { newJobs: [], updatedFiles: [] };
  }

  // Track active/completed jobs per (driveFileId, accountId) to prevent duplicate scheduling
  const existingPairKeys = new Set<string>();
  const activeSlotIsos: string[] = [];

  for (const job of params.existingJobs) {
    if (job.policyId !== policy.id) continue;
    if (job.status !== 'cancelled' && job.status !== 'failed' && job.status !== 'dead_letter') {
      existingPairKeys.add(`${job.driveFileId}:${job.accountId}`);
      activeSlotIsos.push(job.scheduledForUtc);
    }
  }

  // Select eligible videos that have been analyzed + metadata generated + safeToPublish
  const eligibleFiles = params.files.filter(
    (f) =>
      f.policyId === policy.id &&
      (f.status === 'analyzed' || f.status === 'awaiting_approval') &&
      f.analysis !== null &&
      f.generatedMetadata !== null &&
      f.analysis.safeToPublish,
  );

  if (eligibleFiles.length === 0) {
    return { newJobs: [], updatedFiles: [] };
  }

  // Sort strictly according to policy ordering mode
  const orderedFiles = [...eligibleFiles].sort((a, b) => {
    if (policy.orderingMode === 'priority_first' && b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    const timeA = Date.parse(a.driveCreatedTime || a.discoveredAt);
    const timeB = Date.parse(b.driveCreatedTime || b.discoveredAt);
    if (timeA !== timeB) return timeA - timeB;
    return a.driveFileId.localeCompare(b.driveFileId);
  });

  // Determine how many unique video-slots we need (each video publishes across its destination accounts at its assigned slot)
  const filesNeedingJobs = orderedFiles.filter((file) =>
    targetAccounts.some((acc) => !existingPairKeys.has(`${file.driveFileId}:${acc.id}`)),
  );
  if (filesNeedingJobs.length === 0) {
    return { newJobs: [], updatedFiles: [] };
  }

  const slots = computeNextEligibleSlots({
    policy,
    fromIsoUtc: nowIso,
    count: filesNeedingJobs.length,
    existingScheduledUtc: activeSlotIsos,
  });

  const newJobs: AutopilotJobRecord[] = [];
  const updatedFiles: AutopilotDriveFileRecord[] = [];

  for (let idx = 0; idx < filesNeedingJobs.length && idx < slots.length; idx++) {
    const file = filesNeedingJobs[idx];
    const slotUtc = slots[idx];
    const createdJobIds: string[] = [];
    let anyAwaitingApproval = false;
    let anyScheduled = false;

    for (const acc of targetAccounts) {
      const pairKey = `${file.driveFileId}:${acc.id}`;
      if (existingPairKeys.has(pairKey)) continue;

      const platform = acc.provider as SocialPlatformId;
      const format = resolveVideoFormatForPlatform(platform, file, policy.allowedFormats);
      const payloadHash = file.payloadHash || file.generatedMetadata!.metadataFingerprint;
      const isApproved = Boolean(file.approvedPayloadHash && file.approvedPayloadHash === payloadHash);
      const isAutoAuthorizedForAccount =
        policy.executionMode === 'AUTOMATIC_PUBLISHING' &&
        policy.authorizedAutoPublishAccountIds.includes(acc.id);

      const initialStatus: AutopilotJobRecord['status'] =
        isAutoAuthorizedForAccount || isApproved ? 'scheduled' : 'awaiting_approval';

      if (initialStatus === 'awaiting_approval') anyAwaitingApproval = true;
      if (initialStatus === 'scheduled') anyScheduled = true;

      const idempotencyKey = `ap_pub_${crypto
        .createHash('sha256')
        .update(`${policy.id}:${file.driveFileId}:${acc.id}:${payloadHash.slice(0, 12)}`)
        .digest('hex')
        .slice(0, 20)}`;
      const jobId = `apj_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;

      const job: AutopilotJobRecord = {
        id: jobId,
        schemaVersion: '5.1.0',
        workspaceId: policy.workspaceId,
        policyId: policy.id,
        brandId: policy.brandId,
        fileRecordId: file.id,
        driveFileId: file.driveFileId,
        accountId: acc.id,
        platform,
        format,
        stage: 'publish',
        status: initialStatus,
        scheduledForUtc: slotUtc,
        timezone: policy.timezone,
        priority: file.priority,
        idempotencyKey,
        payloadHash,
        approvalRequestId: file.approvalRequestId,
        attemptCount: 0,
        maxAttempts: policy.failurePolicy.maxRetries + 1,
        reconciliationRequired: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      newJobs.push(job);
      createdJobIds.push(jobId);
      existingPairKeys.add(pairKey);
    }

    if (createdJobIds.length > 0) {
      updatedFiles.push({
        ...file,
        status: anyScheduled ? 'scheduled' : anyAwaitingApproval ? 'awaiting_approval' : file.status,
        scheduledJobIds: Array.from(new Set([...file.scheduledJobIds, ...createdJobIds])),
        updatedAt: nowIso,
      });
    }
  }

  return { newJobs, updatedFiles };
}

/**
 * Recalculates future publishing slots after a failure or schedule edit,
 * ensuring queued content is preserved and daily caps / minimum gaps remain honored.
 */
export function recalculateFutureSlotsAfterFailure(params: {
  policy: AutopilotPolicy;
  pendingJobs: AutopilotJobRecord[];
  publishedOrFixedJobs: AutopilotJobRecord[];
  fromIsoUtc: string;
}): AutopilotJobRecord[] {
  if (params.pendingJobs.length === 0) return [];

  const fixedSlots = params.publishedOrFixedJobs
    .filter((j) => j.policyId === params.policy.id && (j.status === 'published' || j.status === 'running' || j.status === 'claimed'))
    .map((j) => j.scheduledForUtc);

  // Group pending jobs by driveFileId so multi-platform jobs for the same video stay aligned on one slot
  const byFile = new Map<string, AutopilotJobRecord[]>();
  const orderedPending = [...params.pendingJobs].sort((a, b) => {
    if (params.policy.orderingMode === 'priority_first' && b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return Date.parse(a.scheduledForUtc) - Date.parse(b.scheduledForUtc);
  });

  for (const job of orderedPending) {
    const list = byFile.get(job.driveFileId) || [];
    list.push(job);
    byFile.set(job.driveFileId, list);
  }

  const fileGroups = Array.from(byFile.values());
  const nextSlots = computeNextEligibleSlots({
    policy: params.policy,
    fromIsoUtc: params.fromIsoUtc,
    count: fileGroups.length,
    existingScheduledUtc: fixedSlots,
  });

  const recalculated: AutopilotJobRecord[] = [];
  for (let i = 0; i < fileGroups.length && i < nextSlots.length; i++) {
    const slot = nextSlots[i];
    for (const job of fileGroups[i]) {
      recalculated.push({
        ...job,
        scheduledForUtc: slot,
        updatedAt: params.fromIsoUtc,
      });
    }
  }

  return recalculated;
}

/**
 * Claims an exclusive lease on a due scheduled job so concurrent cron workers cannot double-execute it.
 */
export function claimAutopilotJobLease(
  job: AutopilotJobRecord,
  workerId: string,
  nowIso: string,
  leaseDurationMs = 120_000,
): { claimed: boolean; job: AutopilotJobRecord; reason?: string } {
  const nowMs = Date.parse(nowIso);
  if (job.status !== 'scheduled') {
    return { claimed: false, job, reason: `Job status is "${job.status}", not "scheduled".` };
  }
  if (Date.parse(job.scheduledForUtc) > nowMs) {
    return { claimed: false, job, reason: 'Scheduled execution time has not arrived yet.' };
  }
  if (job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > nowMs) {
    return { claimed: false, job, reason: `Active lease held by "${job.leaseOwner}".` };
  }

  return {
    claimed: true,
    job: {
      ...job,
      status: 'claimed',
      leaseOwner: workerId,
      leaseExpiresAt: new Date(nowMs + leaseDurationMs).toISOString(),
      updatedAt: nowIso,
    },
  };
}

/**
 * Recovers stale jobs left in `claimed` or `running` after a server crash or restart.
 * If a job was mid-publish with unknown status (`reconciliationRequired`), moves it safely to `publish_status_unknown`
 * instead of blindly re-running it. Otherwise returns it to `scheduled` for durable recovery.
 */
export function recoverStaleAutopilotLeases(
  jobs: AutopilotJobRecord[],
  nowIso: string,
): { recoveredJobs: AutopilotJobRecord[]; unknownStatusJobs: AutopilotJobRecord[] } {
  const nowMs = Date.parse(nowIso);
  const recoveredJobs: AutopilotJobRecord[] = [];
  const unknownStatusJobs: AutopilotJobRecord[] = [];

  for (const job of jobs) {
    if (job.status !== 'claimed' && job.status !== 'running') continue;
    const leaseExpired = !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= nowMs;
    if (!leaseExpired) continue;

    if (job.reconciliationRequired) {
      unknownStatusJobs.push({
        ...job,
        status: 'publish_status_unknown',
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastErrorCode: 'WORKER_CRASH_POST_SUBMIT',
        lastErrorMessage:
          'Worker lease expired after provider submission; reconciliation required before any retry.',
        updatedAt: nowIso,
      });
    } else {
      recoveredJobs.push({
        ...job,
        status: 'scheduled',
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: nowIso,
      });
    }
  }

  return { recoveredJobs, unknownStatusJobs };
}

/**
 * Computes safe retry / dead-letter / policy-auto-pause transition after a publishing error.
 * NEVER blindly retries `PUBLISH_STATUS_UNKNOWN`.
 * Auto-pauses affected policy on authentication expiry or serious policy violation.
 */
export function computeAutopilotRetryOrPauseTransition(params: {
  policy: AutopilotPolicy;
  job: AutopilotJobRecord;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  nowIso: string;
}): {
  updatedJob: AutopilotJobRecord;
  shouldPausePolicy: boolean;
  newPolicyStatus?: AutopilotPolicyStatus;
  policyPauseReason?: string;
} {
  const { policy, job, errorCode, errorMessage, retryable, nowIso } = params;
  const nextAttemptCount = job.attemptCount + 1;

  if (errorCode === 'PUBLISH_STATUS_UNKNOWN') {
    return {
      updatedJob: {
        ...job,
        status: 'publish_status_unknown',
        attemptCount: nextAttemptCount,
        reconciliationRequired: true,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
        updatedAt: nowIso,
      },
      shouldPausePolicy: false,
    };
  }

  const isAuthError =
    errorCode === 'TOKEN_EXPIRED' ||
    errorCode === 'GOOGLE_AUTH_EXPIRED' ||
    errorCode === 'AUTH_EXPIRED' ||
    errorCode === 'ACCOUNT_NOT_CONNECTED';

  if (isAuthError) {
    return {
      updatedJob: {
        ...job,
        status: 'paused',
        attemptCount: nextAttemptCount,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
        updatedAt: nowIso,
      },
      shouldPausePolicy: policy.failurePolicy.pauseOnAuthExpired,
      newPolicyStatus: policy.failurePolicy.pauseOnAuthExpired ? 'paused_auth_expired' : undefined,
      policyPauseReason: `Auto-paused due to expired or revoked credentials (${errorCode}): ${errorMessage}`,
    };
  }

  const isPolicyViolation =
    errorCode === 'POLICY_VIOLATION' ||
    errorCode === 'APP_REVIEW_REQUIRED' ||
    errorCode === 'EMERGENCY_STOP_ACTIVE';

  if (isPolicyViolation) {
    return {
      updatedJob: {
        ...job,
        status: 'paused',
        attemptCount: nextAttemptCount,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
        updatedAt: nowIso,
      },
      shouldPausePolicy: policy.failurePolicy.pauseOnPolicyViolation,
      newPolicyStatus: policy.failurePolicy.pauseOnPolicyViolation ? 'paused_policy_violation' : undefined,
      policyPauseReason: `Auto-paused due to safety/provider policy block (${errorCode}): ${errorMessage}`,
    };
  }

  if (retryable && nextAttemptCount < job.maxAttempts) {
    const backoffMinutes = Math.min(5 * Math.pow(2, nextAttemptCount - 1), 120);
    const nextRetryIso = new Date(Date.parse(nowIso) + backoffMinutes * 60_000).toISOString();
    return {
      updatedJob: {
        ...job,
        status: 'scheduled',
        attemptCount: nextAttemptCount,
        nextRetryAtUtc: nextRetryIso,
        scheduledForUtc: nextRetryIso,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
        updatedAt: nowIso,
      },
      shouldPausePolicy: false,
    };
  }

  return {
    updatedJob: {
      ...job,
      status: nextAttemptCount >= job.maxAttempts ? 'dead_letter' : 'failed',
      attemptCount: nextAttemptCount,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      lastErrorCode: errorCode,
      lastErrorMessage: errorMessage,
      updatedAt: nowIso,
    },
    shouldPausePolicy: false,
  };
}
