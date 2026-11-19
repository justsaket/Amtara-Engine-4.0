import type {
  ApprovalRequestRecord,
  BrandAutonomyPolicy,
  ConnectedSocialAccount,
  ContentFormat,
  MediaAssetRecord,
  SocialPlatformId,
  WorkspaceEmergencyStopState,
} from '@/types/domain';
import type {
  AutopilotDashboardCounts,
  AutopilotDriveFileRecord,
  AutopilotJobRecord,
  AutopilotPolicy,
  AutopilotPolicyStatus,
} from '@/types/autopilot';
import { evaluateActionGateway, type ActionGatewayDecision } from '@/lib/marketing/autonomy-gateway';
import { getSocialPublishingAdapter } from '@/lib/marketing/providers/registry';
import type {
  ProviderPublishResult,
  PublishPayloadInput,
  SocialPublishingAdapter,
} from '@/lib/marketing/providers/types';
import {
  computeAutopilotRetryOrPauseTransition,
  formatLocalSlot,
  getLocalDateKey,
} from './scheduler';

export function buildAutopilotPublishPayload(params: {
  file: AutopilotDriveFileRecord;
  account: ConnectedSocialAccount;
  format: ContentFormat;
  idempotencyKey: string;
  mediaDownloadUrl?: string;
}): PublishPayloadInput {
  const { file, account, format, idempotencyKey } = params;
  const meta = file.generatedMetadata;
  if (!meta) {
    throw new Error(`File "${file.name}" does not have generated metadata ready for publishing.`);
  }

  const platform = account.provider as SocialPlatformId;
  let title = meta.contentTitle;
  let caption = meta.instagramCaption;
  let visibility: PublishPayloadInput['visibility'] = 'public';

  if (platform === 'youtube') {
    title = meta.youtubeTitle || meta.contentTitle;
    caption = meta.youtubeDescription || meta.shortDescription;
    visibility = meta.platformMetadata.youtube?.privacyStatus || 'public';
  } else if (platform === 'facebook') {
    caption = meta.platformMetadata.facebook?.description || meta.instagramCaption;
  } else if (platform === 'linkedin') {
    caption = meta.platformMetadata.linkedin?.commentary || `${meta.openingHook}\n\n${meta.shortDescription}`;
  } else if (platform === 'tiktok') {
    title = meta.platformMetadata.tiktok?.title || meta.contentTitle;
    caption = `${meta.openingHook}\n${meta.hashtags.join(' ')}`.trim();
  }

  const mediaAsset: MediaAssetRecord = {
    id: `ap_media_${file.id}`,
    schemaVersion: '4.0.0',
    workspaceId: file.workspaceId,
    brandId: file.brandId,
    fileName: file.name,
    mimeType: file.mimeType,
    mediaKind: 'video',
    sizeBytes: file.sizeBytes,
    width: file.videoMetadata.width ?? undefined,
    height: file.videoMetadata.height ?? undefined,
    durationSeconds: file.videoMetadata.durationSeconds ?? undefined,
    aspectRatio: file.videoMetadata.aspectRatio ?? undefined,
    sha256: file.contentSha256 || file.md5Checksum || '',
    storagePath: params.mediaDownloadUrl || `gdrive://${file.driveFileId}`,
    source: 'google_drive',
    processingState: 'validated',
    validationErrors: [],
    compatiblePlatforms: [platform],
    createdBy: 'autopilot_engine',
    createdAt: file.discoveredAt,
    updatedAt: file.updatedAt,
  };

  return {
    workspaceId: file.workspaceId,
    brandId: file.brandId,
    contentItemId: file.contentItemId || file.id,
    title,
    caption,
    format,
    hashtags: meta.hashtags,
    mediaAssets: [mediaAsset],
    visibility,
    idempotencyKey,
  };
}

