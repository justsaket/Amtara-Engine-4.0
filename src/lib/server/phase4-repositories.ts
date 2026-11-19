import crypto from 'node:crypto';
import type {
  AdCampaignRecord,
  AnalyticsSnapshotRecord,
  ApprovalRequestRecord,
  BrandAutonomyPolicy,
  BrandGrowthObjective,
  BrandKnowledgeFact,
  BrandProfile,
  CampaignBudgetPolicy,
  CanvaExportJobRecord,
  ConnectedSocialAccount,
  ContentFormat,
  CreativeBriefRecord,
  ExternalActionType,
  LeadRecord,
  MarketingActivityItem,
  MarketingContentItem,
  MediaAssetRecord,
  PerformanceExperimentRecord,
  Phase4ProviderId,
  PublishingAttemptRecord,
  ReviewRecord,
  ScheduledPostRecord,
  SocialConversationRecord,
  SocialPlatformId,
  WebhookEventRecord,
  WorkspaceEmergencyStopState,
} from '@/types/domain';
import {
  aggregateAnalyticsSnapshots,
  buildAnalyticsSnapshotDedupeKey,
  evaluateExperimentAndBuildCandidateMemory,
  validateAnalyticsSnapshotInput,
} from '@/lib/marketing/analytics-optimizer';
import {
  createDefaultAutonomyPolicy,
  createDefaultEmergencyStopState,
  evaluateActionGateway,
} from '@/lib/marketing/autonomy-gateway';
import {
  buildBrandCreativeBriefDefaults,
  buildPlatformVariants,
  computeContentPayloadHash,
  doesEditInvalidateApproval,
  evaluateContentQualityGate,
  normalizeHashtags,
} from '@/lib/marketing/content-factory';
import { buildWorkspaceMarketingOverview } from '@/lib/marketing/growth-controller';
import {
  canPerformExternalLeadOutreach,
  classifyReviewFeedback,
  detectSensitiveTopic,
  draftBrandSafeReviewReply,
  validateMessagingWindow,
} from '@/lib/marketing/inbox-reviews-leads';
import {
  buildWorkspaceStoragePath,
  computeSha256Hex,
  findDuplicateMediaAsset,
  validateMediaAsset,
} from '@/lib/marketing/media-pipeline';
import { validateMetaAdCampaignDryRun } from '@/lib/marketing/providers/meta-adapters';
import {
  buildPhase4CapabilityMatrix,
  getSocialPublishingAdapter,
} from '@/lib/marketing/providers/registry';
import type { SocialPublishingAdapter } from '@/lib/marketing/providers/types';
import {
  buildScheduleIdempotencyKey,
  cancelScheduledPostsForDisconnectedAccount,
  claimScheduledPostLease,
  computeRetryOrDeadLetterTransition,
  detectDuplicateScheduledPost,
  isValidIanaTimezone,
  selectDueScheduledPosts,
} from '@/lib/marketing/scheduler';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { decryptStringWithAad, encryptStringWithAad } from './crypto';
import { AppError } from './error-handler';
import {
  createNotificationRecord,
  getStore,
  listBrands,
  makeId,
  recordAuditLog,
  requireWorkspaceAccess,
  toIsoString,
  type DataStore,
  type RepositoryContext,
} from './repositories';
import { listWorkspaceBrandFacts } from './phase3-repositories';

// =============================================================================
// Collection Helpers & Serialization
// =============================================================================

async function recordMarketingActivity(
  store: DataStore,
  workspaceId: string,
  entry: Omit<MarketingActivityItem, 'id' | 'workspaceId' | 'createdAt'>,
): Promise<void> {
  const id = makeId('mact');
  await store.commit([
    {
      path: `workspaces/${workspaceId}/marketingActivities/${id}`,
      data: {
        id,
        workspaceId,
        brandId: entry.brandId || '',
        category: entry.category,
        action: entry.action,
        summary: entry.summary,
        status: entry.status,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        actorUid: entry.actorUid,
      },
      serverTimestampFields: ['createdAt'],
    },
  ]);
}

function parseJsonField<T>(val: unknown, fallback: T): T {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return val as T;
}

// =============================================================================
// 1. Emergency Stop & Brand Autonomy Policies
// =============================================================================

export async function getWorkspaceEmergencyStop(
  store: DataStore,
  workspaceId: string,
): Promise<WorkspaceEmergencyStopState> {
  const raw = await store.getDoc(`workspaces/${workspaceId}/marketingControls/emergency_stop`);
  if (!raw) return createDefaultEmergencyStopState(workspaceId);
  return {
    id: 'emergency_stop',
    schemaVersion: '4.0.0',
    workspaceId,
    globalStopped: Boolean(raw.globalStopped),
    reason: raw.reason ? String(raw.reason) : undefined,
    stoppedByUid: raw.stoppedByUid ? String(raw.stoppedByUid) : undefined,
    stoppedByEmail: raw.stoppedByEmail ? String(raw.stoppedByEmail) : undefined,
    stoppedAt: raw.stoppedAt ? toIsoString(raw.stoppedAt) : undefined,
    pausedBrandIds: Array.isArray(raw.pausedBrandIds) ? raw.pausedBrandIds.map(String) : [],
    pausedPlatforms: Array.isArray(raw.pausedPlatforms)
      ? (raw.pausedPlatforms as SocialPlatformId[])
      : [],
    updatedAt: toIsoString(raw.updatedAt),
  };
}

export async function updateWorkspaceEmergencyStop(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    globalStopped?: boolean;
    reason?: string;
    pausedBrandIds?: string[];
    pausedPlatforms?: SocialPlatformId[];
  },
  ctx: RepositoryContext = {},
): Promise<WorkspaceEmergencyStopState> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'emergency:stop', ctx);
  const prev = await getWorkspaceEmergencyStop(store, workspaceId);
  const now = new Date().toISOString();

  const next: WorkspaceEmergencyStopState = {
    ...prev,
    globalStopped: input.globalStopped !== undefined ? input.globalStopped : prev.globalStopped,
    reason: input.reason !== undefined ? input.reason : prev.reason,
    pausedBrandIds: input.pausedBrandIds !== undefined ? input.pausedBrandIds : prev.pausedBrandIds,
    pausedPlatforms:
      input.pausedPlatforms !== undefined ? input.pausedPlatforms : prev.pausedPlatforms,
    stoppedByUid: input.globalStopped ? uid : prev.stoppedByUid,
    stoppedByEmail: input.globalStopped ? userEmail : prev.stoppedByEmail,
    stoppedAt: input.globalStopped ? now : prev.stoppedAt,
    updatedAt: now,
  };

  await store.commit([
    {
      path: `workspaces/${workspaceId}/marketingControls/emergency_stop`,
      data: {
        id: 'emergency_stop',
        schemaVersion: '4.0.0',
        workspaceId,
        globalStopped: next.globalStopped,
        reason: next.reason || '',
        stoppedByUid: next.stoppedByUid || '',
        stoppedByEmail: next.stoppedByEmail || '',
        stoppedAt: next.stoppedAt || '',
        pausedBrandIds: next.pausedBrandIds,
        pausedPlatforms: next.pausedPlatforms,
      },
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordAuditLog(
    store,
    workspaceId,
    uid,
    userEmail,
    next.globalStopped ? 'marketing.emergency_stop_activated' : 'marketing.emergency_stop_updated',
    'marketing_control',
    'emergency_stop',
    next.globalStopped
      ? `Emergency Stop ACTIVATED: ${next.reason || 'All external publishing paused.'}`
      : `Emergency controls updated (paused brands: ${next.pausedBrandIds.length}, paused platforms: ${next.pausedPlatforms.length}).`,
  );

  await recordMarketingActivity(store, workspaceId, {
    category: 'autonomy',
    action: next.globalStopped ? 'emergency_stop.activated' : 'emergency_stop.updated',
    summary: next.globalStopped
      ? `Global Emergency Stop active${next.reason ? `: ${next.reason}` : ''}`
      : 'Updated workspace pause controls',
    status: next.globalStopped ? 'warning' : 'success',
    resourceType: 'marketing_control',
    resourceId: 'emergency_stop',
    actorUid: uid,
  });

  return next;
}

export async function listBrandAutonomyPolicies(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<BrandAutonomyPolicy[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'autonomyPolicies');
  return docs.map((d) => ({
    id: String(d.id),
    schemaVersion: '4.0.0',
    workspaceId: String(d.workspaceId),
    brandId: String(d.brandId),
    publishingMode: (d.publishingMode as BrandAutonomyPolicy['publishingMode']) || 'APPROVAL_REQUIRED',
    allowedAutoPlatforms: Array.isArray(d.allowedAutoPlatforms)
      ? (d.allowedAutoPlatforms as SocialPlatformId[])
      : [],
    allowedAutoFormats: Array.isArray(d.allowedAutoFormats)
      ? (d.allowedAutoFormats as ContentFormat[])
      : [],
    maxAutoPostsPerDay: Number(d.maxAutoPostsPerDay ?? 2),
    commentReplyPolicy:
      (d.commentReplyPolicy as BrandAutonomyPolicy['commentReplyPolicy']) || 'approval_required',
    dmReplyPolicy: (d.dmReplyPolicy as BrandAutonomyPolicy['dmReplyPolicy']) || 'approval_required',
    reviewReplyPolicy:
      (d.reviewReplyPolicy as BrandAutonomyPolicy['reviewReplyPolicy']) || 'approval_required',
    leadOutreachPolicy:
      (d.leadOutreachPolicy as BrandAutonomyPolicy['leadOutreachPolicy']) || 'internal_tasks_only',
    paidAdsPolicy: (d.paidAdsPolicy as BrandAutonomyPolicy['paidAdsPolicy']) || 'disabled',
    requireQualityGatePass: d.requireQualityGatePass !== false,
    blockSensitiveTopicsAuto: d.blockSensitiveTopicsAuto !== false,
    policyExpiresAt: d.policyExpiresAt ? String(d.policyExpiresAt) : undefined,
    paused: Boolean(d.paused),
    pausedPlatforms: Array.isArray(d.pausedPlatforms)
      ? (d.pausedPlatforms as SocialPlatformId[])
      : [],
    updatedBy: String(d.updatedBy || ''),
    createdAt: toIsoString(d.createdAt),
    updatedAt: toIsoString(d.updatedAt),
  }));
}

export async function upsertBrandAutonomyPolicy(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: Omit<BrandAutonomyPolicy, 'id' | 'schemaVersion' | 'workspaceId' | 'updatedBy' | 'createdAt' | 'updatedAt'>,
  ctx: RepositoryContext = {},
): Promise<BrandAutonomyPolicy> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'autonomy:manage', ctx);
  const path = `workspaces/${workspaceId}/autonomyPolicies/${input.brandId}`;
  const existing = await store.getDoc(path);

  await store.commit([
    {
      path,
      data: {
        id: input.brandId,
        schemaVersion: '4.0.0',
        workspaceId,
        brandId: input.brandId,
        publishingMode: input.publishingMode,
        allowedAutoPlatforms: input.allowedAutoPlatforms,
        allowedAutoFormats: input.allowedAutoFormats,
        maxAutoPostsPerDay: input.maxAutoPostsPerDay,
        commentReplyPolicy: input.commentReplyPolicy,
        dmReplyPolicy: input.dmReplyPolicy,
        reviewReplyPolicy: input.reviewReplyPolicy,
        leadOutreachPolicy: input.leadOutreachPolicy,
        paidAdsPolicy: input.paidAdsPolicy,
        requireQualityGatePass: input.requireQualityGatePass,
        blockSensitiveTopicsAuto: input.blockSensitiveTopicsAuto,
        policyExpiresAt: input.policyExpiresAt || '',
        paused: input.paused,
        pausedPlatforms: input.pausedPlatforms,
        updatedBy: uid,
      },
      serverTimestampFields: existing ? ['updatedAt'] : ['createdAt', 'updatedAt'],
      ...(existing ? { updateMask: [
        'publishingMode', 'allowedAutoPlatforms', 'allowedAutoFormats', 'maxAutoPostsPerDay',
        'commentReplyPolicy', 'dmReplyPolicy', 'reviewReplyPolicy', 'leadOutreachPolicy',
        'paidAdsPolicy', 'requireQualityGatePass', 'blockSensitiveTopicsAuto', 'policyExpiresAt',
        'paused', 'pausedPlatforms', 'updatedBy', 'updatedAt',
      ] } : {}),
    },
  ]);

  await recordAuditLog(
    store,
    workspaceId,
    uid,
    userEmail,
    'autonomy.policy_updated',
    'autonomy_policy',
    input.brandId,
    `Updated autonomy mode to ${input.publishingMode} for brand ${input.brandId} (max ${input.maxAutoPostsPerDay}/day).`,
  );

  await recordMarketingActivity(store, workspaceId, {
    brandId: input.brandId,
    category: 'autonomy',
    action: 'autonomy.updated',
    summary: `Brand autonomy set to ${input.publishingMode}${input.paused ? ' (PAUSED)' : ''}`,
    status: 'success',
    resourceType: 'autonomy_policy',
    resourceId: input.brandId,
    actorUid: uid,
  });

  const list = await listBrandAutonomyPolicies(uid, workspaceId, ctx);
  return list.find((p) => p.brandId === input.brandId) || createDefaultAutonomyPolicy(workspaceId, input.brandId, uid);
}

// =============================================================================
// 2. Growth Objectives & Marketing Overview
// =============================================================================

