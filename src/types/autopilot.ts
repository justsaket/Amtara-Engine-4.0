import type { ContentFormat, SocialPlatformId } from './domain';

export type AutopilotSchemaVersion = '5.1.0';

export type AutopilotExecutionMode =
  | 'DRAFT_ONLY'
  | 'APPROVAL_REQUIRED'
  | 'AUTOMATIC_PUBLISHING';

export type AutopilotPolicyStatus =
  | 'active'
  | 'paused'
  | 'paused_auth_expired'
  | 'paused_policy_violation'
  | 'paused_cost_limit';

export type AutopilotOrderingMode = 'chronological' | 'priority_first';

export type AutopilotHashtagStrategy = 'focused' | 'balanced' | 'discovery';

export interface AutopilotTimeWindow {
  /** 0..23 in policy timezone */
  startHour: number;
  /** 0..59 */
  startMinute: number;
  /** 0..23 in policy timezone */
  endHour: number;
  /** 0..59 */
  endMinute: number;
}

export interface AutopilotPolicy {
  id: string;
  schemaVersion: AutopilotSchemaVersion;
  workspaceId: string;
  brandId: string;
  name: string;
  googleConnectionId: string;
  sourceFolderId: string;
  sourceFolderName: string;
  includeSubfolders: boolean;
  maxSubfolderDepth: number;
  destinationAccountIds: string[];
  allowedFormats: ContentFormat[];
  /** Maximum posts published per day per policy (a cap, never a forced promise if no eligible videos exist). */
  maxPostsPerDay: number;
  /** Minimum spacing in minutes between consecutive scheduled posts. */
  minGapMinutes: number;
  /** Allowed days of week in policy timezone (0 = Sun .. 6 = Sat). */
  publishingDays: number[];
  /** Allowed local time windows in policy timezone. */
  dailyTimeWindows: AutopilotTimeWindow[];
  timezone: string;
  orderingMode: AutopilotOrderingMode;
  language: string;
  captionStyle: string;
  hashtagStrategy: AutopilotHashtagStrategy;
  maxHashtags: number;
  /** Strictly separated authorization mode; paid advertising is NEVER auto-enabled. */
  executionMode: AutopilotExecutionMode;
  /** Explicit per-destination account authorization for automatic publishing. */
  authorizedAutoPublishAccountIds: string[];
  duplicatePrevention: {
    byDriveFileId: boolean;
    byContentHash: boolean;
    allowExplicitReprocess: boolean;
  };
  maxProcessingCostUsdPerDay: number;
  failurePolicy: {
    maxRetries: number;
    pauseOnAuthExpired: boolean;
    pauseOnPolicyViolation: boolean;
    pauseOnCostExceeded: boolean;
  };
  status: AutopilotPolicyStatus;
  pauseReason?: string;
  driveChangePageToken?: string;
  watchChannelId?: string;
  watchResourceId?: string;
  watchExpiresAt?: string;
  lastScanAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export type AutopilotFileStatus =
  | 'discovered'
  | 'duplicate_skipped'
  | 'unsupported'
  | 'inaccessible'
  | 'deleted'
  | 'analyzing'
  | 'analyzed'
  | 'awaiting_approval'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'publish_status_unknown'
  | 'failed'
  | 'skipped_by_user';

export interface AutopilotVideoTechnicalMetadata {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  fps: number | null;
  codec: string | null;
  hasAudio: boolean | null;
  orientation: 'vertical' | 'horizontal' | 'square' | 'unknown';
}

export interface AutopilotRepresentativeFrame {
  timestampSeconds: number;
  sceneType: string;
  description: string;
}

export interface AutopilotPlatformFormatIssue {
  platform: SocialPlatformId;
  severity: 'warning' | 'error';
  code: string;
  message: string;
}

export interface AutopilotVideoAnalysis {
  analyzedAt: string;
  provider: string;
  model: string;
  sourceMethod: 'multimodal_video_bytes' | 'extracted_frames_and_audio' | 'test_multimodal_fixture';
  representativeFrames: AutopilotRepresentativeFrame[];
  visualScenesSummary: string;
  transcript: string;
  detectedLanguage: string;
  subject: string;
  context: string;
  centralMessage: string;
  misleadingOrUnsupportedClaims: string[];
  sensitiveOrUnsuitableFlags: string[];
  platformFormatIssues: AutopilotPlatformFormatIssue[];
  safeToPublish: boolean;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

export interface AutopilotGeneratedMetadata {
  contentTitle: string;
  openingHook: string;
  instagramCaption: string;
  youtubeTitle: string;
  youtubeDescription: string;
  hashtags: string[];
  keywords: string[];
  cta: string;
  shortDescription: string;
  suggestedThumbnailText: string;
  platformMetadata: {
    instagram?: { shareToFeed: boolean; altText: string };
    youtube?: {
      categoryId: string;
      tags: string[];
      privacyStatus: 'public' | 'unlisted' | 'private';
      isShort: boolean;
    };
    facebook?: { description: string };
    linkedin?: { commentary: string };
    tiktok?: { title: string; privacyLevel: 'PUBLIC_TO_EVERYONE' | 'SELF_ONLY' };
  };
  brandFactRefsUsed: string[];
  editedByUser: boolean;
  editedAt?: string;
  metadataFingerprint: string;
}

export interface AutopilotDriveFileRecord {
  id: string;
  schemaVersion: AutopilotSchemaVersion;
  workspaceId: string;
  policyId: string;
  brandId: string;
  driveFileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  md5Checksum?: string;
  contentSha256?: string;
  driveModifiedTime: string;
  driveCreatedTime?: string;
  parentFolderId: string;
  folderPath: string;
  webViewLink?: string;
  trashed: boolean;
  permissionsReadable: boolean;
  priority: number;
  status: AutopilotFileStatus;
  duplicateOfFileId?: string;
  videoMetadata: AutopilotVideoTechnicalMetadata;
  analysis: AutopilotVideoAnalysis | null;
  generatedMetadata: AutopilotGeneratedMetadata | null;
  contentItemId?: string;
  approvalRequestId?: string;
  scheduledJobIds: string[];
  payloadHash?: string;
  approvedPayloadHash?: string;
  estimatedProcessingCostUsd: number | null;
  actualProcessingCostUsd: number | null;
  reprocessRequestedAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  discoveredAt: string;
  updatedAt: string;
}

export type AutopilotJobStage = 'analyze_and_generate' | 'publish';

export type AutopilotJobStatus =
  | 'queued'
  | 'awaiting_approval'
  | 'scheduled'
  | 'claimed'
  | 'running'
  | 'published'
  | 'publish_status_unknown'
  | 'failed'
  | 'dead_letter'
  | 'paused'
  | 'cancelled';

export interface AutopilotJobRecord {
  id: string;
  schemaVersion: AutopilotSchemaVersion;
  workspaceId: string;
  policyId: string;
  brandId: string;
  fileRecordId: string;
  driveFileId: string;
  accountId: string;
  platform: SocialPlatformId;
  format: ContentFormat;
  stage: AutopilotJobStage;
  status: AutopilotJobStatus;
  scheduledForUtc: string;
  timezone: string;
  priority: number;
  idempotencyKey: string;
  payloadHash: string;
  approvalRequestId?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAtUtc?: string;
  externalPostId?: string;
  externalPostUrl?: string;
  providerContainerId?: string;
  reconciliationRequired: boolean;
  isLiveProviderVerification?: boolean;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutopilotExecutionEvent {
  id: string;
  schemaVersion: AutopilotSchemaVersion;
  workspaceId: string;
  policyId: string;
  fileRecordId?: string;
  jobId?: string;
  eventType:
    | 'policy_created'
    | 'policy_updated'
    | 'policy_paused'
    | 'policy_resumed'
    | 'policy_removed'
    | 'drive_scan_completed'
    | 'drive_webhook_received'
    | 'file_discovered'
    | 'file_duplicate_skipped'
    | 'file_modified'
    | 'file_moved'
    | 'file_deleted'
    | 'file_skipped_by_user'
    | 'video_analyzed'
    | 'metadata_generated'
    | 'metadata_edited'
    | 'approval_requested'
    | 'approval_granted'
    | 'job_scheduled'
    | 'job_slots_recalculated'
    | 'job_lease_recovered'
    | 'job_published'
    | 'job_publish_unknown'
    | 'job_retry_scheduled'
    | 'job_failed'
    | 'auth_expired_paused'
    | 'policy_violation_paused';
  status: 'ok' | 'warning' | 'error';
  summary: string;
  detailJson?: string;
  actorUid: string;
  createdAt: string;
}

export interface AutopilotDashboardCounts {
  totalDiscovered: number;
  newVideos: number;
  processedVideos: number;
  awaitingApproval: number;
  scheduledVideos: number;
  publishedVideos: number;
  failedVideos: number;
  skippedOrDuplicateVideos: number;
  dailyPostingLimit: number;
  actualPublishedToday: number;
  nextScheduledPostUtc: string | null;
  nextScheduledPostLocal: string | null;
  nextScheduledFileName: string | null;
  estimatedProcessingCostUsd: number;
  actualProcessingCostUsd: number | null;
}

export interface DriveFolderItem {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
  parents?: string[];
  canListChildren: boolean;
}