export interface ExecuteAutopilotPublishParams {
  policy: AutopilotPolicy;
  file: AutopilotDriveFileRecord;
  job: AutopilotJobRecord;
  account: ConnectedSocialAccount | null;
  accountAccessToken: string | null;
  approval?: ApprovalRequestRecord | null;
  brandAutonomyPolicy?: BrandAutonomyPolicy | null;
  emergencyStop?: WorkspaceEmergencyStopState | null;
  todayPublishedCount: number;
  alreadyExecutedIdempotencyKeys?: Set<string>;
  /** Strictly for isolated tests — when supplied, `isLiveProviderVerification` is explicitly marked `false`. */
  adapterOverride?: SocialPublishingAdapter;
  fetchImpl?: typeof fetch;
  nowIso?: string;
}

export interface ExecuteAutopilotPublishOutcome {
  outcome: 'published' | 'processing' | 'blocked' | 'retry_scheduled' | 'publish_status_unknown' | 'failed';
  gatewayDecision?: ActionGatewayDecision;
  providerResult?: ProviderPublishResult;
  updatedJob: AutopilotJobRecord;
  updatedFile: AutopilotDriveFileRecord;
  shouldPausePolicy: boolean;
  newPolicyStatus?: AutopilotPolicyStatus;
  policyPauseReason?: string;
  /** Explicitly false whenever an injected mock/test adapter is used — NEVER counts mocks as live provider proof. */
  isLiveProviderVerification: boolean;
}

/**
 * Executes a single Drive Autopilot publishing job through the mandatory Central Action Gateway
 * and verified provider publishing adapter.
 *
 * Guarantees:
 * - Never publishes when policy is paused or in DRAFT_ONLY mode.
 * - Enforces APPROVAL_REQUIRED vs explicit per-account AUTOMATIC_PUBLISHING authorization.
 * - Never touches or enables paid advertising.
 * - Validates media, auth, destination, metadata, and policy immediately before publishing.
 * - Never blindly retries `publish_status_unknown`.
 */