export async function listGrowthObjectives(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<BrandGrowthObjective[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'growthObjectives');
  return docs
    .map((d) => ({
      id: String(d.id),
      schemaVersion: '4.0.0' as const,
      workspaceId: String(d.workspaceId),
      brandId: String(d.brandId),
      period: (d.period as BrandGrowthObjective['period']) || 'monthly',
      title: String(d.title),
      targetMetric: String(d.targetMetric),
      targetValue: Number(d.targetValue),
      currentValue: d.currentValue === null || d.currentValue === undefined ? null : Number(d.currentValue),
      unit: String(d.unit || 'count'),
      priority: (d.priority as BrandGrowthObjective['priority']) || 'high',
      status: (d.status as BrandGrowthObjective['status']) || 'active',
      notes: d.notes ? String(d.notes) : undefined,
      createdBy: String(d.createdBy || ''),
      createdAt: toIsoString(d.createdAt),
      updatedAt: toIsoString(d.updatedAt),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createGrowthObjective(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    brandId: string;
    period: BrandGrowthObjective['period'];
    title: string;
    targetMetric: string;
    targetValue: number;
    currentValue?: number | null;
    unit: string;
    priority: BrandGrowthObjective['priority'];
    notes?: string;
  },
  ctx: RepositoryContext = {},
): Promise<BrandGrowthObjective> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'content:write', ctx);
  const id = makeId('gobj');
  const now = new Date().toISOString();

  await store.commit([
    {
      path: `workspaces/${workspaceId}/growthObjectives/${id}`,
      data: {
        id,
        schemaVersion: '4.0.0',
        workspaceId,
        brandId: input.brandId,
        period: input.period,
        title: input.title,
        targetMetric: input.targetMetric,
        targetValue: input.targetValue,
        currentValue: input.currentValue ?? null,
        unit: input.unit,
        priority: input.priority,
        status: 'active',
        notes: input.notes || '',
        createdBy: uid,
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    },
  ]);

  await recordAuditLog(store, workspaceId, uid, userEmail, 'growth.objective_created', 'growth_objective', id, `Created ${input.period} objective "${input.title}"`);

  return {
    id,
    schemaVersion: '4.0.0',
    workspaceId,
    brandId: input.brandId,
    period: input.period,
    title: input.title,
    targetMetric: input.targetMetric,
    targetValue: input.targetValue,
    currentValue: input.currentValue ?? null,
    unit: input.unit,
    priority: input.priority,
    status: 'active',
    notes: input.notes,
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
}

// =============================================================================
// 3. Connected Social Accounts & Vaulted Tokens
// =============================================================================

export async function listConnectedSocialAccounts(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<ConnectedSocialAccount[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'socialAccounts');
  return docs
    .map((d) => ({
      id: String(d.id),
      schemaVersion: '4.0.0' as const,
      workspaceId: String(d.workspaceId),
      brandId: d.brandId ? String(d.brandId) : undefined,
      provider: d.provider as Phase4ProviderId,
      authMode: d.authMode as ConnectedSocialAccount['authMode'],
      externalAccountId: String(d.externalAccountId),
      displayName: String(d.displayName),
      handle: d.handle ? String(d.handle) : undefined,
      accountType: d.accountType as ConnectedSocialAccount['accountType'],
      status: (d.status as ConnectedSocialAccount['status']) || 'connected',
      readinessState: (d.readinessState as ConnectedSocialAccount['readinessState']) || 'connected',
      gbpAccessState: d.gbpAccessState as ConnectedSocialAccount['gbpAccessState'],
      grantedScopes: Array.isArray(d.grantedScopes) ? d.grantedScopes.map(String) : [],
      capabilities: Array.isArray(d.capabilities) ? d.capabilities.map(String) : [],
      unsupportedCapabilities: Array.isArray(d.unsupportedCapabilities)
        ? d.unsupportedCapabilities.map(String)
        : [],
      encryptedCredentialId: String(d.encryptedCredentialId || ''),
      tokenExpiresAt: d.tokenExpiresAt ? String(d.tokenExpiresAt) : undefined,
      hasRefreshToken: Boolean(d.hasRefreshToken),
      unauditedAppWarning: Boolean(d.unauditedAppWarning),
      lastVerifiedAt: d.lastVerifiedAt ? toIsoString(d.lastVerifiedAt) : undefined,
      lastErrorCode: d.lastErrorCode as ConnectedSocialAccount['lastErrorCode'],
      lastErrorMessage: d.lastErrorMessage ? String(d.lastErrorMessage) : undefined,
      connectedBy: String(d.connectedBy || ''),
      connectedAt: toIsoString(d.connectedAt),
      updatedAt: toIsoString(d.updatedAt),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveConnectedSocialAccount(
  store: DataStore,
  workspaceId: string,
  actorUid: string,
  actorEmail: string,
  accountInput: {
    brandId?: string;
    provider: Phase4ProviderId;
    authMode?: ConnectedSocialAccount['authMode'];
    externalAccountId: string;
    displayName: string;
    handle?: string;
    accountType?: ConnectedSocialAccount['accountType'];
    grantedScopes: string[];
    capabilities: string[];
    unsupportedCapabilities: string[];
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: string;
    unauditedAppWarning?: boolean;
    gbpAccessState?: ConnectedSocialAccount['gbpAccessState'];
  },
): Promise<ConnectedSocialAccount> {
  const accountId = makeId('sacc');
  const credId = makeId('scred');
  const now = new Date().toISOString();

  const encrypted = encryptStringWithAad(
    JSON.stringify({
      accessToken: accountInput.accessToken,
      refreshToken: accountInput.refreshToken || '',
      tokenExpiresAt: accountInput.tokenExpiresAt || '',
    }),
    `workspace:${workspaceId}:social:${accountInput.provider}:${accountId}`,
  );

  await store.commit([
    {
      path: `workspaces/${workspaceId}/encryptedCredentials/${credId}`,
      data: {
        id: credId,
        workspaceId,
        provider: accountInput.provider,
        accountId,
        envelopeJson: encrypted.encryptedPayload,
        updatedBy: actorUid,
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    },
    {
      path: `workspaces/${workspaceId}/socialAccounts/${accountId}`,
      data: {
        id: accountId,
        schemaVersion: '4.0.0',
        workspaceId,
        brandId: accountInput.brandId || '',
        provider: accountInput.provider,
        authMode: accountInput.authMode || 'oauth2_standard',
        externalAccountId: accountInput.externalAccountId,
        displayName: accountInput.displayName,
        handle: accountInput.handle || '',
        accountType: accountInput.accountType || 'business',
        status: 'connected',
        readinessState: 'connected',
        gbpAccessState: accountInput.gbpAccessState || '',
        grantedScopes: accountInput.grantedScopes,
        capabilities: accountInput.capabilities,
        unsupportedCapabilities: accountInput.unsupportedCapabilities,
        encryptedCredentialId: credId,
        tokenExpiresAt: accountInput.tokenExpiresAt || '',
        hasRefreshToken: Boolean(accountInput.refreshToken),
        unauditedAppWarning: Boolean(accountInput.unauditedAppWarning),
        connectedBy: actorUid,
        lastVerifiedAt: now,
      },
      serverTimestampFields: ['connectedAt', 'updatedAt'],
    },
  ]);

  await recordAuditLog(
    store,
    workspaceId,
    actorUid,
    actorEmail,
    'social_account.connected',
    'social_account',
    accountId,
    `Connected ${accountInput.provider} account "${accountInput.displayName}" (${accountInput.grantedScopes.length} scope(s)).`,
  );

  return {
    id: accountId,
    schemaVersion: '4.0.0',
    workspaceId,
    brandId: accountInput.brandId,
    provider: accountInput.provider,
    authMode: accountInput.authMode || 'oauth2_standard',
    externalAccountId: accountInput.externalAccountId,
    displayName: accountInput.displayName,
    handle: accountInput.handle,
    accountType: accountInput.accountType || 'business',
    status: 'connected',
    readinessState: 'connected',
    gbpAccessState: accountInput.gbpAccessState,
    grantedScopes: accountInput.grantedScopes,
    capabilities: accountInput.capabilities,
    unsupportedCapabilities: accountInput.unsupportedCapabilities,
    encryptedCredentialId: credId,
    tokenExpiresAt: accountInput.tokenExpiresAt,
    hasRefreshToken: Boolean(accountInput.refreshToken),
    unauditedAppWarning: Boolean(accountInput.unauditedAppWarning),
    lastVerifiedAt: now,
    connectedBy: actorUid,
    connectedAt: now,
    updatedAt: now,
  };
}

export async function disconnectSocialAccount(
  uid: string,
  userEmail: string,
  workspaceId: string,
  accountId: string,
  ctx: RepositoryContext = {},
): Promise<{ disconnected: boolean; cancelledJobsCount: number }> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'integrations:configure', ctx);
  const accPath = `workspaces/${workspaceId}/socialAccounts/${accountId}`;
  const raw = await store.getDoc(accPath);
  if (!raw) throw new AppError(404, 'ACCOUNT_NOT_FOUND', 'Connected account not found.');

  const scheduled = await listScheduledPosts(uid, workspaceId, ctx);
  const cancelled = cancelScheduledPostsForDisconnectedAccount(scheduled, accountId);

  const ops = [
    {
      path: accPath,
      data: { status: 'disconnected', readinessState: 'disconnected' },
      updateMask: ['status', 'readinessState', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    },
    ...cancelled.map((job) => ({
      path: `workspaces/${workspaceId}/scheduledPosts/${job.id}`,
      data: {
        status: job.status,
        lastErrorCode: job.lastErrorCode || 'ACCOUNT_NOT_CONNECTED',
        lastErrorMessage: job.lastErrorMessage || '',
      },
      updateMask: ['status', 'lastErrorCode', 'lastErrorMessage', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    })),
  ];

  if (raw.encryptedCredentialId) {
    ops.push({
      path: `workspaces/${workspaceId}/encryptedCredentials/${String(raw.encryptedCredentialId)}`,
      delete: true,
    } as never);
  }

  await store.commit(ops);
  await recordAuditLog(
    store,
    workspaceId,
    uid,
    userEmail,
    'social_account.disconnected',
    'social_account',
    accountId,
    `Disconnected ${String(raw.provider)} account "${String(raw.displayName)}" and cancelled ${cancelled.length} pending scheduled post(s).`,
  );

  return { disconnected: true, cancelledJobsCount: cancelled.length };
}

export async function readDecryptedSocialAccessToken(
  store: DataStore,
  workspaceId: string,
  account: ConnectedSocialAccount,
): Promise<string> {
  const credDoc = await store.getDoc(
    `workspaces/${workspaceId}/encryptedCredentials/${account.encryptedCredentialId}`,
  );
  if (!credDoc?.envelopeJson) {
    throw new AppError(401, 'TOKEN_EXPIRED', 'Encrypted credential record missing or revoked.');
  }
  const decrypted = decryptStringWithAad(
    String(credDoc.envelopeJson),
    `workspace:${workspaceId}:social:${account.provider}:${account.id}`,
  );
  const parsed = JSON.parse(decrypted.plaintext) as { accessToken?: string };
  if (!parsed.accessToken) {
    throw new AppError(401, 'TOKEN_EXPIRED', 'Decrypted credential contains no access token.');
  }
  return parsed.accessToken;
}

// =============================================================================
// 4. Media Assets & Creative Briefs / Canva Exports
// =============================================================================

export async function listMediaAssets(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<MediaAssetRecord[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'mediaAssets');
  return docs
    .map((d) => ({
      id: String(d.id),
      schemaVersion: '4.0.0' as const,
      workspaceId: String(d.workspaceId),
      brandId: d.brandId ? String(d.brandId) : undefined,
      contentItemId: d.contentItemId ? String(d.contentItemId) : undefined,
      fileName: String(d.fileName),
      mimeType: String(d.mimeType),
      mediaKind: (d.mediaKind as MediaAssetRecord['mediaKind']) || 'image',
      sizeBytes: Number(d.sizeBytes || 0),
      width: d.width ? Number(d.width) : undefined,
      height: d.height ? Number(d.height) : undefined,
      durationSeconds: d.durationSeconds !== undefined ? Number(d.durationSeconds) : undefined,
      aspectRatio: d.aspectRatio ? String(d.aspectRatio) : undefined,
      sha256: String(d.sha256 || ''),
      storageBucket: d.storageBucket ? String(d.storageBucket) : undefined,
      storagePath: String(d.storagePath || ''),
      publicPreviewUrl: d.publicPreviewUrl ? String(d.publicPreviewUrl) : undefined,
      source: (d.source as MediaAssetRecord['source']) || 'upload',
      processingState: (d.processingState as MediaAssetRecord['processingState']) || 'raw_uploaded',
      validationErrors: Array.isArray(d.validationErrors) ? d.validationErrors.map(String) : [],
      compatiblePlatforms: Array.isArray(d.compatiblePlatforms)
        ? (d.compatiblePlatforms as SocialPlatformId[])
        : [],
      resumableSessionId: d.resumableSessionId ? String(d.resumableSessionId) : undefined,
      createdBy: String(d.createdBy || ''),
      createdAt: toIsoString(d.createdAt),
      updatedAt: toIsoString(d.updatedAt),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function registerMediaAsset(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    brandId?: string;
    contentItemId?: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    width?: number;
    height?: number;
    durationSeconds?: number;
    sha256?: string;
    storagePath?: string;
    source: MediaAssetRecord['source'];
  },
  ctx: RepositoryContext = {},
): Promise<{ asset: MediaAssetRecord; deduplicated: boolean }> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'assets:write', ctx);
  const existing = await listMediaAssets(uid, workspaceId, ctx);
  const sha256 =
    input.sha256 ||
    computeSha256Hex(`${workspaceId}:${input.fileName}:${input.mimeType}:${input.sizeBytes}:${Date.now()}`);

  if (input.sha256) {
    const dup = findDuplicateMediaAsset(existing, input.sha256);
    if (dup) {
      return { asset: dup, deduplicated: true };
    }
  }

  const validation = validateMediaAsset(input);
  const id = makeId('ast');
  const cfg = resolveAutonomousConfiguration();
  const storagePath =
    input.storagePath ||
    buildWorkspaceStoragePath({
      workspaceId,
      brandId: input.brandId,
      assetId: id,
      fileName: input.fileName,
    });
  const resumableSessionId = validation.requiresResumableUpload ? makeId('rsm') : undefined;
  const processingState: MediaAssetRecord['processingState'] = validation.valid
    ? 'validated'
    : 'rejected';

  const now = new Date().toISOString();
  await store.commit([
    {
      path: `workspaces/${workspaceId}/mediaAssets/${id}`,
      data: {
        id,
        schemaVersion: '4.0.0',
        workspaceId,
        brandId: input.brandId || '',
        contentItemId: input.contentItemId || '',
        fileName: input.fileName,
        mimeType: input.mimeType,
        mediaKind: validation.mediaKind,
        sizeBytes: input.sizeBytes,
        width: input.width || 0,
        height: input.height || 0,
        durationSeconds: input.durationSeconds || 0,
        aspectRatio: validation.aspectRatio || '',
        sha256,
        storageBucket: cfg.firebaseClientConfig?.storageBucket || '',
        storagePath,
        source: input.source,
        processingState,
        validationErrors: validation.errors,
        compatiblePlatforms: validation.compatiblePlatforms,
        resumableSessionId: resumableSessionId || '',
        createdBy: uid,
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    },
  ]);

  await recordAuditLog(
    store,
    workspaceId,
    uid,
    userEmail,
    'media_asset.registered',
    'media_asset',
    id,
    `Registered media "${input.fileName}" (${processingState}, ${validation.compatiblePlatforms.length} compatible platform(s)).`,
  );

  return {
    deduplicated: false,
    asset: {
      id,
      schemaVersion: '4.0.0',
      workspaceId,
      brandId: input.brandId,
      contentItemId: input.contentItemId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      mediaKind: validation.mediaKind,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
      durationSeconds: input.durationSeconds,
      aspectRatio: validation.aspectRatio,
      sha256,
      storageBucket: cfg.firebaseClientConfig?.storageBucket,
      storagePath,
      source: input.source,
      processingState,
      validationErrors: validation.errors,
      compatiblePlatforms: validation.compatiblePlatforms,
      resumableSessionId,
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    },
  };
}

export async function listCreativeBriefs(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<{ briefs: CreativeBriefRecord[]; exportJobs: CanvaExportJobRecord[] }> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const [briefDocs, exportDocs] = await Promise.all([
    store.listWorkspaceSubcollection(workspaceId, 'creativeBriefs'),
    store.listWorkspaceSubcollection(workspaceId, 'canvaExportJobs'),
  ]);

  const briefs: CreativeBriefRecord[] = briefDocs
    .map((d) => ({
      id: String(d.id),
      schemaVersion: '4.0.0' as const,
      workspaceId: String(d.workspaceId),
      brandId: String(d.brandId),
      contentItemId: d.contentItemId ? String(d.contentItemId) : undefined,
      title: String(d.title),
      format: (d.format as ContentFormat) || 'single_image',
      targetPlatform: (d.targetPlatform as SocialPlatformId) || 'instagram',
      visualDirection: String(d.visualDirection || ''),
      headlineText: String(d.headlineText || ''),
      supportingCopy: String(d.supportingCopy || ''),
      brandColorHex: String(d.brandColorHex || '#1D4ED8'),
      accentColorHex: d.accentColorHex ? String(d.accentColorHex) : undefined,
      aspectRatio: (d.aspectRatio as CreativeBriefRecord['aspectRatio']) || '4:5',
      mandatoryRules: Array.isArray(d.mandatoryRules) ? d.mandatoryRules.map(String) : [],
      prohibitedClaims: Array.isArray(d.prohibitedClaims) ? d.prohibitedClaims.map(String) : [],
      canvaTemplateId: d.canvaTemplateId ? String(d.canvaTemplateId) : undefined,
      canvaDesignId: d.canvaDesignId ? String(d.canvaDesignId) : undefined,
      canvaEditUrl: d.canvaEditUrl ? String(d.canvaEditUrl) : undefined,
      status: (d.status as CreativeBriefRecord['status']) || 'draft',
      createdBy: String(d.createdBy || ''),
      createdAt: toIsoString(d.createdAt),
      updatedAt: toIsoString(d.updatedAt),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const exportJobs: CanvaExportJobRecord[] = exportDocs
    .map((d) => ({
      id: String(d.id),
      schemaVersion: '4.0.0' as const,
      workspaceId: String(d.workspaceId),
      brandId: d.brandId ? String(d.brandId) : undefined,
      creativeBriefId: d.creativeBriefId ? String(d.creativeBriefId) : undefined,
      canvaDesignId: String(d.canvaDesignId),
      providerJobId: String(d.providerJobId),
      format: (d.format as CanvaExportJobRecord['format']) || 'png',
      status: (d.status as CanvaExportJobRecord['status']) || 'queued',
      exportDownloadUrlExpiresAt: d.exportDownloadUrlExpiresAt
        ? String(d.exportDownloadUrlExpiresAt)
        : undefined,
      persistedAssetId: d.persistedAssetId ? String(d.persistedAssetId) : undefined,
      errorCode: d.errorCode as CanvaExportJobRecord['errorCode'],
      errorMessage: d.errorMessage ? String(d.errorMessage) : undefined,
      createdBy: String(d.createdBy || ''),
      createdAt: toIsoString(d.createdAt),
      updatedAt: toIsoString(d.updatedAt),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { briefs, exportJobs };
}

export async function createCreativeBrief(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    brandId: string;
    contentItemId?: string;
    title: string;
    format: ContentFormat;
    targetPlatform: SocialPlatformId;
    visualDirection: string;
    headlineText: string;
    supportingCopy?: string;
    aspectRatio: CreativeBriefRecord['aspectRatio'];
    canvaTemplateId?: string;
  },
  ctx: RepositoryContext = {},
): Promise<CreativeBriefRecord> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'content:write', ctx);
  const [brands, facts] = await Promise.all([
    listBrands(uid, workspaceId, ctx),
    listWorkspaceBrandFacts(workspaceId, input.brandId, ctx).catch(() => [] as BrandKnowledgeFact[]),
  ]);
  const brand = brands.find((b) => b.id === input.brandId);
  if (!brand) throw new AppError(404, 'BRAND_NOT_FOUND', 'Brand profile not found.');

  const defaults = buildBrandCreativeBriefDefaults(brand, facts);
  const id = makeId('cbrf');
  const now = new Date().toISOString();

  await store.commit([
    {
      path: `workspaces/${workspaceId}/creativeBriefs/${id}`,
      data: {
        id,
        schemaVersion: '4.0.0',
        workspaceId,
        brandId: input.brandId,
        contentItemId: input.contentItemId || '',
        title: input.title,
        format: input.format,
        targetPlatform: input.targetPlatform,
        visualDirection: input.visualDirection,
        headlineText: input.headlineText,
        supportingCopy: input.supportingCopy || '',
        brandColorHex: defaults.brandColorHex,
        accentColorHex: defaults.accentColorHex || '',
        aspectRatio: input.aspectRatio,
        mandatoryRules: defaults.mandatoryRules,
        prohibitedClaims: defaults.prohibitedClaims,
        canvaTemplateId: input.canvaTemplateId || '',
        status: 'draft',
        createdBy: uid,
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    },
  ]);

  await recordMarketingActivity(store, workspaceId, {
    brandId: input.brandId,
    category: 'creative',
    action: 'creative_brief.created',
    summary: `Created brand-safe creative brief "${input.title}" for ${brand.name} (${input.targetPlatform}).`,
    status: 'success',
    resourceType: 'creative_brief',
    resourceId: id,
    actorUid: uid,
  });

  await recordAuditLog(store, workspaceId, uid, userEmail, 'creative_brief.created', 'creative_brief', id, `Created creative brief "${input.title}"`);

  return {
    id,
    schemaVersion: '4.0.0',
    workspaceId,
    brandId: input.brandId,
    contentItemId: input.contentItemId,
    title: input.title,
    format: input.format,
    targetPlatform: input.targetPlatform,
    visualDirection: input.visualDirection,
    headlineText: input.headlineText,
    supportingCopy: input.supportingCopy || '',
    brandColorHex: defaults.brandColorHex,
    accentColorHex: defaults.accentColorHex,
    aspectRatio: input.aspectRatio,
    mandatoryRules: defaults.mandatoryRules,
    prohibitedClaims: defaults.prohibitedClaims,
    canvaTemplateId: input.canvaTemplateId,
    status: 'draft',
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
}

// =============================================================================
// 5. Unified Content Management System (CMS) & Quality Gates
// =============================================================================

function mapContentItem(d: Record<string, unknown>): MarketingContentItem {
  return {
    id: String(d.id),
    schemaVersion: '4.0.0',
    workspaceId: String(d.workspaceId),
    brandId: String(d.brandId),
    title: String(d.title),
    format: (d.format as ContentFormat) || 'text_post',
    status: (d.status as MarketingContentItem['status']) || 'DRAFTED',
    objective: d.objective ? String(d.objective) : undefined,
    campaignTag: d.campaignTag ? String(d.campaignTag) : undefined,
    sourceOpportunityRef: d.sourceOpportunityRef ? String(d.sourceOpportunityRef) : undefined,
    sourcePhase3RunId: d.sourcePhase3RunId ? String(d.sourcePhase3RunId) : undefined,
    hook: d.hook ? String(d.hook) : undefined,
    body: String(d.body || ''),
    cta: d.cta ? String(d.cta) : undefined,
    hashtags: Array.isArray(d.hashtags) ? d.hashtags.map(String) : [],
    targetPlatforms: Array.isArray(d.targetPlatforms)
      ? (d.targetPlatforms as SocialPlatformId[])
      : [],
    variants: parseJsonField(d.variantsJson, []),
    mediaAssetIds: Array.isArray(d.mediaAssetIds) ? d.mediaAssetIds.map(String) : [],
    creativeBriefId: d.creativeBriefId ? String(d.creativeBriefId) : undefined,
    canvaDesignId: d.canvaDesignId ? String(d.canvaDesignId) : undefined,
    currentVersion: Number(d.currentVersion || 1),
    versions: parseJsonField(d.versionsJson, []),
    payloadHash: String(d.payloadHash || ''),
    approvedPayloadHash: d.approvedPayloadHash ? String(d.approvedPayloadHash) : undefined,
    approvalRequestId: d.approvalRequestId ? String(d.approvalRequestId) : undefined,
    qualityCheck: parseJsonField(d.qualityCheckJson, undefined),
    scheduledForUtc: d.scheduledForUtc ? String(d.scheduledForUtc) : undefined,
    scheduledTimezone: d.scheduledTimezone ? String(d.scheduledTimezone) : undefined,
    lastErrorCode: d.lastErrorCode as MarketingContentItem['lastErrorCode'],
    lastErrorMessage: d.lastErrorMessage ? String(d.lastErrorMessage) : undefined,
    createdBy: String(d.createdBy || ''),
    createdAt: toIsoString(d.createdAt),
    updatedAt: toIsoString(d.updatedAt),
  };
}

export async function listMarketingContent(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<MarketingContentItem[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'contentItems');
  return docs.map(mapContentItem).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getMarketingContentById(
  uid: string,
  workspaceId: string,
  contentId: string,
  ctx: RepositoryContext = {},
): Promise<MarketingContentItem> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const doc = await store.getDoc(`workspaces/${workspaceId}/contentItems/${contentId}`);
  if (!doc) throw new AppError(404, 'CONTENT_NOT_FOUND', 'Content item not found.');
  return mapContentItem(doc);
}

export async function createMarketingContent(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    brandId: string;
    title: string;
    format: ContentFormat;
    objective?: string;
    campaignTag?: string;
    hook?: string;
    body: string;
    cta?: string;
    hashtags?: string[];
    targetPlatforms: SocialPlatformId[];
    mediaAssetIds?: string[];
    creativeBriefId?: string;
    sourcePhase3RunId?: string;
  },
  ctx: RepositoryContext = {},
): Promise<MarketingContentItem> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'content:write', ctx);
  const [brands, facts, allAssets, existingItems] = await Promise.all([
    listBrands(uid, workspaceId, ctx),
    listWorkspaceBrandFacts(workspaceId, input.brandId, ctx).catch(() => [] as BrandKnowledgeFact[]),
    listMediaAssets(uid, workspaceId, ctx),
    listMarketingContent(uid, workspaceId, ctx),
  ]);
  const brand = brands.find((b) => b.id === input.brandId);
  if (!brand) throw new AppError(404, 'BRAND_NOT_FOUND', 'Brand profile not found.');

  const id = makeId('cnt');
  const now = new Date().toISOString();
  const hashtags = normalizeHashtags(input.hashtags || []);
  const mediaIds = input.mediaAssetIds || [];
  const attachedAssets = allAssets.filter((a) => mediaIds.includes(a.id));

  const variants = buildPlatformVariants({
    title: input.title,
    hook: input.hook,
    body: input.body,
    cta: input.cta,
    hashtags,
    mediaAssetIds: mediaIds,
    targetPlatforms: input.targetPlatforms,
  });

  const payloadHash = computeContentPayloadHash({
    title: input.title,
    hook: input.hook,
    body: input.body,
    cta: input.cta,
    hashtags,
    mediaAssetIds: mediaIds,
    targetPlatforms: input.targetPlatforms,
  });

  const qualityCheck = evaluateContentQualityGate({
    brand,
    brandFacts: facts,
    title: input.title,
    hook: input.hook,
    body: input.body,
    cta: input.cta,
    hashtags,
    format: input.format,
    targetPlatforms: input.targetPlatforms,
    variants,
    mediaAssets: attachedAssets,
    existingItems,
  });

  const initialStatus: MarketingContentItem['status'] = qualityCheck.passed
    ? 'DRAFTED'
    : 'NEEDS_REVISION';

  const version1 = {
    version: 1,
    title: input.title,
    body: input.body,
    hook: input.hook,
    cta: input.cta,
    mediaAssetIds: mediaIds,
    payloadHash,
    changeNote: 'Initial draft created in Content Factory',
    editedBy: uid,
    editedAt: now,
  };

  await store.commit([
    {
      path: `workspaces/${workspaceId}/contentItems/${id}`,
      data: {
        id,
        schemaVersion: '4.0.0',
        workspaceId,
        brandId: input.brandId,
        title: input.title,
        format: input.format,
        status: initialStatus,
        objective: input.objective || '',
        campaignTag: input.campaignTag || '',
        sourcePhase3RunId: input.sourcePhase3RunId || '',
        hook: input.hook || '',
        body: input.body,
        cta: input.cta || '',
        hashtags,
        targetPlatforms: input.targetPlatforms,
        variantsJson: JSON.stringify(variants),
        mediaAssetIds: mediaIds,
        creativeBriefId: input.creativeBriefId || '',
        currentVersion: 1,
        versionsJson: JSON.stringify([version1]),
        payloadHash,
        qualityCheckJson: JSON.stringify(qualityCheck),
        createdBy: uid,
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    },
  ]);

  await recordMarketingActivity(store, workspaceId, {
    brandId: input.brandId,
    category: 'content',
    action: 'content.created',
    summary: `Created ${input.format} "${input.title}" for ${brand.name} (QA ${qualityCheck.passed ? 'passed' : 'needs revision'}).`,
    status: qualityCheck.passed ? 'success' : 'warning',
    resourceType: 'content_item',
    resourceId: id,
    actorUid: uid,
  });

  await recordAuditLog(store, workspaceId, uid, userEmail, 'content.created', 'content_item', id, `Created content item "${input.title}"`);

  return getMarketingContentById(uid, workspaceId, id, ctx);
}

export async function updateMarketingContent(
  uid: string,
  userEmail: string,
  workspaceId: string,
  contentId: string,
  input: Partial<{
    title: string;
    format: ContentFormat;
    status: MarketingContentItem['status'];
    objective: string;
    campaignTag: string;
    hook: string;
    body: string;
    cta: string;
    hashtags: string[];
    targetPlatforms: SocialPlatformId[];
    mediaAssetIds: string[];
    changeNote: string;
    submitForReview: boolean;
  }>,
  ctx: RepositoryContext = {},
): Promise<{ item: MarketingContentItem; approvalInvalidated: boolean; approvalRequest?: ApprovalRequestRecord }> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'content:write', ctx);
  const existing = await getMarketingContentById(uid, workspaceId, contentId, ctx);
  const [brands, facts, allAssets, allItems] = await Promise.all([
    listBrands(uid, workspaceId, ctx),
    listWorkspaceBrandFacts(workspaceId, existing.brandId, ctx).catch(() => [] as BrandKnowledgeFact[]),
    listMediaAssets(uid, workspaceId, ctx),
    listMarketingContent(uid, workspaceId, ctx),
  ]);
  const brand = brands.find((b) => b.id === existing.brandId);
  if (!brand) throw new AppError(404, 'BRAND_NOT_FOUND', 'Brand profile not found.');

  const nextTitle = input.title ?? existing.title;
  const nextFormat = input.format ?? existing.format;
  const nextHook = input.hook !== undefined ? input.hook : existing.hook;
  const nextBody = input.body ?? existing.body;
  const nextCta = input.cta !== undefined ? input.cta : existing.cta;
  const nextHashtags = input.hashtags ? normalizeHashtags(input.hashtags) : existing.hashtags;
  const nextPlatforms = input.targetPlatforms ?? existing.targetPlatforms;
  const nextMediaIds = input.mediaAssetIds ?? existing.mediaAssetIds;

  const variants = buildPlatformVariants({
    title: nextTitle,
    hook: nextHook,
    body: nextBody,
    cta: nextCta,
    hashtags: nextHashtags,
    mediaAssetIds: nextMediaIds,
    targetPlatforms: nextPlatforms,
    existingVariants: existing.variants,
  });

  const nextPayloadHash = computeContentPayloadHash({
    title: nextTitle,
    hook: nextHook,
    body: nextBody,
    cta: nextCta,
    hashtags: nextHashtags,
    mediaAssetIds: nextMediaIds,
    targetPlatforms: nextPlatforms,
  });

  const qualityCheck = evaluateContentQualityGate({
    brand,
    brandFacts: facts,
    title: nextTitle,
    hook: nextHook,
    body: nextBody,
    cta: nextCta,
    hashtags: nextHashtags,
    format: nextFormat,
    targetPlatforms: nextPlatforms,
    variants,
    mediaAssets: allAssets.filter((a) => nextMediaIds.includes(a.id)),
    existingItems: allItems,
    currentContentId: contentId,
  });

  const approvalInvalidated = doesEditInvalidateApproval(existing, nextPayloadHash);
  const now = new Date().toISOString();
  const nextVersion = existing.currentVersion + (nextPayloadHash !== existing.payloadHash ? 1 : 0);
  const versions =
    nextPayloadHash !== existing.payloadHash
      ? [
          ...existing.versions,
          {
            version: nextVersion,
            title: nextTitle,
            body: nextBody,
            hook: nextHook,
            cta: nextCta,
            mediaAssetIds: nextMediaIds,
            payloadHash: nextPayloadHash,
            changeNote: input.changeNote || 'Updated content item',
            editedBy: uid,
            editedAt: now,
          },
        ]
      : existing.versions;

  let nextStatus: MarketingContentItem['status'] = input.status ?? existing.status;
  if (approvalInvalidated) {
    nextStatus = 'READY_FOR_REVIEW';
  }
  if (input.submitForReview) {
    nextStatus = qualityCheck.passed ? 'READY_FOR_REVIEW' : 'NEEDS_REVISION';
  }

  const ops = [
    {
      path: `workspaces/${workspaceId}/contentItems/${contentId}`,
      data: {
        title: nextTitle,
        format: nextFormat,
        status: nextStatus,
        objective: input.objective ?? existing.objective ?? '',
        campaignTag: input.campaignTag ?? existing.campaignTag ?? '',
        hook: nextHook || '',
        body: nextBody,
        cta: nextCta || '',
        hashtags: nextHashtags,
        targetPlatforms: nextPlatforms,
        variantsJson: JSON.stringify(variants),
        mediaAssetIds: nextMediaIds,
        currentVersion: nextVersion,
        versionsJson: JSON.stringify(versions),
        payloadHash: nextPayloadHash,
        approvedPayloadHash: approvalInvalidated ? '' : existing.approvedPayloadHash || '',
        qualityCheckJson: JSON.stringify(qualityCheck),
      },
      updateMask: [
        'title', 'format', 'status', 'objective', 'campaignTag', 'hook', 'body', 'cta',
        'hashtags', 'targetPlatforms', 'variantsJson', 'mediaAssetIds', 'currentVersion',
        'versionsJson', 'payloadHash', 'approvedPayloadHash', 'qualityCheckJson', 'updatedAt',
      ],
      serverTimestampFields: ['updatedAt'],
    },
  ];

  // If previously approved and edited materially, invalidate the linked approval record
  if (approvalInvalidated && existing.approvalRequestId) {
    ops.push({
      path: `workspaces/${workspaceId}/approvalRequests/${existing.approvalRequestId}`,
      data: { status: 'invalidated', decisionNote: 'Content edited after approval; re-approval required.' },
      updateMask: ['status', 'decisionNote', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    } as never);
  }

  await store.commit(ops);

  let approvalRequest: ApprovalRequestRecord | undefined;
  if (input.submitForReview && qualityCheck.passed) {
    approvalRequest = await createApprovalRequest(
      uid,
      userEmail,
      workspaceId,
      {
        brandId: existing.brandId,
        actionType: 'publish_post',
        targetResourceType: 'content_item',
        targetResourceId: contentId,
        platform: nextPlatforms[0],
        payloadHash: nextPayloadHash,
        summary: `Approve publishing "${nextTitle}" (${nextFormat}) to ${nextPlatforms.join(', ')}`,
        riskLevel: 'medium',
        requestedByType: 'human',
      },
      ctx,
    );
    await store.commit([
      {
        path: `workspaces/${workspaceId}/contentItems/${contentId}`,
        data: { approvalRequestId: approvalRequest.id },
        updateMask: ['approvalRequestId', 'updatedAt'],
        serverTimestampFields: ['updatedAt'],
      },
    ]);
  }

  const updated = await getMarketingContentById(uid, workspaceId, contentId, ctx);
  return { item: updated, approvalInvalidated, approvalRequest };
}

// =============================================================================
// 6. Approval Requests & Decisions
// =============================================================================

export async function listApprovalRequests(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<ApprovalRequestRecord[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'approvalRequests');
  return docs
    .map((d) => ({
      id: String(d.id),
      schemaVersion: '4.0.0' as const,
      workspaceId: String(d.workspaceId),
      brandId: String(d.brandId),
      actionType: d.actionType as ExternalActionType,
      targetResourceType: d.targetResourceType as ApprovalRequestRecord['targetResourceType'],
      targetResourceId: String(d.targetResourceId),
      platform: d.platform ? (d.platform as Phase4ProviderId) : undefined,
      accountId: d.accountId ? String(d.accountId) : undefined,
      payloadHash: String(d.payloadHash),
      summary: String(d.summary),
      riskLevel: (d.riskLevel as ApprovalRequestRecord['riskLevel']) || 'medium',
      estimatedSpendUsd: d.estimatedSpendUsd ? Number(d.estimatedSpendUsd) : undefined,
      status: (d.status as ApprovalRequestRecord['status']) || 'pending',
      requestedByUid: String(d.requestedByUid || ''),
      requestedByType: (d.requestedByType as 'human' | 'ai_agent') || 'human',
      decidedByUid: d.decidedByUid ? String(d.decidedByUid) : undefined,
      decidedByEmail: d.decidedByEmail ? String(d.decidedByEmail) : undefined,
      decisionNote: d.decisionNote ? String(d.decisionNote) : undefined,
      expiresAt: toIsoString(d.expiresAt),
      decidedAt: d.decidedAt ? toIsoString(d.decidedAt) : undefined,
      createdAt: toIsoString(d.createdAt),
      updatedAt: toIsoString(d.updatedAt),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createApprovalRequest(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    brandId: string;
    actionType: ExternalActionType;
    targetResourceType: ApprovalRequestRecord['targetResourceType'];
    targetResourceId: string;
    platform?: Phase4ProviderId;
    accountId?: string;
    payloadHash: string;
    summary: string;
    riskLevel: ApprovalRequestRecord['riskLevel'];
    estimatedSpendUsd?: number;
    requestedByType: 'human' | 'ai_agent';
    ttlHours?: number;
  },
  ctx: RepositoryContext = {},
): Promise<ApprovalRequestRecord> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'content:write', ctx);
  const id = makeId('apr');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlHours ?? 72) * 3600 * 1000).toISOString();

  await store.commit([
    {
      path: `workspaces/${workspaceId}/approvalRequests/${id}`,
      data: {
        id,
        schemaVersion: '4.0.0',
        workspaceId,
        brandId: input.brandId,
        actionType: input.actionType,
        targetResourceType: input.targetResourceType,
        targetResourceId: input.targetResourceId,
        platform: input.platform || '',
        accountId: input.accountId || '',
        payloadHash: input.payloadHash,
        summary: input.summary,
        riskLevel: input.riskLevel,
        estimatedSpendUsd: input.estimatedSpendUsd || 0,
        status: 'pending',
        requestedByUid: uid,
        requestedByType: input.requestedByType,
        expiresAt,
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    },
  ]);

  await createNotificationRecord(store, workspaceId, uid, {
    title: 'Approval Request Created',
    message: input.summary,
    severity: input.riskLevel === 'critical' || input.riskLevel === 'high' ? 'warning' : 'info',
    category: 'approvals',
  });

  await recordAuditLog(store, workspaceId, uid, userEmail, 'approval.requested', 'approval_request', id, input.summary);

  return {
    id,
    schemaVersion: '4.0.0',
    workspaceId,
    brandId: input.brandId,
    actionType: input.actionType,
    targetResourceType: input.targetResourceType,
    targetResourceId: input.targetResourceId,
    platform: input.platform,
    accountId: input.accountId,
    payloadHash: input.payloadHash,
    summary: input.summary,
    riskLevel: input.riskLevel,
    estimatedSpendUsd: input.estimatedSpendUsd,
    status: 'pending',
    requestedByUid: uid,
    requestedByType: input.requestedByType,
    expiresAt,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function decideApprovalRequest(
  uid: string,
  userEmail: string,
  workspaceId: string,
  approvalId: string,
  decision: { action: 'approve' | 'reject' | 'hold' | 'cancel'; note?: string },
  ctx: RepositoryContext = {},
): Promise<ApprovalRequestRecord> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'content:approve', ctx);
  const path = `workspaces/${workspaceId}/approvalRequests/${approvalId}`;
  const raw = await store.getDoc(path);
  if (!raw) throw new AppError(404, 'APPROVAL_NOT_FOUND', 'Approval request not found.');

  const statusMap = {
    approve: 'approved',
    reject: 'rejected',
    hold: 'held',
    cancel: 'cancelled',
  } as const;
  const nextStatus = statusMap[decision.action];
  const now = new Date().toISOString();

  const ops = [
    {
      path,
      data: {
        status: nextStatus,
        decidedByUid: uid,
        decidedByEmail: userEmail,
        decisionNote: decision.note || '',
        decidedAt: now,
      },
      updateMask: ['status', 'decidedByUid', 'decidedByEmail', 'decisionNote', 'decidedAt', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    },
  ];

  // Propagate approval/rejection cleanly to target content item if applicable
  if (raw.targetResourceType === 'content_item' && raw.targetResourceId) {
    const contentPath = `workspaces/${workspaceId}/contentItems/${String(raw.targetResourceId)}`;
    const contentDoc = await store.getDoc(contentPath);
    if (contentDoc) {
      if (nextStatus === 'approved' && String(contentDoc.payloadHash) === String(raw.payloadHash)) {
        ops.push({
          path: contentPath,
          data: { status: 'APPROVED', approvedPayloadHash: String(raw.payloadHash), approvalRequestId: approvalId },
          updateMask: ['status', 'approvedPayloadHash', 'approvalRequestId', 'updatedAt'],
          serverTimestampFields: ['updatedAt'],
        } as never);
      } else if (nextStatus === 'rejected') {
        ops.push({
          path: contentPath,
          data: { status: 'REJECTED' },
          updateMask: ['status', 'updatedAt'],
          serverTimestampFields: ['updatedAt'],
        } as never);
      }
    }
  }

  await store.commit(ops);

  await recordMarketingActivity(store, workspaceId, {
    brandId: String(raw.brandId || ''),
    category: 'approval',
    action: `approval.${nextStatus}`,
    summary: `${userEmail} marked approval "${String(raw.summary)}" as ${nextStatus}.`,
    status: nextStatus === 'approved' ? 'success' : nextStatus === 'rejected' ? 'warning' : 'pending',
    resourceType: 'approval_request',
    resourceId: approvalId,
    actorUid: uid,
  });

  await recordAuditLog(
    store,
    workspaceId,
    uid,
    userEmail,
    `approval.${nextStatus}`,
    'approval_request',
    approvalId,
    `Decision "${nextStatus}" on ${String(raw.summary)}`,
  );

  const list = await listApprovalRequests(uid, workspaceId, ctx);
  return list.find((a) => a.id === approvalId)!;
}

// =============================================================================
// 7. Durable Scheduling & Publishing Engine (Always Through Central Action Gateway)
// =============================================================================

export async function listScheduledPosts(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<ScheduledPostRecord[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'scheduledPosts');
  return docs
    .map((d) => ({
      id: String(d.id),
      schemaVersion: '4.0.0' as const,
      workspaceId: String(d.workspaceId),
      brandId: String(d.brandId),
      contentItemId: String(d.contentItemId),
      platform: d.platform as SocialPlatformId,
      accountId: String(d.accountId),
      scheduledForUtc: String(d.scheduledForUtc),
      timezone: String(d.timezone || 'Asia/Kolkata'),
      status: (d.status as ScheduledPostRecord['status']) || 'scheduled',
      payloadHash: String(d.payloadHash || ''),
      approvalRequestId: d.approvalRequestId ? String(d.approvalRequestId) : undefined,
      idempotencyKey: String(d.idempotencyKey || ''),
      leaseOwner: d.leaseOwner ? String(d.leaseOwner) : undefined,
      leaseExpiresAt: d.leaseExpiresAt ? String(d.leaseExpiresAt) : undefined,
      attemptCount: Number(d.attemptCount || 0),
      maxAttempts: Number(d.maxAttempts || 3),
      nextRetryAtUtc: d.nextRetryAtUtc ? String(d.nextRetryAtUtc) : undefined,
      externalPostId: d.externalPostId ? String(d.externalPostId) : undefined,
      externalPostUrl: d.externalPostUrl ? String(d.externalPostUrl) : undefined,
      reconciliationRequired: Boolean(d.reconciliationRequired),
      lastErrorCode: d.lastErrorCode as ScheduledPostRecord['lastErrorCode'],
      lastErrorMessage: d.lastErrorMessage ? String(d.lastErrorMessage) : undefined,
      createdBy: String(d.createdBy || ''),
      createdAt: toIsoString(d.createdAt),
      updatedAt: toIsoString(d.updatedAt),
    }))
    .sort((a, b) => a.scheduledForUtc.localeCompare(b.scheduledForUtc));
}

export async function listPublishingAttempts(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<PublishingAttemptRecord[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'publishingAttempts');
  return docs
    .map((d) => ({
      id: String(d.id),
      schemaVersion: '4.0.0' as const,
      workspaceId: String(d.workspaceId),
      brandId: String(d.brandId),
      scheduledPostId: d.scheduledPostId ? String(d.scheduledPostId) : undefined,
      contentItemId: String(d.contentItemId),
      platform: d.platform as SocialPlatformId,
      accountId: String(d.accountId),
      attemptNumber: Number(d.attemptNumber || 1),
      status: (d.status as PublishingAttemptRecord['status']) || 'started',
      gatewayDecisionId: String(d.gatewayDecisionId || ''),
      idempotencyKey: String(d.idempotencyKey || ''),
      providerContainerId: d.providerContainerId ? String(d.providerContainerId) : undefined,
      externalPostId: d.externalPostId ? String(d.externalPostId) : undefined,
      externalPostUrl: d.externalPostUrl ? String(d.externalPostUrl) : undefined,
      errorCode: d.errorCode as PublishingAttemptRecord['errorCode'],
      errorMessage: d.errorMessage ? String(d.errorMessage) : undefined,
      httpStatus: d.httpStatus ? Number(d.httpStatus) : undefined,
      retryable: Boolean(d.retryable),
      startedAt: toIsoString(d.startedAt),
      finishedAt: d.finishedAt ? toIsoString(d.finishedAt) : undefined,
    }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function scheduleContentPost(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    brandId: string;
    contentItemId: string;
    platform: SocialPlatformId;
    accountId: string;
    scheduledForUtc: string;
    timezone: string;
    approvalRequestId?: string;
    idempotencyKey?: string;
  },
  ctx: RepositoryContext = {},
): Promise<ScheduledPostRecord> {
  const { store, member } = await requireWorkspaceAccess(uid, workspaceId, 'publishing:schedule', ctx);
  if (!isValidIanaTimezone(input.timezone)) {
    throw new AppError(400, 'INVALID_TIMEZONE', `Invalid IANA timezone "${input.timezone}".`);
  }

  const [content, accounts, existingScheduled, approvals, policies, emergencyStop] = await Promise.all([
    getMarketingContentById(uid, workspaceId, input.contentItemId, ctx),
    listConnectedSocialAccounts(uid, workspaceId, ctx),
    listScheduledPosts(uid, workspaceId, ctx),
    listApprovalRequests(uid, workspaceId, ctx),
    listBrandAutonomyPolicies(uid, workspaceId, ctx),
    getWorkspaceEmergencyStop(store, workspaceId),
  ]);

  const idempotencyKey =
    input.idempotencyKey ||
    buildScheduleIdempotencyKey({
      workspaceId,
      contentItemId: input.contentItemId,
      platform: input.platform,
      accountId: input.accountId,
      scheduledForUtc: input.scheduledForUtc,
    });

  const duplicate = detectDuplicateScheduledPost(existingScheduled, {
    contentItemId: input.contentItemId,
    platform: input.platform,
    accountId: input.accountId,
    scheduledForUtc: input.scheduledForUtc,
    idempotencyKey,
  });
  if (duplicate) {
    throw new AppError(
      409,
      'DUPLICATE_EXECUTION_BLOCKED',
      `A scheduled post already exists for this content/platform/account near ${duplicate.scheduledForUtc}.`,
    );
  }

  const account = accounts.find((a) => a.id === input.accountId) || null;
  const approval = input.approvalRequestId
    ? approvals.find((a) => a.id === input.approvalRequestId) || null
    : content.approvalRequestId
      ? approvals.find((a) => a.id === content.approvalRequestId) || null
      : null;
  const policy = policies.find((p) => p.brandId === input.brandId) || null;

  const gateway = evaluateActionGateway({
    workspaceId,
    brandId: input.brandId,
    actorUid: uid,
    actorType: 'human',
    member,
    actionType: 'schedule_post',
    platform: input.platform,
    contentFormat: content.format,
    payloadHash: content.payloadHash,
    idempotencyKey,
    account,
    approval,
    autonomyPolicy: policy,
    emergencyStop,
    qualityCheck: content.qualityCheck,
  });

  if (!gateway.allowed) {
    throw new AppError(403, gateway.code || 'APPROVAL_REQUIRED', gateway.reason);
  }

  const id = makeId('spost');
  const now = new Date().toISOString();

  await store.commit([
    {
      path: `workspaces/${workspaceId}/scheduledPosts/${id}`,
      data: {
        id,
        schemaVersion: '4.0.0',
        workspaceId,
        brandId: input.brandId,
        contentItemId: input.contentItemId,
        platform: input.platform,
        accountId: input.accountId,
        scheduledForUtc: new Date(input.scheduledForUtc).toISOString(),
        timezone: input.timezone,
        status: 'scheduled',
        payloadHash: content.payloadHash,
        approvalRequestId: approval?.id || '',
        idempotencyKey,
        attemptCount: 0,
        maxAttempts: 3,
        reconciliationRequired: false,
        createdBy: uid,
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    },
    {
      path: `workspaces/${workspaceId}/contentItems/${content.id}`,
      data: {
        status: 'SCHEDULED',
        scheduledForUtc: new Date(input.scheduledForUtc).toISOString(),
        scheduledTimezone: input.timezone,
      },
      updateMask: ['status', 'scheduledForUtc', 'scheduledTimezone', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordMarketingActivity(store, workspaceId, {
    brandId: input.brandId,
    category: 'publishing',
    action: 'post.scheduled',
    summary: `Scheduled "${content.title}" on ${input.platform} for ${input.scheduledForUtc} (${input.timezone}).`,
    status: 'pending',
    resourceType: 'scheduled_post',
    resourceId: id,
    actorUid: uid,
  });

  await recordAuditLog(store, workspaceId, uid, userEmail, 'publishing.scheduled', 'scheduled_post', id, `Scheduled post ${id} on ${input.platform}`);

  const list = await listScheduledPosts(uid, workspaceId, ctx);
  return list.find((p) => p.id === id) || {
    id,
    schemaVersion: '4.0.0',
    workspaceId,
    brandId: input.brandId,
    contentItemId: input.contentItemId,
    platform: input.platform,
    accountId: input.accountId,
    scheduledForUtc: new Date(input.scheduledForUtc).toISOString(),
    timezone: input.timezone,
    status: 'scheduled',
    payloadHash: content.payloadHash,
    approvalRequestId: approval?.id,
    idempotencyKey,
    attemptCount: 0,
    maxAttempts: 3,
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
}

export async function executeContentPublish(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    brandId: string;
    contentItemId: string;
    platform: SocialPlatformId;
    accountId: string;
    scheduledPostId?: string;
    approvalRequestId?: string;
    idempotencyKey?: string;
    dryRun?: boolean;
    adapterOverride?: SocialPublishingAdapter;
    accessTokenOverride?: string;
    fetchImpl?: typeof fetch;
  },
  ctx: RepositoryContext = {},
): Promise<{
  attempt: PublishingAttemptRecord;
  gatewayDecisionId: string;
  resultStatus: string;
}> {
  const { store, member } = await requireWorkspaceAccess(uid, workspaceId, 'publishing:execute', ctx);
  const [content, accounts, allAssets, approvals, policies, emergencyStop, attempts] = await Promise.all([
    getMarketingContentById(uid, workspaceId, input.contentItemId, ctx),
    listConnectedSocialAccounts(uid, workspaceId, ctx),
    listMediaAssets(uid, workspaceId, ctx),
    listApprovalRequests(uid, workspaceId, ctx),
    listBrandAutonomyPolicies(uid, workspaceId, ctx),
    getWorkspaceEmergencyStop(store, workspaceId),
    listPublishingAttempts(uid, workspaceId, ctx),
  ]);

  const account = accounts.find((a) => a.id === input.accountId) || null;
  const approval = input.approvalRequestId
    ? approvals.find((a) => a.id === input.approvalRequestId) || null
    : content.approvalRequestId
      ? approvals.find((a) => a.id === content.approvalRequestId) || null
      : null;
  const policy = policies.find((p) => p.brandId === input.brandId) || null;
  const adapter = input.adapterOverride || getSocialPublishingAdapter(input.platform);

  const idempotencyKey =
    input.idempotencyKey ||
    `pub_${crypto
      .createHash('sha256')
      .update(`${workspaceId}|${content.id}|${input.platform}|${input.accountId}|${content.payloadHash}`)
      .digest('hex')
      .slice(0, 24)}`;

  const executedKeys = new Set(
    attempts
      .filter((a) => a.status === 'succeeded' || a.status === 'status_unknown' || a.status === 'processing')
      .map((a) => a.idempotencyKey),
  );

  const todayPrefix = new Date().toISOString().slice(0, 10);
  const todayAutoCount = attempts.filter(
    (a) => a.brandId === input.brandId && a.startedAt.startsWith(todayPrefix) && a.status === 'succeeded',
  ).length;

  const gateway = evaluateActionGateway({
    workspaceId,
    brandId: input.brandId,
    actorUid: uid,
    actorType: 'human',
    member,
    actionType: 'publish_post',
    platform: input.platform,
    contentFormat: content.format,
    payloadHash: content.payloadHash,
    idempotencyKey,
    account,
    requiredScopes: [...adapter.requiredScopes],
    approval,
    autonomyPolicy: policy,
    emergencyStop,
    qualityCheck: content.qualityCheck,
    todayAutoPublishCount: todayAutoCount,
    alreadyExecutedIdempotencyKeys: input.dryRun ? undefined : executedKeys,
  });

  if (!gateway.allowed) {
    throw new AppError(403, gateway.code || 'APPROVAL_REQUIRED', gateway.reason);
  }

  const variant = content.variants.find((v) => v.platform === input.platform);
  const attachedAssets = allAssets.filter((a) => content.mediaAssetIds.includes(a.id));
  const accessToken =
    input.accessTokenOverride ||
    (input.dryRun ? 'dry_run_token' : await readDecryptedSocialAccessToken(store, workspaceId, account!));

  const startedAt = new Date().toISOString();
  const attemptId = makeId('patt');

  const result = await adapter.publish(
    account!,
    accessToken,
    {
      workspaceId,
      brandId: input.brandId,
      contentItemId: content.id,
      title: variant?.title || content.title,
      caption: variant?.caption || content.body,
      format: content.format,
      hashtags: variant?.hashtags || content.hashtags,
      mediaAssets: attachedAssets,
      visibility: variant?.visibility,
      idempotencyKey,
      dryRun: input.dryRun,
    },
    input.fetchImpl,
  );

  const finishedAt = new Date().toISOString();
  const attemptStatus: PublishingAttemptRecord['status'] =
    result.status === 'published' || result.status === 'dry_run_valid'
      ? 'succeeded'
      : result.status === 'processing'
        ? 'processing'
        : result.status === 'publish_status_unknown'
          ? 'status_unknown'
          : 'failed';

  const attempt: PublishingAttemptRecord = {
    id: attemptId,
    schemaVersion: '4.0.0',
    workspaceId,
    brandId: input.brandId,
    scheduledPostId: input.scheduledPostId,
    contentItemId: content.id,
    platform: input.platform,
    accountId: account!.id,
    attemptNumber: attempts.filter((a) => a.contentItemId === content.id && a.platform === input.platform).length + 1,
    status: attemptStatus,
    gatewayDecisionId: gateway.decisionId,
    idempotencyKey,
    providerContainerId: result.providerContainerId,
    externalPostId: result.externalPostId,
    externalPostUrl: result.externalPostUrl,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    retryable: result.retryable,
    startedAt,
    finishedAt,
  };

  const ops = [
    {
      path: `workspaces/${workspaceId}/publishingAttempts/${attemptId}`,
      data: {
        ...attempt,
        scheduledPostId: attempt.scheduledPostId || '',
        providerContainerId: attempt.providerContainerId || '',
        externalPostId: attempt.externalPostId || '',
        externalPostUrl: attempt.externalPostUrl || '',
        errorCode: attempt.errorCode || '',
        errorMessage: attempt.errorMessage || '',
      },
      serverTimestampFields: [],
    },
  ];

  if (!input.dryRun) {
    const nextContentStatus: MarketingContentItem['status'] =
      result.status === 'published'
        ? 'PUBLISHED'
        : result.status === 'processing'
          ? 'PROCESSING'
          : 'FAILED';
    ops.push({
      path: `workspaces/${workspaceId}/contentItems/${content.id}`,
      data: {
        status: nextContentStatus,
        lastErrorCode: result.errorCode || '',
        lastErrorMessage: result.errorMessage || '',
      },
      updateMask: ['status', 'lastErrorCode', 'lastErrorMessage', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    } as never);

    if (input.scheduledPostId) {
      const spRaw = await store.getDoc(`workspaces/${workspaceId}/scheduledPosts/${input.scheduledPostId}`);
      if (spRaw) {
        if (result.status === 'published' || result.status === 'processing') {
          ops.push({
            path: `workspaces/${workspaceId}/scheduledPosts/${input.scheduledPostId}`,
            data: {
              status: result.status === 'published' ? 'published' : 'processing',
              externalPostId: result.externalPostId || '',
              externalPostUrl: result.externalPostUrl || '',
              reconciliationRequired: false,
              leaseOwner: '',
              leaseExpiresAt: '',
            },
            updateMask: [
              'status', 'externalPostId', 'externalPostUrl', 'reconciliationRequired',
              'leaseOwner', 'leaseExpiresAt', 'updatedAt',
            ],
            serverTimestampFields: ['updatedAt'],
          } as never);
        } else {
          const currentSp = (await listScheduledPosts(uid, workspaceId, ctx)).find(
            (s) => s.id === input.scheduledPostId,
          );
          if (currentSp) {
            const nextSp = computeRetryOrDeadLetterTransition(currentSp, {
              errorCode: result.errorCode || 'PROVIDER_PERMANENT_ERROR',
              errorMessage: result.errorMessage || 'Publishing attempt failed.',
              retryable: Boolean(result.retryable),
              reconciliationRequired: Boolean(result.reconciliationRequired),
            });
            ops.push({
              path: `workspaces/${workspaceId}/scheduledPosts/${input.scheduledPostId}`,
              data: {
                status: nextSp.status,
                reconciliationRequired: Boolean(nextSp.reconciliationRequired),
                nextRetryAtUtc: nextSp.nextRetryAtUtc || '',
                lastErrorCode: nextSp.lastErrorCode || '',
                lastErrorMessage: nextSp.lastErrorMessage || '',
                leaseOwner: '',
                leaseExpiresAt: '',
              },
              updateMask: [
                'status', 'reconciliationRequired', 'nextRetryAtUtc',
                'lastErrorCode', 'lastErrorMessage', 'leaseOwner', 'leaseExpiresAt', 'updatedAt',
              ],
              serverTimestampFields: ['updatedAt'],
            } as never);
          }
        }
      }
    }
  }

  await store.commit(ops);

  await recordMarketingActivity(store, workspaceId, {
    brandId: input.brandId,
    category: 'publishing',
    action: input.dryRun ? 'publish.dry_run' : `publish.${result.status}`,
    summary: input.dryRun
      ? `Dry-run validated "${content.title}" for ${input.platform}.`
      : result.status === 'published'
        ? `Published "${content.title}" to ${input.platform} (${result.externalPostId || 'confirmed'}).`
        : `Publish "${content.title}" to ${input.platform} returned ${result.status}: ${result.errorMessage || ''}`,
    status: result.status === 'published' || result.status === 'dry_run_valid' ? 'success' : result.status === 'processing' ? 'pending' : 'error',
    resourceType: 'publishing_attempt',
    resourceId: attemptId,
    actorUid: uid,
  });

  await recordAuditLog(store, workspaceId, uid, userEmail, `publishing.${result.status}`, 'publishing_attempt', attemptId, `Publishing attempt for ${content.id} on ${input.platform}: ${result.status}`);

  return { attempt, gatewayDecisionId: gateway.decisionId, resultStatus: result.status };
}

export async function updateOrReconcileScheduledPost(
  uid: string,
  userEmail: string,
  workspaceId: string,
  scheduledPostId: string,
  input: {
    action: 'reschedule' | 'cancel' | 'duplicate' | 'reconcile_check';
    scheduledForUtc?: string;
    timezone?: string;
    reason?: string;
  },
  ctx: RepositoryContext = {},
): Promise<{ post: ScheduledPostRecord; detail: string }> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'publishing:schedule', ctx);
  const posts = await listScheduledPosts(uid, workspaceId, ctx);
  const target = posts.find((p) => p.id === scheduledPostId);
  if (!target) throw new AppError(404, 'SCHEDULED_POST_NOT_FOUND', 'Scheduled post not found.');

  const path = `workspaces/${workspaceId}/scheduledPosts/${scheduledPostId}`;

  if (input.action === 'cancel') {
    await store.commit([
      {
        path,
        data: { status: 'cancelled', lastErrorMessage: input.reason || 'Cancelled by workspace member.' },
        updateMask: ['status', 'lastErrorMessage', 'updatedAt'],
        serverTimestampFields: ['updatedAt'],
      },
    ]);
    await recordAuditLog(store, workspaceId, uid, userEmail, 'publishing.cancelled', 'scheduled_post', scheduledPostId, `Cancelled scheduled post ${scheduledPostId}`);
    return { post: { ...target, status: 'cancelled' }, detail: 'Scheduled post cancelled.' };
  }

  if (input.action === 'reschedule') {
    if (!input.scheduledForUtc) {
      throw new AppError(400, 'INVALID_INPUT', 'New scheduledForUtc timestamp is required to reschedule.');
    }
    const tz = input.timezone || target.timezone;
    if (!isValidIanaTimezone(tz)) {
      throw new AppError(400, 'INVALID_TIMEZONE', `Invalid IANA timezone "${tz}".`);
    }
    const iso = new Date(input.scheduledForUtc).toISOString();
    await store.commit([
      {
        path,
        data: { scheduledForUtc: iso, timezone: tz, status: 'scheduled' },
        updateMask: ['scheduledForUtc', 'timezone', 'status', 'updatedAt'],
        serverTimestampFields: ['updatedAt'],
      },
    ]);
    return { post: { ...target, scheduledForUtc: iso, timezone: tz, status: 'scheduled' }, detail: `Rescheduled to ${iso} (${tz}).` };
  }

  if (input.action === 'duplicate') {
    const plusOneDay = new Date(Date.parse(target.scheduledForUtc) + 24 * 3600 * 1000).toISOString();
    const dup = await scheduleContentPost(
      uid,
      userEmail,
      workspaceId,
      {
        brandId: target.brandId,
        contentItemId: target.contentItemId,
        platform: target.platform,
        accountId: target.accountId,
        scheduledForUtc: input.scheduledForUtc || plusOneDay,
        timezone: input.timezone || target.timezone,
        approvalRequestId: target.approvalRequestId,
      },
      ctx,
    );
    return { post: dup, detail: `Duplicated scheduled post to ${dup.scheduledForUtc}.` };
  }

  // reconcile_check for PUBLISH_STATUS_UNKNOWN
  const [accounts, attempts] = await Promise.all([
    listConnectedSocialAccounts(uid, workspaceId, ctx),
    listPublishingAttempts(uid, workspaceId, ctx),
  ]);
  const account = accounts.find((a) => a.id === target.accountId);
  if (!account) {
    return { post: target, detail: 'Connected account no longer available for provider reconciliation.' };
  }
  const latestAttempt = attempts.find((a) => a.scheduledPostId === target.id);
  const adapter = getSocialPublishingAdapter(target.platform);

  try {
    const token = await readDecryptedSocialAccessToken(store, workspaceId, account);
    const rec = await adapter.reconcilePublishStatus(account, token, {
      containerId: latestAttempt?.providerContainerId,
      idempotencyKey: target.idempotencyKey,
      publishedAfterIso: latestAttempt?.startedAt,
    });
    if (rec.existsOnProvider === 'confirmed_published') {
      await store.commit([
        {
          path,
          data: {
            status: 'published',
            reconciliationRequired: false,
            externalPostId: rec.externalPostId || '',
            externalPostUrl: rec.externalPostUrl || '',
            lastErrorMessage: rec.detail,
          },
          updateMask: ['status', 'reconciliationRequired', 'externalPostId', 'externalPostUrl', 'lastErrorMessage', 'updatedAt'],
          serverTimestampFields: ['updatedAt'],
        },
      ]);
      return { post: { ...target, status: 'published', reconciliationRequired: false }, detail: rec.detail };
    }
    if (rec.existsOnProvider === 'confirmed_not_published') {
      await store.commit([
        {
          path,
          data: { status: 'failed', reconciliationRequired: false, lastErrorMessage: rec.detail },
          updateMask: ['status', 'reconciliationRequired', 'lastErrorMessage', 'updatedAt'],
          serverTimestampFields: ['updatedAt'],
        },
      ]);
      return { post: { ...target, status: 'failed', reconciliationRequired: false }, detail: rec.detail };
    }
    return { post: target, detail: rec.detail };
  } catch (err) {
    return {
      post: target,
      detail: `Reconciliation requires active credentials: ${err instanceof Error ? err.message : 'unavailable'}.`,
    };
  }
}

export async function runCronDispatchForWorkspace(
  store: DataStore,
  workspaceId: string,
  workerId: string,
  nowIso: string = new Date().toISOString(),
): Promise<{
  workspaceId: string;
  dueFound: number;
  claimedCount: number;
  recoveredExpiredLeasesCount: number;
  blockedReconciliationCount: number;
  blockedByEmergencyStop: boolean;
}> {
  const emergency = await getWorkspaceEmergencyStop(store, workspaceId);
  if (emergency.globalStopped) {
    return {
      workspaceId,
      dueFound: 0,
      claimedCount: 0,
      recoveredExpiredLeasesCount: 0,
      blockedReconciliationCount: 0,
      blockedByEmergencyStop: true,
    };
  }

  const rawPosts = await store.listWorkspaceSubcollection(workspaceId, 'scheduledPosts');
  const posts: ScheduledPostRecord[] = rawPosts.map((d) => ({
    id: String(d.id),
    schemaVersion: '4.0.0',
    workspaceId: String(d.workspaceId),
    brandId: String(d.brandId),
    contentItemId: String(d.contentItemId),
    platform: d.platform as SocialPlatformId,
    accountId: String(d.accountId),
    scheduledForUtc: String(d.scheduledForUtc),
    timezone: String(d.timezone || 'Asia/Kolkata'),
    status: (d.status as ScheduledPostRecord['status']) || 'scheduled',
    payloadHash: String(d.payloadHash || ''),
    approvalRequestId: d.approvalRequestId ? String(d.approvalRequestId) : undefined,
    idempotencyKey: String(d.idempotencyKey || ''),
    leaseOwner: d.leaseOwner ? String(d.leaseOwner) : undefined,
    leaseExpiresAt: d.leaseExpiresAt ? String(d.leaseExpiresAt) : undefined,
    attemptCount: Number(d.attemptCount || 0),
    maxAttempts: Number(d.maxAttempts || 3),
    nextRetryAtUtc: d.nextRetryAtUtc ? String(d.nextRetryAtUtc) : undefined,
    reconciliationRequired: Boolean(d.reconciliationRequired),
    createdBy: String(d.createdBy || ''),
    createdAt: toIsoString(d.createdAt),
    updatedAt: toIsoString(d.updatedAt),
  }));

  const selection = selectDueScheduledPosts(posts, nowIso);
  let claimedCount = 0;

  for (const due of selection.dueForExecution) {
    const claim = claimScheduledPostLease(due, workerId, nowIso);
    if (!claim.claimed || !claim.updated) continue;
    claimedCount += 1;
    await store.commit([
      {
        path: `workspaces/${workspaceId}/scheduledPosts/${due.id}`,
        data: {
          status: claim.updated.status,
          leaseOwner: claim.updated.leaseOwner || workerId,
          leaseExpiresAt: claim.updated.leaseExpiresAt || '',
          attemptCount: claim.updated.attemptCount,
        },
        updateMask: ['status', 'leaseOwner', 'leaseExpiresAt', 'attemptCount', 'updatedAt'],
        serverTimestampFields: ['updatedAt'],
      },
    ]);
  }

  return {
    workspaceId,
    dueFound: selection.dueForExecution.length,
    claimedCount,
    recoveredExpiredLeasesCount: selection.recoveredExpiredLeases.length,
    blockedReconciliationCount: selection.blockedReconciliationCount,
    blockedByEmergencyStop: false,
  };
}

// =============================================================================
// 8. Social Inbox, Reviews, Leads, Paid Campaigns, Analytics, Experiments, Activity
// =============================================================================

export async function listSocialConversations(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<SocialConversationRecord[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'socialConversations');
  return docs
    .map((d) => ({
      id: String(d.id),
      schemaVersion: '4.0.0' as const,
      workspaceId: String(d.workspaceId),
      brandId: String(d.brandId),
      platform: d.platform as SocialPlatformId,
      accountId: String(d.accountId || ''),
      externalThreadId: String(d.externalThreadId || ''),
      channelType: (d.channelType as SocialConversationRecord['channelType']) || 'comment',
      participantName: String(d.participantName || 'Unknown'),
      participantHandle: d.participantHandle ? String(d.participantHandle) : undefined,
      messagingWindowType:
        (d.messagingWindowType as SocialConversationRecord['messagingWindowType']) || 'comment_public',
      messagingWindowExpiresAt: d.messagingWindowExpiresAt
        ? String(d.messagingWindowExpiresAt)
        : undefined,
      sensitiveTopicDetected: Boolean(d.sensitiveTopicDetected),
      sensitiveTopicReason: d.sensitiveTopicReason ? String(d.sensitiveTopicReason) : undefined,
      status: (d.status as SocialConversationRecord['status']) || 'open',
      assignedToUid: d.assignedToUid ? String(d.assignedToUid) : undefined,
      aiSummary: d.aiSummary ? String(d.aiSummary) : undefined,
      draftReply: d.draftReply ? String(d.draftReply) : undefined,
      lastMessageAt: toIsoString(d.lastMessageAt),
      messages: parseJsonField(d.messagesJson, []),
      createdAt: toIsoString(d.createdAt),
      updatedAt: toIsoString(d.updatedAt),
    }))
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

export async function handleSocialInboxAction(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    action: 'draft_reply' | 'request_approval' | 'send_reply' | 'assign' | 'resolve' | 'escalate' | 'ingest_message';
    conversationId?: string;
    brandId?: string;
    platform?: SocialPlatformId;
    accountId?: string;
    channelType?: SocialConversationRecord['channelType'];
    participantName?: string;
    messageText?: string;
    replyText?: string;
    approvalRequestId?: string;
    assignedToUid?: string;
    messagingWindowType?: SocialConversationRecord['messagingWindowType'];
    messagingWindowExpiresAt?: string;
  },
  ctx: RepositoryContext = {},
): Promise<{ conversation: SocialConversationRecord; note: string; approvalRequest?: ApprovalRequestRecord }> {
  const perm = input.action === 'send_reply' ? 'inbox:reply' : 'content:write';
  const { store, member } = await requireWorkspaceAccess(uid, workspaceId, perm, ctx);
  const now = new Date().toISOString();

  if (input.action === 'ingest_message') {
    if (!input.brandId || !input.platform || !input.messageText) {
      throw new AppError(400, 'INVALID_INPUT', 'brandId, platform, and messageText are required.');
    }
    const id = makeId('conv');
    const sensitive = detectSensitiveTopic(input.messageText);
    const channelType = input.channelType || 'comment';
    const windowType =
      input.messagingWindowType ||
      (channelType === 'dm' ? 'standard_24h' : 'comment_public');
    const messages = [
      {
        id: makeId('msg'),
        sender: 'customer' as const,
        senderName: input.participantName || 'Customer',
        text: input.messageText,
        sentAt: now,
      },
    ];
    await store.commit([
      {
        path: `workspaces/${workspaceId}/socialConversations/${id}`,
        data: {
          id,
          schemaVersion: '4.0.0',
          workspaceId,
          brandId: input.brandId,
          platform: input.platform,
          accountId: input.accountId || '',
          externalThreadId: makeId('ext'),
          channelType,
          participantName: input.participantName || 'Customer',
          messagingWindowType: windowType,
          messagingWindowExpiresAt:
            input.messagingWindowExpiresAt ||
            (windowType === 'click_to_message_ad'
              ? new Date(Date.now() + 72 * 3600 * 1000).toISOString()
              : windowType === 'standard_24h'
                ? new Date(Date.now() + 24 * 3600 * 1000).toISOString()
                : ''),
          sensitiveTopicDetected: sensitive.sensitive,
          sensitiveTopicReason: sensitive.reason || '',
          status: sensitive.sensitive ? 'escalated' : 'open',
          lastMessageAt: now,
          messagesJson: JSON.stringify(messages),
        },
        serverTimestampFields: ['createdAt', 'updatedAt'],
      },
    ]);
    const list = await listSocialConversations(uid, workspaceId, ctx);
    return {
      conversation: list.find((c) => c.id === id)!,
      note: sensitive.sensitive ? 'Sensitive topic flagged and escalated.' : 'Conversation recorded.',
    };
  }

  if (!input.conversationId) {
    throw new AppError(400, 'INVALID_INPUT', 'conversationId is required.');
  }
  const convos = await listSocialConversations(uid, workspaceId, ctx);
  const conv = convos.find((c) => c.id === input.conversationId);
  if (!conv) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  const convPath = `workspaces/${workspaceId}/socialConversations/${conv.id}`;

  if (input.action === 'draft_reply') {
    const reply =
      input.replyText ||
      `Thank you for reaching out, ${conv.participantName}. Our team is reviewing your inquiry and will follow up shortly.`;
    await store.commit([
      {
        path: convPath,
        data: { draftReply: reply },
        updateMask: ['draftReply', 'updatedAt'],
        serverTimestampFields: ['updatedAt'],
      },
    ]);
    return { conversation: { ...conv, draftReply: reply }, note: 'Draft reply saved.' };
  }

  if (input.action === 'assign') {
    await store.commit([
      {
        path: convPath,
        data: { assignedToUid: input.assignedToUid || uid },
        updateMask: ['assignedToUid', 'updatedAt'],
        serverTimestampFields: ['updatedAt'],
      },
    ]);
    return { conversation: { ...conv, assignedToUid: input.assignedToUid || uid }, note: 'Conversation assigned.' };
  }

  if (input.action === 'resolve' || input.action === 'escalate') {
    const nextStatus = input.action === 'resolve' ? 'resolved' : 'escalated';
    await store.commit([
      {
        path: convPath,
        data: { status: nextStatus },
        updateMask: ['status', 'updatedAt'],
        serverTimestampFields: ['updatedAt'],
      },
    ]);
    return { conversation: { ...conv, status: nextStatus }, note: `Conversation marked ${nextStatus}.` };
  }

  const replyText = (input.replyText || conv.draftReply || '').trim();
  if (!replyText) throw new AppError(400, 'INVALID_INPUT', 'Reply text is required.');
  const payloadHash = computeContentPayloadHash({ title: conv.id, body: replyText, targetPlatforms: [conv.platform] });

  if (input.action === 'request_approval') {
    const approvalRequest = await createApprovalRequest(
      uid,
      userEmail,
      workspaceId,
      {
        brandId: conv.brandId,
        actionType: conv.channelType === 'dm' ? 'send_dm' : 'reply_comment',
        targetResourceType: 'conversation',
        targetResourceId: conv.id,
        platform: conv.platform,
        accountId: conv.accountId || undefined,
        payloadHash,
        summary: `Reply to ${conv.participantName} (${conv.platform} ${conv.channelType})`,
        riskLevel: conv.sensitiveTopicDetected ? 'high' : 'low',
        requestedByType: 'human',
      },
      ctx,
    );
    await store.commit([
      {
        path: convPath,
        data: { draftReply: replyText, status: 'pending_approval' },
        updateMask: ['draftReply', 'status', 'updatedAt'],
        serverTimestampFields: ['updatedAt'],
      },
    ]);
    return {
      conversation: { ...conv, draftReply: replyText, status: 'pending_approval' },
      note: 'Approval requested for social reply.',
      approvalRequest,
    };
  }

  // send_reply — MUST validate messaging window & Central Action Gateway
  const windowCheck = validateMessagingWindow(conv, now);
  if (!windowCheck.allowed) {
    throw new AppError(403, windowCheck.code || 'MESSAGING_WINDOW_EXPIRED', windowCheck.reason);
  }

  const [accounts, approvals, policies, emergencyStop] = await Promise.all([
    listConnectedSocialAccounts(uid, workspaceId, ctx),
    listApprovalRequests(uid, workspaceId, ctx),
    listBrandAutonomyPolicies(uid, workspaceId, ctx),
    getWorkspaceEmergencyStop(store, workspaceId),
  ]);

  const gateway = evaluateActionGateway({
    workspaceId,
    brandId: conv.brandId,
    actorUid: uid,
    actorType: 'human',
    member,
    actionType: conv.channelType === 'dm' ? 'send_dm' : 'reply_comment',
    platform: conv.platform,
    payloadHash,
    idempotencyKey: `inb_${conv.id}_${payloadHash.slice(0, 12)}`,
    account: accounts.find((a) => a.id === conv.accountId) || null,
    approval: input.approvalRequestId
      ? approvals.find((a) => a.id === input.approvalRequestId) || null
      : null,
    autonomyPolicy: policies.find((p) => p.brandId === conv.brandId) || null,
    emergencyStop,
    isSensitiveTopic: conv.sensitiveTopicDetected,
  });

  if (!gateway.allowed) {
    throw new AppError(403, gateway.code || 'APPROVAL_REQUIRED', gateway.reason);
  }

  const nextMessages = [
    ...conv.messages,
    { id: makeId('msg'), sender: 'brand' as const, senderName: userEmail, text: replyText, sentAt: now },
  ];

  await store.commit([
    {
      path: convPath,
      data: {
        status: 'replied',
        draftReply: '',
        lastMessageAt: now,
        messagesJson: JSON.stringify(nextMessages),
      },
      updateMask: ['status', 'draftReply', 'lastMessageAt', 'messagesJson', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordMarketingActivity(store, workspaceId, {
    brandId: conv.brandId,
    category: 'inbox',
    action: 'inbox.replied',
    summary: `Replied to ${conv.participantName} on ${conv.platform} (${windowCheck.windowLabel}).`,
    status: 'success',
    resourceType: 'conversation',
    resourceId: conv.id,
    actorUid: uid,
  });

  return {
    conversation: { ...conv, status: 'replied', draftReply: '', messages: nextMessages, lastMessageAt: now },
    note: `Reply authorized by Central Action Gateway (${gateway.decisionId}).`,
  };
}

export async function listReviews(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<ReviewRecord[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'reviews');
  return docs
    .map((d) => ({
      id: String(d.id),
      schemaVersion: '4.0.0' as const,
      workspaceId: String(d.workspaceId),
      brandId: String(d.brandId),
      platform: (d.platform as ReviewRecord['platform']) || 'google_business_profile',
      accountId: d.accountId ? String(d.accountId) : undefined,
      locationName: d.locationName ? String(d.locationName) : undefined,
      externalReviewId: String(d.externalReviewId || ''),
      reviewerName: String(d.reviewerName || 'Anonymous'),
      rating: (Number(d.rating || 5) as ReviewRecord['rating']),
      comment: String(d.comment || ''),
      category: (d.category as ReviewRecord['category']) || 'praise',
      sentiment: (d.sentiment as ReviewRecord['sentiment']) || 'positive',
      escalationRequired: Boolean(d.escalationRequired),
      aiDraftReply: d.aiDraftReply ? String(d.aiDraftReply) : undefined,
      publishedReply: d.publishedReply ? String(d.publishedReply) : undefined,
      replyStatus: (d.replyStatus as ReviewRecord['replyStatus']) || 'unanswered',
      approvalRequestId: d.approvalRequestId ? String(d.approvalRequestId) : undefined,
      reviewedAt: toIsoString(d.reviewedAt),
      repliedAt: d.repliedAt ? toIsoString(d.repliedAt) : undefined,
      createdAt: toIsoString(d.createdAt),
      updatedAt: toIsoString(d.updatedAt),
    }))
    .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
}

export async function handleReviewAction(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    action: 'ingest_review' | 'draft_reply' | 'request_approval' | 'publish_reply' | 'escalate';
    reviewId?: string;
    brandId?: string;
    platform?: 'google_business_profile' | 'facebook';
    accountId?: string;
    locationName?: string;
    reviewerName?: string;
    rating?: 1 | 2 | 3 | 4 | 5;
    comment?: string;
    replyText?: string;
    approvalRequestId?: string;
  },
  ctx: RepositoryContext = {},
): Promise<{ review: ReviewRecord; note: string; approvalRequest?: ApprovalRequestRecord }> {
  const perm = input.action === 'publish_reply' ? 'reviews:reply' : 'content:write';
  const { store, member } = await requireWorkspaceAccess(uid, workspaceId, perm, ctx);
  const now = new Date().toISOString();

  if (input.action === 'ingest_review') {
    if (!input.brandId || !input.reviewerName || !input.rating || !input.comment) {
      throw new AppError(400, 'INVALID_INPUT', 'brandId, reviewerName, rating, and comment are required.');
    }
    const brands = await listBrands(uid, workspaceId, ctx);
    const brand = brands.find((b) => b.id === input.brandId);
    const classified = classifyReviewFeedback(input.rating, input.comment);
    const draft = draftBrandSafeReviewReply({
      brandName: brand?.name || 'our brand',
      reviewerName: input.reviewerName,
      rating: input.rating,
      category: classified.category,
    });
    const id = makeId('rev');
    await store.commit([
      {
        path: `workspaces/${workspaceId}/reviews/${id}`,
        data: {
          id,
          schemaVersion: '4.0.0',
          workspaceId,
          brandId: input.brandId,
          platform: input.platform || 'google_business_profile',
          accountId: input.accountId || '',
          locationName: input.locationName || '',
          externalReviewId: makeId('extrev'),
          reviewerName: input.reviewerName,
          rating: input.rating,
          comment: input.comment,
          category: classified.category,
          sentiment: classified.sentiment,
          escalationRequired: classified.escalationRequired,
          aiDraftReply: draft,
          replyStatus: classified.escalationRequired ? 'escalated' : 'draft_ready',
          reviewedAt: now,
        },
        serverTimestampFields: ['createdAt', 'updatedAt'],
      },
    ]);
    const list = await listReviews(uid, workspaceId, ctx);
    return {
      review: list.find((r) => r.id === id)!,
      note: classified.escalationRequired
        ? 'Review classified and escalated for human handling.'
        : 'Review classified with brand-safe draft reply.',
    };
  }

  if (!input.reviewId) throw new AppError(400, 'INVALID_INPUT', 'reviewId is required.');
  const reviews = await listReviews(uid, workspaceId, ctx);
  const rev = reviews.find((r) => r.id === input.reviewId);
  if (!rev) throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review not found.');
  const revPath = `workspaces/${workspaceId}/reviews/${rev.id}`;

  if (input.action === 'draft_reply') {
    const brands = await listBrands(uid, workspaceId, ctx);
    const brand = brands.find((b) => b.id === rev.brandId);
    const draft =
      input.replyText ||
      draftBrandSafeReviewReply({
        brandName: brand?.name || 'our brand',
        reviewerName: rev.reviewerName,
        rating: rev.rating,
        category: rev.category,
      });
    await store.commit([
      {
        path: revPath,
        data: { aiDraftReply: draft, replyStatus: 'draft_ready' },
        updateMask: ['aiDraftReply', 'replyStatus', 'updatedAt'],
        serverTimestampFields: ['updatedAt'],
      },
    ]);
    return { review: { ...rev, aiDraftReply: draft, replyStatus: 'draft_ready' }, note: 'Draft reply updated.' };
  }

  if (input.action === 'escalate') {
    await store.commit([
      {
        path: revPath,
        data: { escalationRequired: true, replyStatus: 'escalated' },
        updateMask: ['escalationRequired', 'replyStatus', 'updatedAt'],
        serverTimestampFields: ['updatedAt'],
      },
    ]);
    return { review: { ...rev, escalationRequired: true, replyStatus: 'escalated' }, note: 'Review escalated.' };
  }

  const replyText = (input.replyText || rev.aiDraftReply || '').trim();
  if (!replyText) throw new AppError(400, 'INVALID_INPUT', 'Reply text is required.');
  const payloadHash = computeContentPayloadHash({ title: rev.id, body: replyText, targetPlatforms: [rev.platform] });

  if (input.action === 'request_approval') {
    const approvalRequest = await createApprovalRequest(
      uid,
      userEmail,
      workspaceId,
      {
        brandId: rev.brandId,
        actionType: 'reply_review',
        targetResourceType: 'review',
        targetResourceId: rev.id,
        platform: rev.platform,
        accountId: rev.accountId,
        payloadHash,
        summary: `Approve ${rev.rating}-star review reply to ${rev.reviewerName} (${rev.platform})`,
        riskLevel: rev.rating <= 2 || rev.escalationRequired ? 'high' : 'low',
        requestedByType: 'human',
      },
      ctx,
    );
    await store.commit([
      {
        path: revPath,
        data: { aiDraftReply: replyText, replyStatus: 'pending_approval', approvalRequestId: approvalRequest.id },
        updateMask: ['aiDraftReply', 'replyStatus', 'approvalRequestId', 'updatedAt'],
        serverTimestampFields: ['updatedAt'],
      },
    ]);
    return {
      review: { ...rev, aiDraftReply: replyText, replyStatus: 'pending_approval', approvalRequestId: approvalRequest.id },
      note: 'Review reply submitted for human approval.',
      approvalRequest,
    };
  }

  // publish_reply through Central Action Gateway
  const [accounts, approvals, policies, emergencyStop] = await Promise.all([
    listConnectedSocialAccounts(uid, workspaceId, ctx),
    listApprovalRequests(uid, workspaceId, ctx),
    listBrandAutonomyPolicies(uid, workspaceId, ctx),
    getWorkspaceEmergencyStop(store, workspaceId),
  ]);

  const gateway = evaluateActionGateway({
    workspaceId,
    brandId: rev.brandId,
    actorUid: uid,
    actorType: 'human',
    member,
    actionType: 'reply_review',
    platform: rev.platform,
    payloadHash,
    idempotencyKey: `rev_${rev.id}_${payloadHash.slice(0, 12)}`,
    account: accounts.find((a) => a.id === rev.accountId) || null,
    approval: input.approvalRequestId
      ? approvals.find((a) => a.id === input.approvalRequestId) || null
      : rev.approvalRequestId
        ? approvals.find((a) => a.id === rev.approvalRequestId) || null
        : null,
    autonomyPolicy: policies.find((p) => p.brandId === rev.brandId) || null,
    emergencyStop,
    isSensitiveTopic: rev.escalationRequired || rev.rating <= 2,
    isPositiveReview: rev.rating >= 4,
  });

  if (!gateway.allowed) {
    throw new AppError(403, gateway.code || 'APPROVAL_REQUIRED', gateway.reason);
  }

  await store.commit([
    {
      path: revPath,
      data: { publishedReply: replyText, replyStatus: 'replied', repliedAt: now },
      updateMask: ['publishedReply', 'replyStatus', 'repliedAt', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordMarketingActivity(store, workspaceId, {
    brandId: rev.brandId,
    category: 'review',
    action: 'review.replied',
    summary: `Published approved reply to ${rev.reviewerName} (${rev.rating}★ on ${rev.platform}).`,
    status: 'success',
    resourceType: 'review',
    resourceId: rev.id,
    actorUid: uid,
  });

  return {
    review: { ...rev, publishedReply: replyText, replyStatus: 'replied', repliedAt: now },
    note: `Review reply authorized via Central Action Gateway (${gateway.decisionId}).`,
  };
}

export async function listLeads(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<LeadRecord[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'leads');
  return docs
    .map((d) => ({
      id: String(d.id),
      schemaVersion: '4.0.0' as const,
      workspaceId: String(d.workspaceId),
      brandId: String(d.brandId),
      fullName: String(d.fullName),
      companyName: d.companyName ? String(d.companyName) : undefined,
      email: d.email ? String(d.email) : undefined,
      phone: d.phone ? String(d.phone) : undefined,
      sourceChannel: (d.sourceChannel as LeadRecord['sourceChannel']) || 'manual',
      sourceConversationId: d.sourceConversationId ? String(d.sourceConversationId) : undefined,
      stage: (d.stage as LeadRecord['stage']) || 'NEW',
      consentStatus: (d.consentStatus as LeadRecord['consentStatus']) || 'inbound_inquiry_only',
      consentProvenance: String(d.consentProvenance || ''),
      assignedToUid: d.assignedToUid ? String(d.assignedToUid) : undefined,
      notes: d.notes ? String(d.notes) : undefined,
      nextFollowUpAt: d.nextFollowUpAt ? String(d.nextFollowUpAt) : undefined,
      activities: parseJsonField(d.activitiesJson, []),
      createdBy: String(d.createdBy || ''),
      createdAt: toIsoString(d.createdAt),
      updatedAt: toIsoString(d.updatedAt),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createLead(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    brandId: string;
    fullName: string;
    companyName?: string;
    email?: string;
    phone?: string;
    sourceChannel: LeadRecord['sourceChannel'];
    consentStatus: LeadRecord['consentStatus'];
    consentProvenance: string;
    notes?: string;
  },
  ctx: RepositoryContext = {},
): Promise<LeadRecord> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'leads:manage', ctx);
  const id = makeId('lead');
  const now = new Date().toISOString();
  const activities = [
    {
      id: makeId('lact'),
      type: 'note' as const,
      summary: `Lead created via ${input.sourceChannel} (consent: ${input.consentStatus}).`,
      actorUid: uid,
      createdAt: now,
    },
  ];
  await store.commit([
    {
      path: `workspaces/${workspaceId}/leads/${id}`,
      data: {
        id,
        schemaVersion: '4.0.0',
        workspaceId,
        brandId: input.brandId,
        fullName: input.fullName,
        companyName: input.companyName || '',
        email: input.email || '',
        phone: input.phone || '',
        sourceChannel: input.sourceChannel,
        stage: 'NEW',
        consentStatus: input.consentStatus,
        consentProvenance: input.consentProvenance,
        notes: input.notes || '',
        activitiesJson: JSON.stringify(activities),
        createdBy: uid,
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    },
  ]);

  await recordAuditLog(store, workspaceId, uid, userEmail, 'lead.created', 'lead', id, `Created lead "${input.fullName}"`);
  const list = await listLeads(uid, workspaceId, ctx);
  return list.find((l) => l.id === id)!;
}

export async function updateLead(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    leadId: string;
    stage?: LeadRecord['stage'];
    assignedToUid?: string;
    nextFollowUpAt?: string;
    activityNote?: string;
    activityType?: LeadRecord['activities'][number]['type'];
  },
  ctx: RepositoryContext = {},
): Promise<LeadRecord> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'leads:manage', ctx);
  const leads = await listLeads(uid, workspaceId, ctx);
  const lead = leads.find((l) => l.id === input.leadId);
  if (!lead) throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found.');

  if (input.activityType === 'approved_outreach') {
    const consentCheck = canPerformExternalLeadOutreach(lead);
    if (!consentCheck.allowed) {
      throw new AppError(403, 'AUTONOMY_POLICY_BLOCKED', consentCheck.reason);
    }
  }

  const now = new Date().toISOString();
  const nextActivities = [...lead.activities];
  if (input.stage && input.stage !== lead.stage) {
    nextActivities.push({
      id: makeId('lact'),
      type: 'stage_change',
      summary: `Stage moved from ${lead.stage} to ${input.stage}.`,
      actorUid: uid,
      createdAt: now,
    });
  }
  if (input.activityNote) {
    nextActivities.push({
      id: makeId('lact'),
      type: input.activityType || 'internal_followup_task',
      summary: input.activityNote,
      actorUid: uid,
      createdAt: now,
    });
  }

  await store.commit([
    {
      path: `workspaces/${workspaceId}/leads/${lead.id}`,
      data: {
        stage: input.stage ?? lead.stage,
        assignedToUid: input.assignedToUid ?? lead.assignedToUid ?? '',
        nextFollowUpAt: input.nextFollowUpAt ?? lead.nextFollowUpAt ?? '',
        activitiesJson: JSON.stringify(nextActivities),
      },
      updateMask: ['stage', 'assignedToUid', 'nextFollowUpAt', 'activitiesJson', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordAuditLog(store, workspaceId, uid, userEmail, 'lead.updated', 'lead', lead.id, `Updated lead "${lead.fullName}"`);
  const updatedList = await listLeads(uid, workspaceId, ctx);
  return updatedList.find((l) => l.id === lead.id)!;
}

export async function listCampaignsAndPolicies(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<{ campaigns: AdCampaignRecord[]; budgetPolicies: CampaignBudgetPolicy[] }> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const [campDocs, policyDocs] = await Promise.all([
    store.listWorkspaceSubcollection(workspaceId, 'adCampaigns'),
    store.listWorkspaceSubcollection(workspaceId, 'campaignBudgetPolicies'),
  ]);

  const campaigns: AdCampaignRecord[] = campDocs
    .map((d) => ({
      id: String(d.id),
      schemaVersion: '4.0.0' as const,
      workspaceId: String(d.workspaceId),
      brandId: String(d.brandId),
      provider: 'meta_ads' as const,
      accountId: d.accountId ? String(d.accountId) : undefined,
      externalCampaignId: d.externalCampaignId ? String(d.externalCampaignId) : undefined,
      name: String(d.name),
      objective: (d.objective as AdCampaignRecord['objective']) || 'leads',
      status: (d.status as AdCampaignRecord['status']) || 'draft_plan',
      dailyBudget: d.dailyBudget !== null && d.dailyBudget !== undefined ? Number(d.dailyBudget) : null,
      totalBudget: d.totalBudget !== null && d.totalBudget !== undefined ? Number(d.totalBudget) : null,
      currency: (d.currency as 'INR' | 'USD') || 'INR',
      audienceSummary: String(d.audienceSummary || ''),
      creativeBriefIds: Array.isArray(d.creativeBriefIds) ? d.creativeBriefIds.map(String) : [],
      approvalRequestId: d.approvalRequestId ? String(d.approvalRequestId) : undefined,
      lastSyncedSpend: d.lastSyncedSpend !== null && d.lastSyncedSpend !== undefined ? Number(d.lastSyncedSpend) : null,
      lastSyncedImpressions:
        d.lastSyncedImpressions !== null && d.lastSyncedImpressions !== undefined
          ? Number(d.lastSyncedImpressions)
          : null,
      lastSyncedClicks:
        d.lastSyncedClicks !== null && d.lastSyncedClicks !== undefined
          ? Number(d.lastSyncedClicks)
          : null,
      lastSyncedAt: d.lastSyncedAt ? toIsoString(d.lastSyncedAt) : undefined,
      createdBy: String(d.createdBy || ''),
      createdAt: toIsoString(d.createdAt),
      updatedAt: toIsoString(d.updatedAt),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const budgetPolicies: CampaignBudgetPolicy[] = policyDocs.map((d) => ({
    id: String(d.id),
    schemaVersion: '4.0.0',
    workspaceId: String(d.workspaceId),
    brandId: String(d.brandId),
    currency: (d.currency as 'INR' | 'USD') || 'INR',
    enabled: Boolean(d.enabled),
    maxDailySpend: d.maxDailySpend !== null && d.maxDailySpend !== undefined ? Number(d.maxDailySpend) : null,
    maxMonthlySpend:
      d.maxMonthlySpend !== null && d.maxMonthlySpend !== undefined ? Number(d.maxMonthlySpend) : null,
    requireExplicitOwnerApprovalForLaunch: true,
    ownerAuthorizedByUid: d.ownerAuthorizedByUid ? String(d.ownerAuthorizedByUid) : undefined,
    ownerAuthorizedAt: d.ownerAuthorizedAt ? toIsoString(d.ownerAuthorizedAt) : undefined,
    updatedBy: String(d.updatedBy || ''),
    updatedAt: toIsoString(d.updatedAt),
  }));

  return { campaigns, budgetPolicies };
}

export async function upsertCampaignBudgetPolicy(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    brandId: string;
    currency: 'INR' | 'USD';
    enabled: boolean;
    maxDailySpend: number | null;
    maxMonthlySpend: number | null;
    ownerExplicitAuthorization: boolean;
  },
  ctx: RepositoryContext = {},
): Promise<CampaignBudgetPolicy> {
  const { store, member } = await requireWorkspaceAccess(uid, workspaceId, 'campaigns:manage', ctx);
  if (input.enabled && (!input.maxDailySpend || !input.maxMonthlySpend)) {
    throw new AppError(
      400,
      'PAID_SPEND_NOT_AUTHORIZED',
      'Enabling paid advertising requires explicit positive numeric maxDailySpend and maxMonthlySpend limits.',
    );
  }
  if (input.ownerExplicitAuthorization && member.role !== 'owner' && member.role !== 'admin') {
    throw new AppError(403, 'FORBIDDEN', 'Only a workspace owner or administrator can authorize paid ad budget limits.');
  }

  const now = new Date().toISOString();
  await store.commit([
    {
      path: `workspaces/${workspaceId}/campaignBudgetPolicies/${input.brandId}`,
      data: {
        id: input.brandId,
        schemaVersion: '4.0.0',
        workspaceId,
        brandId: input.brandId,
        currency: input.currency,
        enabled: input.enabled,
        maxDailySpend: input.maxDailySpend,
        maxMonthlySpend: input.maxMonthlySpend,
        requireExplicitOwnerApprovalForLaunch: true,
        ownerAuthorizedByUid: input.ownerExplicitAuthorization ? uid : '',
        ownerAuthorizedAt: input.ownerExplicitAuthorization ? now : '',
        updatedBy: uid,
      },
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordAuditLog(
    store,
    workspaceId,
    uid,
    userEmail,
    'campaigns.budget_policy_updated',
    'campaign_budget_policy',
    input.brandId,
    `Updated paid budget policy for brand ${input.brandId} (enabled=${input.enabled}, daily=${input.maxDailySpend ?? 'none'}, monthly=${input.maxMonthlySpend ?? 'none'} ${input.currency}).`,
  );

  const { budgetPolicies } = await listCampaignsAndPolicies(uid, workspaceId, ctx);
  return budgetPolicies.find((p) => p.brandId === input.brandId)!;
}

export async function createAdCampaignDraft(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    brandId: string;
    accountId?: string;
    name: string;
    objective: AdCampaignRecord['objective'];
    dailyBudget: number | null;
    totalBudget: number | null;
    currency: 'INR' | 'USD';
    audienceSummary: string;
    creativeBriefIds?: string[];
    requestLaunchApproval?: boolean;
  },
  ctx: RepositoryContext = {},
): Promise<{
  campaign: AdCampaignRecord;
  dryRun: ReturnType<typeof validateMetaAdCampaignDryRun>;
  approvalRequest?: ApprovalRequestRecord;
}> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'campaigns:manage', ctx);
  const { budgetPolicies } = await listCampaignsAndPolicies(uid, workspaceId, ctx);
  const policy = budgetPolicies.find((p) => p.brandId === input.brandId);
  const dryRun = validateMetaAdCampaignDryRun(input, policy);

  const id = makeId('cmp');
  const payloadHash = computeContentPayloadHash({
    title: input.name,
    body: `${input.objective}|${input.dailyBudget}|${input.totalBudget}|${input.currency}|${input.audienceSummary}`,
    targetPlatforms: ['facebook'],
  });

  let approvalRequest: ApprovalRequestRecord | undefined;
  let status: AdCampaignRecord['status'] = dryRun.valid ? 'dry_run_validated' : 'draft_plan';

  if (input.requestLaunchApproval) {
    if (!dryRun.canLaunchLive) {
      throw new AppError(
        403,
        'PAID_SPEND_NOT_AUTHORIZED',
        dryRun.blockingReason || 'Cannot request live ad launch without valid budget policy & owner authorization.',
      );
    }
    approvalRequest = await createApprovalRequest(
      uid,
      userEmail,
      workspaceId,
      {
        brandId: input.brandId,
        actionType: 'paid_campaign_mutate',
        targetResourceType: 'campaign',
        targetResourceId: id,
        platform: 'meta_ads',
        accountId: input.accountId,
        payloadHash,
        summary: `Owner approval to launch Meta Ads campaign "${input.name}" (daily ${input.dailyBudget} ${input.currency})`,
        riskLevel: 'critical',
        estimatedSpendUsd: input.totalBudget || input.dailyBudget || undefined,
        requestedByType: 'human',
      },
      ctx,
    );
    status = 'pending_owner_approval';
  }

  await store.commit([
    {
      path: `workspaces/${workspaceId}/adCampaigns/${id}`,
      data: {
        id,
        schemaVersion: '4.0.0',
        workspaceId,
        brandId: input.brandId,
        provider: 'meta_ads',
        accountId: input.accountId || '',
        name: input.name,
        objective: input.objective,
        status,
        dailyBudget: input.dailyBudget,
        totalBudget: input.totalBudget,
        currency: input.currency,
        audienceSummary: input.audienceSummary,
        creativeBriefIds: input.creativeBriefIds || [],
        approvalRequestId: approvalRequest?.id || '',
        lastSyncedSpend: null,
        lastSyncedImpressions: null,
        lastSyncedClicks: null,
        createdBy: uid,
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    },
  ]);

  const { campaigns } = await listCampaignsAndPolicies(uid, workspaceId, ctx);
  return { campaign: campaigns.find((c) => c.id === id)!, dryRun, approvalRequest };
}

export async function listAnalyticsAndExperiments(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<{
  snapshots: AnalyticsSnapshotRecord[];
  summary: ReturnType<typeof aggregateAnalyticsSnapshots>;
  experiments: PerformanceExperimentRecord[];
}> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'analytics:read', ctx);
  const [snapDocs, expDocs] = await Promise.all([
    store.listWorkspaceSubcollection(workspaceId, 'analyticsSnapshots'),
    store.listWorkspaceSubcollection(workspaceId, 'performanceExperiments'),
  ]);

  const snapshots: AnalyticsSnapshotRecord[] = snapDocs
    .map((d) => ({
      id: String(d.id),
      schemaVersion: '4.0.0' as const,
      workspaceId: String(d.workspaceId),
      brandId: String(d.brandId),
      platform: d.platform as AnalyticsSnapshotRecord['platform'],
      accountId: d.accountId ? String(d.accountId) : undefined,
      contentItemId: d.contentItemId ? String(d.contentItemId) : undefined,
      externalObjectId: d.externalObjectId ? String(d.externalObjectId) : undefined,
      periodStart: String(d.periodStart),
      periodEnd: String(d.periodEnd),
      timezone: String(d.timezone || 'Asia/Kolkata'),
      sourceApi: String(d.sourceApi || ''),
      attributionNote: String(d.attributionNote || ''),
      dedupeKey: String(d.dedupeKey || ''),
      metrics: parseJsonField(d.metricsJson, {
        impressions: null,
        reach: null,
        engagements: null,
        clicks: null,
        videoViews: null,
        followersDelta: null,
        leadsAttributed: null,
        spendAmount: null,
        revenueAmount: null,
      }),
      units: parseJsonField(d.unitsJson, { engagementDefinition: 'likes + comments + shares' }),
      collectedAt: toIsoString(d.collectedAt),
    }))
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));

  const experiments: PerformanceExperimentRecord[] = expDocs
    .map((d) => ({
      id: String(d.id),
      schemaVersion: '4.0.0' as const,
      workspaceId: String(d.workspaceId),
      brandId: String(d.brandId),
      title: String(d.title),
      hypothesis: String(d.hypothesis),
      platform: d.platform as SocialPlatformId,
      primaryMetric: (d.primaryMetric as PerformanceExperimentRecord['primaryMetric']) || 'engagements',
      controlContentId: d.controlContentId ? String(d.controlContentId) : undefined,
      variantContentId: d.variantContentId ? String(d.variantContentId) : undefined,
      status: (d.status as PerformanceExperimentRecord['status']) || 'draft',
      minSampleSize: Number(d.minSampleSize || 100),
      observedControlValue:
        d.observedControlValue !== null && d.observedControlValue !== undefined
          ? Number(d.observedControlValue)
          : null,
      observedVariantValue:
        d.observedVariantValue !== null && d.observedVariantValue !== undefined
          ? Number(d.observedVariantValue)
          : null,
      confidenceNote: String(d.confidenceNote || ''),
      proposedMemoryId: d.proposedMemoryId ? String(d.proposedMemoryId) : undefined,
      createdBy: String(d.createdBy || ''),
      createdAt: toIsoString(d.createdAt),
      updatedAt: toIsoString(d.updatedAt),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return { snapshots, summary: aggregateAnalyticsSnapshots(snapshots), experiments };
}

export async function ingestAnalyticsSnapshot(
  uid: string,
  workspaceId: string,
  input: {
    brandId: string;
    platform: AnalyticsSnapshotRecord['platform'];
    accountId?: string;
    contentItemId?: string;
    externalObjectId?: string;
    periodStart: string;
    periodEnd: string;
    timezone: string;
    sourceApi: string;
    attributionNote: string;
    currency?: 'INR' | 'USD';
    engagementDefinition: string;
    metrics: AnalyticsSnapshotRecord['metrics'];
  },
  ctx: RepositoryContext = {},
): Promise<{ snapshot: AnalyticsSnapshotRecord; duplicateIgnored: boolean }> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'content:write', ctx);
  const { snapshots } = await listAnalyticsAndExperiments(uid, workspaceId, ctx);
  const dedupeKey = buildAnalyticsSnapshotDedupeKey({
    workspaceId,
    brandId: input.brandId,
    platform: input.platform,
    externalObjectId: input.externalObjectId,
    contentItemId: input.contentItemId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  });

  const check = validateAnalyticsSnapshotInput({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    existingSnapshots: snapshots,
    dedupeKey,
    currency: input.currency,
    spendAmount: input.metrics.spendAmount,
    revenueAmount: input.metrics.revenueAmount,
  });
  if (!check.valid) {
    throw new AppError(400, 'INVALID_ANALYTICS_SNAPSHOT', check.errors.join(' '));
  }
  if (check.isDuplicate) {
    const existing = snapshots.find((s) => s.dedupeKey === dedupeKey)!;
    return { snapshot: existing, duplicateIgnored: true };
  }

  const id = makeId('snap');
  const now = new Date().toISOString();
  await store.commit([
    {
      path: `workspaces/${workspaceId}/analyticsSnapshots/${id}`,
      data: {
        id,
        schemaVersion: '4.0.0',
        workspaceId,
        brandId: input.brandId,
        platform: input.platform,
        accountId: input.accountId || '',
        contentItemId: input.contentItemId || '',
        externalObjectId: input.externalObjectId || '',
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        timezone: input.timezone,
        sourceApi: input.sourceApi,
        attributionNote: input.attributionNote,
        dedupeKey,
        metricsJson: JSON.stringify(input.metrics),
        unitsJson: JSON.stringify({
          ...(input.currency ? { currency: input.currency } : {}),
          engagementDefinition: input.engagementDefinition,
        }),
      },
      serverTimestampFields: ['collectedAt'],
    },
  ]);

  return {
    duplicateIgnored: false,
    snapshot: {
      id,
      schemaVersion: '4.0.0',
      workspaceId,
      brandId: input.brandId,
      platform: input.platform,
      accountId: input.accountId,
      contentItemId: input.contentItemId,
      externalObjectId: input.externalObjectId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      timezone: input.timezone,
      sourceApi: input.sourceApi,
      attributionNote: input.attributionNote,
      dedupeKey,
      metrics: input.metrics,
      units: {
        ...(input.currency ? { currency: input.currency } : {}),
        engagementDefinition: input.engagementDefinition,
      },
      collectedAt: now,
    },
  };
}

export async function createOrEvaluateExperiment(
  uid: string,
  workspaceId: string,
  input:
    | {
        mode: 'create';
        brandId: string;
        title: string;
        hypothesis: string;
        platform: SocialPlatformId;
        primaryMetric: PerformanceExperimentRecord['primaryMetric'];
        controlContentId?: string;
        variantContentId?: string;
        minSampleSize: number;
      }
    | { mode: 'evaluate'; experimentId: string },
  ctx: RepositoryContext = {},
): Promise<{ experiment: PerformanceExperimentRecord; candidateMemoryId?: string }> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'content:write', ctx);

  if (input.mode === 'create') {
    const id = makeId('exp');
    const now = new Date().toISOString();
    await store.commit([
      {
        path: `workspaces/${workspaceId}/performanceExperiments/${id}`,
        data: {
          id,
          schemaVersion: '4.0.0',
          workspaceId,
          brandId: input.brandId,
          title: input.title,
          hypothesis: input.hypothesis,
          platform: input.platform,
          primaryMetric: input.primaryMetric,
          controlContentId: input.controlContentId || '',
          variantContentId: input.variantContentId || '',
          status: 'running',
          minSampleSize: input.minSampleSize,
          observedControlValue: null,
          observedVariantValue: null,
          confidenceNote: 'Awaiting analytics snapshots for control and variant content.',
          createdBy: uid,
        },
        serverTimestampFields: ['createdAt', 'updatedAt'],
      },
    ]);
    return {
      experiment: {
        id,
        schemaVersion: '4.0.0',
        workspaceId,
        brandId: input.brandId,
        title: input.title,
        hypothesis: input.hypothesis,
        platform: input.platform,
        primaryMetric: input.primaryMetric,
        controlContentId: input.controlContentId,
        variantContentId: input.variantContentId,
        status: 'running',
        minSampleSize: input.minSampleSize,
        observedControlValue: null,
        observedVariantValue: null,
        confidenceNote: 'Awaiting analytics snapshots for control and variant content.',
        createdBy: uid,
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  const { snapshots, experiments } = await listAnalyticsAndExperiments(uid, workspaceId, ctx);
  const exp = experiments.find((e) => e.id === input.experimentId);
  if (!exp) throw new AppError(404, 'EXPERIMENT_NOT_FOUND', 'Experiment not found.');

  const evaluated = evaluateExperimentAndBuildCandidateMemory(exp, snapshots, uid);
  let candidateMemoryId = exp.proposedMemoryId;
  const ops: Parameters<DataStore['commit']>[0] = [];

  if (evaluated.candidateMemory && !candidateMemoryId) {
    candidateMemoryId = makeId('mem');
    ops.push({
      path: `workspaces/${workspaceId}/brandMemory/${candidateMemoryId}`,
      data: {
        id: candidateMemoryId,
        ...evaluated.candidateMemory,
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    });
  }

  ops.push({
    path: `workspaces/${workspaceId}/performanceExperiments/${exp.id}`,
    data: {
      status: evaluated.status,
      observedControlValue: evaluated.observedControlValue,
      observedVariantValue: evaluated.observedVariantValue,
      confidenceNote: evaluated.confidenceNote,
      proposedMemoryId: candidateMemoryId || '',
    },
    updateMask: [
      'status', 'observedControlValue', 'observedVariantValue',
      'confidenceNote', 'proposedMemoryId', 'updatedAt',
    ],
    serverTimestampFields: ['updatedAt'],
  });

  await store.commit(ops);

  return {
    experiment: {
      ...exp,
      status: evaluated.status,
      observedControlValue: evaluated.observedControlValue,
      observedVariantValue: evaluated.observedVariantValue,
      confidenceNote: evaluated.confidenceNote,
      proposedMemoryId: candidateMemoryId,
    },
    candidateMemoryId,
  };
}

export async function listMarketingActivities(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<MarketingActivityItem[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'marketingActivities');
  return docs
    .map((d) => ({
      id: String(d.id),
      workspaceId: String(d.workspaceId),
      brandId: d.brandId ? String(d.brandId) : undefined,
      category: (d.category as MarketingActivityItem['category']) || 'content',
      action: String(d.action),
      summary: String(d.summary),
      status: (d.status as MarketingActivityItem['status']) || 'success',
      resourceType: String(d.resourceType || ''),
      resourceId: String(d.resourceId || ''),
      actorUid: String(d.actorUid || ''),
      createdAt: toIsoString(d.createdAt),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function persistWebhookEvent(
  event: Omit<WebhookEventRecord, 'id' | 'schemaVersion' | 'receivedAt'>,
  ctx: RepositoryContext = {},
): Promise<{ record: WebhookEventRecord; duplicateIgnored: boolean }> {
  let store: DataStore;
  try {
    store = getStore(ctx);
  } catch {
    const now = new Date().toISOString();
    return {
      duplicateIgnored: false,
      record: { id: makeId('whev'), schemaVersion: '4.0.0', receivedAt: now, ...event },
    };
  }

  const targetWorkspace = event.workspaceId || 'global_webhooks';
  const existing = event.workspaceId
    ? await store.listWorkspaceSubcollection(event.workspaceId, 'webhookEvents').catch(() => [])
    : [];
  const dup = existing.find((d) => String(d.dedupeKey) === event.dedupeKey);
  if (dup) {
    return {
      duplicateIgnored: true,
      record: {
        id: String(dup.id),
        schemaVersion: '4.0.0',
        workspaceId: event.workspaceId,
        provider: event.provider,
        eventType: String(dup.eventType),
        dedupeKey: String(dup.dedupeKey),
        signatureVerified: Boolean(dup.signatureVerified),
        payloadHash: String(dup.payloadHash),
        payloadSummary: String(dup.payloadSummary),
        status: 'duplicate_ignored',
        receivedAt: toIsoString(dup.receivedAt),
      },
    };
  }

  const id = makeId('whev');
  const now = new Date().toISOString();
  if (event.workspaceId) {
    await store.commit([
      {
        path: `workspaces/${targetWorkspace}/webhookEvents/${id}`,
        data: {
          id,
          schemaVersion: '4.0.0',
          workspaceId: event.workspaceId,
          provider: event.provider,
          eventType: event.eventType,
          dedupeKey: event.dedupeKey,
          signatureVerified: event.signatureVerified,
          payloadHash: event.payloadHash,
          payloadSummary: event.payloadSummary,
          status: event.status,
        },
        serverTimestampFields: ['receivedAt'],
      },
    ]);
  }
  return {
    duplicateIgnored: false,
    record: { id, schemaVersion: '4.0.0', receivedAt: now, ...event },
  };
}

export async function getWorkspaceMarketingOverviewData(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
) {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'marketing:read', ctx);
  const [
    brands,
    objectives,
    contentItems,
    accounts,
    scheduledPosts,
    approvals,
    policies,
    emergencyStop,
    conversations,
    reviews,
    leads,
    analytics,
  ] = await Promise.all([
    listBrands(uid, workspaceId, ctx),
    listGrowthObjectives(uid, workspaceId, ctx),
    listMarketingContent(uid, workspaceId, ctx),
    listConnectedSocialAccounts(uid, workspaceId, ctx),
    listScheduledPosts(uid, workspaceId, ctx),
    listApprovalRequests(uid, workspaceId, ctx),
    listBrandAutonomyPolicies(uid, workspaceId, ctx),
    getWorkspaceEmergencyStop(store, workspaceId),
    listSocialConversations(uid, workspaceId, ctx),
    listReviews(uid, workspaceId, ctx),
    listLeads(uid, workspaceId, ctx),
    listAnalyticsAndExperiments(uid, workspaceId, ctx),
  ]);

  return {
    overview: buildWorkspaceMarketingOverview({
      brands: brands as BrandProfile[],
      objectives,
      contentItems,
      accounts,
      scheduledPosts,
      approvals,
      policies,
      emergencyStop,
      conversations,
      reviews,
      leads,
      snapshots: analytics.snapshots,
    }),
    objectives,
    capabilityMatrix: buildPhase4CapabilityMatrix(accounts),
  };
}