export async function executeAutopilotPublishJob(
  params: ExecuteAutopilotPublishParams,
): Promise<ExecuteAutopilotPublishOutcome> {
  const nowIso = params.nowIso || new Date().toISOString();
  const { policy, file, job, account } = params;
  const isLiveProviderVerification = !params.adapterOverride;

  // 1. Pre-flight policy state check
  if (policy.status !== 'active') {
    const pausedJob: AutopilotJobRecord = {
      ...job,
      status: 'paused',
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      lastErrorCode: 'POLICY_PAUSED',
      lastErrorMessage: `Autopilot policy "${policy.name}" is paused (${policy.status}).`,
      updatedAt: nowIso,
    };
    return {
      outcome: 'blocked',
      updatedJob: pausedJob,
      updatedFile: file,
      shouldPausePolicy: false,
      isLiveProviderVerification,
    };
  }

  // 2. Pre-flight file & metadata integrity check
  if (
    file.trashed ||
    file.status === 'deleted' ||
    file.status === 'skipped_by_user' ||
    file.status === 'unsupported' ||
    !file.analysis ||
    !file.generatedMetadata
  ) {
    const cancelledJob: AutopilotJobRecord = {
      ...job,
      status: 'cancelled',
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      lastErrorCode: 'VIDEO_NOT_ELIGIBLE',
      lastErrorMessage: `Video "${file.name}" is no longer eligible for publishing (status: ${file.status}).`,
      updatedAt: nowIso,
    };
    return {
      outcome: 'blocked',
      updatedJob: cancelledJob,
      updatedFile: file,
      shouldPausePolicy: false,
      isLiveProviderVerification,
    };
  }

  if (!file.analysis.safeToPublish) {
    const blockedJob: AutopilotJobRecord = {
      ...job,
      status: 'paused',
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      lastErrorCode: 'POLICY_VIOLATION',
      lastErrorMessage: 'Video failed safety/brand verification checks and cannot be published automatically.',
      updatedAt: nowIso,
    };
    return {
      outcome: 'blocked',
      updatedJob: blockedJob,
      updatedFile: { ...file, status: 'awaiting_approval', updatedAt: nowIso },
      shouldPausePolicy: policy.failurePolicy.pauseOnPolicyViolation,
      newPolicyStatus: policy.failurePolicy.pauseOnPolicyViolation ? 'paused_policy_violation' : undefined,
      policyPauseReason: `Video "${file.name}" flagged unsafe/policy violation during pre-publish check.`,
      isLiveProviderVerification,
    };
  }

  // 3. Enforce strict mode separation & explicit per-account authorization
  const effectiveBrandAutonomy: BrandAutonomyPolicy = params.brandAutonomyPolicy
    ? {
        ...params.brandAutonomyPolicy,
        // Never escalate beyond the autopilot policy's executionMode, and NEVER enable paid ads
        paidAdsPolicy: 'disabled',
      }
    : {
        id: policy.brandId,
        schemaVersion: '4.0.0',
        workspaceId: policy.workspaceId,
        brandId: policy.brandId,
        publishingMode:
          policy.executionMode === 'AUTOMATIC_PUBLISHING' &&
          account !== null &&
          policy.authorizedAutoPublishAccountIds.includes(account.id)
            ? 'AUTHORIZED_AUTO_PUBLISHING'
            : policy.executionMode === 'DRAFT_ONLY'
              ? 'DRAFT_ONLY'
              : 'APPROVAL_REQUIRED',
        allowedAutoPlatforms:
          account && policy.authorizedAutoPublishAccountIds.includes(account.id)
            ? [job.platform]
            : [],
        allowedAutoFormats: policy.allowedFormats,
        maxAutoPostsPerDay: policy.maxPostsPerDay,
        commentReplyPolicy: 'approval_required',
        dmReplyPolicy: 'approval_required',
        reviewReplyPolicy: 'approval_required',
        leadOutreachPolicy: 'internal_tasks_only',
        paidAdsPolicy: 'disabled',
        requireQualityGatePass: true,
        blockSensitiveTopicsAuto: true,
        paused: false,
        pausedPlatforms: [],
        updatedBy: policy.updatedBy,
        createdAt: policy.createdAt,
        updatedAt: policy.updatedAt,
      };

  // Even if brandAutonomyPolicy is Mode C, enforce Drive Autopilot's own DRAFT_ONLY / APPROVAL_REQUIRED / per-account authorization!
  if (policy.executionMode === 'DRAFT_ONLY') {
    effectiveBrandAutonomy.publishingMode = 'DRAFT_ONLY';
  } else if (policy.executionMode === 'APPROVAL_REQUIRED') {
    effectiveBrandAutonomy.publishingMode = 'APPROVAL_REQUIRED';
  } else if (
    policy.executionMode === 'AUTOMATIC_PUBLISHING' &&
    (!account || !policy.authorizedAutoPublishAccountIds.includes(account.id))
  ) {
    effectiveBrandAutonomy.publishingMode = 'APPROVAL_REQUIRED';
  }

  const adapter = params.adapterOverride || getSocialPublishingAdapter(job.platform);

  // 4. Route through mandatory Central Action Gateway
  const gatewayDecision = evaluateActionGateway({
    workspaceId: policy.workspaceId,
    brandId: policy.brandId,
    actorUid: 'autopilot_worker',
    actorType: 'scheduler_cron',
    actionType: 'publish_post',
    platform: job.platform,
    contentFormat: job.format,
    payloadHash: job.payloadHash,
    idempotencyKey: job.idempotencyKey,
    account,
    requiredScopes: [...adapter.requiredScopes],
    approval: params.approval || null,
    autonomyPolicy: effectiveBrandAutonomy,
    emergencyStop: params.emergencyStop || null,
    qualityCheck: {
      passed: file.analysis.safeToPublish,
      score: file.analysis.safeToPublish ? 95 : 40,
      checkedAt: nowIso,
      warnings: file.analysis.platformFormatIssues.map((i) => ({
        code: i.code,
        message: i.message,
        severity: i.severity,
      })),
      brandFactsChecked: file.generatedMetadata.brandFactRefsUsed.length,
      prohibitedTermsMatched: [],
      platformLimitViolations: [],
      duplicateRisk: 'none',
    },
    todayAutoPublishCount: params.todayPublishedCount,
    isSensitiveTopic: file.analysis.sensitiveOrUnsuitableFlags.length > 0,
    alreadyExecutedIdempotencyKeys: params.alreadyExecutedIdempotencyKeys,
    nowIso,
  });

  if (!gatewayDecision.allowed) {
    const code = gatewayDecision.code || 'AUTONOMY_POLICY_BLOCKED';
    if (code === 'APPROVAL_REQUIRED' || code === 'APPROVAL_INVALIDATED') {
      return {
        outcome: 'blocked',
        gatewayDecision,
        updatedJob: {
          ...job,
          status: 'awaiting_approval',
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          lastErrorCode: code,
          lastErrorMessage: gatewayDecision.reason,
          updatedAt: nowIso,
        },
        updatedFile: {
          ...file,
          status: 'awaiting_approval',
          lastErrorCode: code,
          lastErrorMessage: gatewayDecision.reason,
          updatedAt: nowIso,
        },
        shouldPausePolicy: false,
        isLiveProviderVerification,
      };
    }

    const transition = computeAutopilotRetryOrPauseTransition({
      policy,
      job,
      errorCode: code,
      errorMessage: gatewayDecision.reason,
      retryable: false,
      nowIso,
    });
    return {
      outcome: 'blocked',
      gatewayDecision,
      updatedJob: transition.updatedJob,
      updatedFile: {
        ...file,
        status: transition.shouldPausePolicy ? 'awaiting_approval' : 'failed',
        lastErrorCode: code,
        lastErrorMessage: gatewayDecision.reason,
        updatedAt: nowIso,
      },
      shouldPausePolicy: transition.shouldPausePolicy,
      newPolicyStatus: transition.newPolicyStatus,
      policyPauseReason: transition.policyPauseReason,
      isLiveProviderVerification,
    };
  }

  // 5. Verify access token & payload immediately before provider call
  if (!account || !params.accountAccessToken) {
    const transition = computeAutopilotRetryOrPauseTransition({
      policy,
      job,
      errorCode: 'TOKEN_EXPIRED',
      errorMessage: `Missing active OAuth access token for ${job.platform} account.`,
      retryable: false,
      nowIso,
    });
    return {
      outcome: 'blocked',
      gatewayDecision,
      updatedJob: transition.updatedJob,
      updatedFile: {
        ...file,
        status: 'failed',
        lastErrorCode: 'TOKEN_EXPIRED',
        lastErrorMessage: transition.updatedJob.lastErrorMessage,
        updatedAt: nowIso,
      },
      shouldPausePolicy: transition.shouldPausePolicy,
      newPolicyStatus: transition.newPolicyStatus,
      policyPauseReason: transition.policyPauseReason,
      isLiveProviderVerification,
    };
  }

  const payload = buildAutopilotPublishPayload({
    file,
    account,
    format: job.format,
    idempotencyKey: job.idempotencyKey,
  });

  const payloadValidation = adapter.validatePayload(account, payload);
  if (!payloadValidation.valid) {
    const errMsg = payloadValidation.errors.join(' ');
    const failedJob: AutopilotJobRecord = {
      ...job,
      status: 'failed',
      attemptCount: job.attemptCount + 1,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      lastErrorCode: payloadValidation.code || 'MEDIA_VALIDATION_FAILED',
      lastErrorMessage: errMsg,
      updatedAt: nowIso,
    };
    return {
      outcome: 'failed',
      gatewayDecision,
      updatedJob: failedJob,
      updatedFile: {
        ...file,
        status: 'failed',
        lastErrorCode: failedJob.lastErrorCode,
        lastErrorMessage: errMsg,
        updatedAt: nowIso,
      },
      shouldPausePolicy: false,
      isLiveProviderVerification,
    };
  }

  // 6. Execute provider publish adapter
  const providerResult = await adapter.publish(
    account,
    params.accountAccessToken,
    payload,
    params.fetchImpl,
  );

  if (providerResult.status === 'published') {
    const publishedJob: AutopilotJobRecord = {
      ...job,
      status: 'published',
      attemptCount: job.attemptCount + 1,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      externalPostId: providerResult.externalPostId,
      externalPostUrl: providerResult.externalPostUrl,
      providerContainerId: providerResult.providerContainerId,
      reconciliationRequired: false,
      isLiveProviderVerification,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      updatedAt: nowIso,
    };
    return {
      outcome: 'published',
      gatewayDecision,
      providerResult,
      updatedJob: publishedJob,
      updatedFile: {
        ...file,
        status: 'published',
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
        updatedAt: nowIso,
      },
      shouldPausePolicy: false,
      isLiveProviderVerification,
    };
  }

  if (providerResult.status === 'processing') {
    const processingJob: AutopilotJobRecord = {
      ...job,
      status: 'running',
      attemptCount: job.attemptCount + 1,
      providerContainerId: providerResult.providerContainerId,
      reconciliationRequired: true,
      isLiveProviderVerification,
      updatedAt: nowIso,
    };
    return {
      outcome: 'processing',
      gatewayDecision,
      providerResult,
      updatedJob: processingJob,
      updatedFile: {
        ...file,
        status: 'publishing',
        updatedAt: nowIso,
      },
      shouldPausePolicy: false,
      isLiveProviderVerification,
    };
  }

  if (providerResult.status === 'publish_status_unknown') {
    const transition = computeAutopilotRetryOrPauseTransition({
      policy,
      job,
      errorCode: 'PUBLISH_STATUS_UNKNOWN',
      errorMessage:
        providerResult.errorMessage ||
        'Provider request timed out after commit; manual or API reconciliation required before any retry.',
      retryable: false,
      nowIso,
    });
    return {
      outcome: 'publish_status_unknown',
      gatewayDecision,
      providerResult,
      updatedJob: {
        ...transition.updatedJob,
        providerContainerId: providerResult.providerContainerId,
        isLiveProviderVerification,
      },
      updatedFile: {
        ...file,
        status: 'publish_status_unknown',
        lastErrorCode: 'PUBLISH_STATUS_UNKNOWN',
        lastErrorMessage: transition.updatedJob.lastErrorMessage,
        updatedAt: nowIso,
      },
      shouldPausePolicy: false,
      isLiveProviderVerification,
    };
  }

  // Provider failed — apply retry backoff / dead-letter / auto-pause rules
  const transition = computeAutopilotRetryOrPauseTransition({
    policy,
    job,
    errorCode: providerResult.errorCode || 'PROVIDER_TEMPORARY_ERROR',
    errorMessage: providerResult.errorMessage || 'Provider publishing error.',
    retryable: Boolean(providerResult.retryable),
    nowIso,
  });

  const retryScheduled = transition.updatedJob.status === 'scheduled';
  return {
    outcome: retryScheduled ? 'retry_scheduled' : 'failed',
    gatewayDecision,
    providerResult,
    updatedJob: {
      ...transition.updatedJob,
      isLiveProviderVerification,
    },
    updatedFile: {
      ...file,
      status: retryScheduled ? 'scheduled' : 'failed',
      lastErrorCode: transition.updatedJob.lastErrorCode,
      lastErrorMessage: transition.updatedJob.lastErrorMessage,
      updatedAt: nowIso,
    },
    shouldPausePolicy: transition.shouldPausePolicy,
    newPolicyStatus: transition.newPolicyStatus,
    policyPauseReason: transition.policyPauseReason,
    isLiveProviderVerification,
  };
}

/**
 * Computes exact, consistent dashboard counts for a single Drive Autopilot policy.
 */
export function buildAutopilotDashboardCounts(params: {
  policy: AutopilotPolicy;
  files: AutopilotDriveFileRecord[];
  jobs: AutopilotJobRecord[];
  nowIso?: string;
}): AutopilotDashboardCounts {
  const nowIso = params.nowIso || new Date().toISOString();
  const { policy } = params;
  const policyFiles = params.files.filter((f) => f.policyId === policy.id);
  const policyJobs = params.jobs.filter((j) => j.policyId === policy.id);

  const todayKey = getLocalDateKey(nowIso, policy.timezone);

  let newVideos = 0;
  let processedVideos = 0;
  let awaitingApproval = 0;
  let scheduledVideos = 0;
  let publishedVideos = 0;
  let failedVideos = 0;
  let skippedOrDuplicateVideos = 0;
  let estimatedCost = 0;
  let actualCostSum = 0;
  let hasActualCost = false;

  for (const f of policyFiles) {
    if (f.status === 'discovered' || f.status === 'analyzing') newVideos += 1;
    if (f.analysis !== null) processedVideos += 1;
    if (f.status === 'awaiting_approval') awaitingApproval += 1;
    if (f.status === 'scheduled' || f.status === 'publishing') scheduledVideos += 1;
    if (f.status === 'published') publishedVideos += 1;
    if (f.status === 'failed' || f.status === 'publish_status_unknown') failedVideos += 1;
    if (
      f.status === 'duplicate_skipped' ||
      f.status === 'skipped_by_user' ||
      f.status === 'unsupported' ||
      f.status === 'inaccessible' ||
      f.status === 'deleted'
    ) {
      skippedOrDuplicateVideos += 1;
    }
    if (typeof f.estimatedProcessingCostUsd === 'number') {
      estimatedCost += f.estimatedProcessingCostUsd;
    }
    if (typeof f.actualProcessingCostUsd === 'number') {
      actualCostSum += f.actualProcessingCostUsd;
      hasActualCost = true;
    }
  }

  const publishedTodayFileIds = new Set<string>();
  for (const j of policyJobs) {
    if (j.status === 'published' && getLocalDateKey(j.updatedAt, policy.timezone) === todayKey) {
      publishedTodayFileIds.add(j.fileRecordId);
    }
  }

  const upcomingScheduledJobs = policyJobs
    .filter((j) => j.status === 'scheduled' || j.status === 'claimed')
    .sort((a, b) => Date.parse(a.scheduledForUtc) - Date.parse(b.scheduledForUtc));

  const nextJob = upcomingScheduledJobs[0] || null;
  const nextFile = nextJob ? policyFiles.find((f) => f.id === nextJob.fileRecordId) || null : null;

  return {
    totalDiscovered: policyFiles.length,
    newVideos,
    processedVideos,
    awaitingApproval,
    scheduledVideos,
    publishedVideos,
    failedVideos,
    skippedOrDuplicateVideos,
    dailyPostingLimit: policy.maxPostsPerDay,
    actualPublishedToday: publishedTodayFileIds.size,
    nextScheduledPostUtc: nextJob ? nextJob.scheduledForUtc : null,
    nextScheduledPostLocal: nextJob ? formatLocalSlot(nextJob.scheduledForUtc, policy.timezone) : null,
    nextScheduledFileName: nextFile ? nextFile.name : null,
    estimatedProcessingCostUsd: Number(estimatedCost.toFixed(6)),
    actualProcessingCostUsd: hasActualCost ? Number(actualCostSum.toFixed(6)) : null,
  };
}
