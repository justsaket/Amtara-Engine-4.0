import crypto from 'node:crypto';
import type {
  ApprovalRequestRecord,
  BrandAutonomyPolicy,
  BrandKnowledgeFact,
  BrandProfile,
  ConnectedSocialAccount,
  GoogleConnectionRecord,
  SocialPlatformId,
} from '@/types/domain';
import type {
  AutopilotDashboardCounts,
  AutopilotDriveFileRecord,
  AutopilotExecutionEvent,
  AutopilotGeneratedMetadata,
  AutopilotJobRecord,
  AutopilotPolicy,
  DriveFolderItem,
} from '@/types/autopilot';
import { AppError } from './error-handler';
import {
  getStore,
  listBrands,
  requireWorkspaceAccess,
  type DataStore,
  type RepositoryContext,
} from './repositories';
import {
  listWorkspaceGoogleConnections,
  resolveConnectionAndAccessToken,
  type Phase2ExecutionContext,
} from './phase2-repositories';
import {
  createApprovalRequest,
  decideApprovalRequest,
  getWorkspaceEmergencyStop,
  readDecryptedSocialAccessToken,
} from './phase4-repositories';
import { getValidGoogleAccessToken } from '@/lib/google/oauth';
import { getPlatformGoogleOAuthCredentials } from './platform-oauth';
import {
  downloadDriveMediaBytes,
  getDriveStartPageToken,
  listDriveFolders,
  MAX_INLINE_MULTIMODAL_BYTES,
  reconcileDriveSnapshot,
  registerDriveChangesWatch,
  scanDriveFolderRecursive,
  verifyDriveFolderAccess,
} from '@/lib/autopilot/drive-monitor';
import {
  analyzeVideoAndGenerateMetadata,
  computeAutopilotMetadataPayloadHash,
  computeMetadataFingerprint,
  type AutopilotVideoAnalyzerAdapter,
  type TestVideoMultimodalFixture,
} from '@/lib/autopilot/video-analyzer';
import {
  claimAutopilotJobLease,
  getLocalDateKey,
  planAutopilotScheduleBatch,
  recalculateFutureSlotsAfterFailure,
  recoverStaleAutopilotLeases,
} from '@/lib/autopilot/scheduler';
import {
  buildAutopilotDashboardCounts,
  executeAutopilotPublishJob,
} from '@/lib/autopilot/engine';
import type { SocialPublishingAdapter } from '@/lib/marketing/providers/types';

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
}

function cleanRecord<T extends object>(obj: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
}

function asArray<T>(rows: Record<string, unknown>[]): T[] {
  return rows as unknown as T[];
}

async function saveDoc(store: DataStore, path: string, data: Record<string, unknown>): Promise<void> {
  await store.commit([{ path, data }]);
}

async function removeDoc(store: DataStore, path: string): Promise<void> {
  await store.commit([{ path, delete: true }]);
}

export async function recordAutopilotEvent(
  store: DataStore,
  event: Omit<AutopilotExecutionEvent, 'id' | 'schemaVersion' | 'createdAt'> & {
    createdAt?: string;
  },
): Promise<AutopilotExecutionEvent> {
  const rec: AutopilotExecutionEvent = {
    id: makeId('ape'),
    schemaVersion: '5.1.0',
    workspaceId: event.workspaceId,
    policyId: event.policyId,
    fileRecordId: event.fileRecordId,
    jobId: event.jobId,
    eventType: event.eventType,
    status: event.status,
    summary: event.summary.slice(0, 300),
    detailJson: event.detailJson ? event.detailJson.slice(0, 4000) : undefined,
    actorUid: event.actorUid,
    createdAt: event.createdAt || new Date().toISOString(),
  };
  await saveDoc(
    store,
    `workspaces/${event.workspaceId}/autopilotEvents/${rec.id}`,
    cleanRecord(rec),
  );
  return rec;
}

export async function listAutopilotPolicies(
  store: DataStore,
  workspaceId: string,
): Promise<AutopilotPolicy[]> {
  const rows = await store.listWorkspaceSubcollection(workspaceId, 'autopilotPolicies');
  return asArray<AutopilotPolicy>(rows).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export async function getAutopilotPolicy(
  store: DataStore,
  workspaceId: string,
  policyId: string,
): Promise<AutopilotPolicy | null> {
  const doc = await store.getDoc(`workspaces/${workspaceId}/autopilotPolicies/${policyId}`);
  return doc ? (doc as unknown as AutopilotPolicy) : null;
}

export async function listAutopilotFiles(
  store: DataStore,
  workspaceId: string,
  policyId?: string,
): Promise<AutopilotDriveFileRecord[]> {
  const rows = await store.listWorkspaceSubcollection(workspaceId, 'autopilotFiles');
  const all = asArray<AutopilotDriveFileRecord>(rows);
  const filtered = policyId ? all.filter((f) => f.policyId === policyId) : all;
  return filtered.sort((a, b) => Date.parse(b.discoveredAt) - Date.parse(a.discoveredAt));
}

export async function listAutopilotJobs(
  store: DataStore,
  workspaceId: string,
  policyId?: string,
): Promise<AutopilotJobRecord[]> {
  const rows = await store.listWorkspaceSubcollection(workspaceId, 'autopilotJobs');
  const all = asArray<AutopilotJobRecord>(rows);
  const filtered = policyId ? all.filter((j) => j.policyId === policyId) : all;
  return filtered.sort((a, b) => Date.parse(a.scheduledForUtc) - Date.parse(b.scheduledForUtc));
}

export async function listAutopilotEvents(
  store: DataStore,
  workspaceId: string,
  policyId?: string,
): Promise<AutopilotExecutionEvent[]> {
  const rows = await store.listWorkspaceSubcollection(workspaceId, 'autopilotEvents');
  const all = asArray<AutopilotExecutionEvent>(rows);
  const filtered = policyId ? all.filter((e) => e.policyId === policyId) : all;
  return filtered.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function getAutopilotDashboardSnapshot(
  uid: string,
  workspaceId: string,
  ctx?: Phase2ExecutionContext,
): Promise<{
  policies: AutopilotPolicy[];
  files: AutopilotDriveFileRecord[];
  jobs: AutopilotJobRecord[];
  events: AutopilotExecutionEvent[];
  countsByPolicy: Record<string, AutopilotDashboardCounts>;
  googleConnections: GoogleConnectionRecord[];
  socialAccounts: ConnectedSocialAccount[];
  brands: BrandProfile[];
}> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'workspace:read', ctx);
  const [policies, files, jobs, events, googleData, socialRaw, brands] = await Promise.all([
    listAutopilotPolicies(store, workspaceId),
    listAutopilotFiles(store, workspaceId),
    listAutopilotJobs(store, workspaceId),
    listAutopilotEvents(store, workspaceId),
    listWorkspaceGoogleConnections(uid, workspaceId, ctx),
    store.listWorkspaceSubcollection(workspaceId, 'socialAccounts'),
    listBrands(uid, workspaceId, ctx),
  ]);

  const socialAccounts = asArray<ConnectedSocialAccount>(socialRaw);
  const nowIso = new Date().toISOString();
  const countsByPolicy: Record<string, AutopilotDashboardCounts> = {};
  for (const policy of policies) {
    countsByPolicy[policy.id] = buildAutopilotDashboardCounts({
      policy,
      files,
      jobs,
      nowIso,
    });
  }

  return {
    policies,
    files,
    jobs,
    events,
    countsByPolicy,
    googleConnections: googleData.connections,
    socialAccounts,
    brands,
  };
}

export async function listAuthorizedDriveFoldersForPicker(
  uid: string,
  workspaceId: string,
  params: {
    connectionId?: string;
    query?: string;
    parentFolderId?: string;
  },
  ctx?: Phase2ExecutionContext,
): Promise<{ connection: GoogleConnectionRecord; folders: DriveFolderItem[] }> {
  const { connection, accessToken, scopes } = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'workspace:read',
    preferredConnectionId: params.connectionId,
    ctx,
  });

  const hasDriveScope = scopes.some(
    (s) =>
      s === 'https://www.googleapis.com/auth/drive.readonly' ||
      s === 'https://www.googleapis.com/auth/drive',
  );
  if (!hasDriveScope) {
    throw new AppError(
      403,
      'DRIVE_READ_SCOPE_MISSING',
      'Connected Google account has not granted Drive Read-Only access yet. Authorize Google Drive Autopilot access first.',
    );
  }

  const folders = await listDriveFolders({
    accessToken,
    query: params.query,
    parentFolderId: params.parentFolderId,
    fetchImpl: ctx?.fetchImpl,
  });

  return { connection, folders };
}

export async function createAutopilotPolicy(
  uid: string,
  workspaceId: string,
  input: Omit<
    AutopilotPolicy,
    'id' | 'schemaVersion' | 'workspaceId' | 'status' | 'createdBy' | 'updatedBy' | 'createdAt' | 'updatedAt' | 'sourceFolderName'
  > & { sourceFolderName?: string },
  ctx?: Phase2ExecutionContext,
): Promise<AutopilotPolicy> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'publishing:schedule', ctx);

  const brands = await listBrands(uid, workspaceId, ctx);
  const brand = brands.find((b) => b.id === input.brandId);
  if (!brand) {
    throw new AppError(404, 'BRAND_NOT_FOUND', `Brand "${input.brandId}" not found in workspace.`);
  }

  let resolvedFolderName = input.sourceFolderName?.trim() || input.sourceFolderId;
  let startPageToken: string | undefined;

  const { accessToken, scopes } = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'publishing:schedule',
    preferredConnectionId: input.googleConnectionId,
    ctx,
  });

  const hasDriveScope = scopes.some(
    (s) =>
      s === 'https://www.googleapis.com/auth/drive.readonly' ||
      s === 'https://www.googleapis.com/auth/drive',
  );
  if (!hasDriveScope) {
    throw new AppError(
      403,
      'DRIVE_READ_SCOPE_MISSING',
      'The selected Google connection is missing Google Drive Read-Only authorization (`drive.readonly`). Grant Drive Autopilot scope first.',
    );
  }

  const folderInfo = await verifyDriveFolderAccess({
    accessToken,
    folderId: input.sourceFolderId,
    fetchImpl: ctx?.fetchImpl,
  });
  resolvedFolderName = folderInfo.name || resolvedFolderName;
  startPageToken = await getDriveStartPageToken({
    accessToken,
    fetchImpl: ctx?.fetchImpl,
  }).catch(() => undefined);

  const nowIso = new Date().toISOString();
  const policyId = makeId('appol');
  const policy: AutopilotPolicy = {
    id: policyId,
    schemaVersion: '5.1.0',
    workspaceId,
    brandId: input.brandId,
    name: input.name,
    googleConnectionId: input.googleConnectionId,
    sourceFolderId: input.sourceFolderId,
    sourceFolderName: resolvedFolderName,
    includeSubfolders: input.includeSubfolders,
    maxSubfolderDepth: input.maxSubfolderDepth,
    destinationAccountIds: input.destinationAccountIds,
    allowedFormats: input.allowedFormats,
    maxPostsPerDay: input.maxPostsPerDay,
    minGapMinutes: input.minGapMinutes,
    publishingDays: input.publishingDays,
    dailyTimeWindows: input.dailyTimeWindows,
    timezone: input.timezone,
    orderingMode: input.orderingMode,
    language: input.language,
    captionStyle: input.captionStyle,
    hashtagStrategy: input.hashtagStrategy,
    maxHashtags: input.maxHashtags,
    executionMode: input.executionMode,
    authorizedAutoPublishAccountIds: input.authorizedAutoPublishAccountIds.filter((id) =>
      input.destinationAccountIds.includes(id),
    ),
    duplicatePrevention: input.duplicatePrevention,
    maxProcessingCostUsdPerDay: input.maxProcessingCostUsdPerDay,
    failurePolicy: input.failurePolicy,
    status: 'active',
    driveChangePageToken: startPageToken,
    createdBy: uid,
    updatedBy: uid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await saveDoc(
    store,
    `workspaces/${workspaceId}/autopilotPolicies/${policyId}`,
    cleanRecord(policy),
  );

  await recordAutopilotEvent(store, {
    workspaceId,
    policyId,
    eventType: 'policy_created',
    status: 'ok',
    summary: `Configured Drive Autopilot policy "${policy.name}" watching folder "${resolvedFolderName}" (${policy.executionMode}, max ${policy.maxPostsPerDay}/day).`,
    actorUid: uid,
  });

  return policy;
}

export async function updateAutopilotPolicy(
  uid: string,
  workspaceId: string,
  policyId: string,
  patch: {
    action?: 'update' | 'pause' | 'resume';
    pauseReason?: string;
    name?: string;
    includeSubfolders?: boolean;
    maxSubfolderDepth?: number;
    destinationAccountIds?: string[];
    allowedFormats?: AutopilotPolicy['allowedFormats'];
    maxPostsPerDay?: number;
    minGapMinutes?: number;
    publishingDays?: number[];
    dailyTimeWindows?: AutopilotPolicy['dailyTimeWindows'];
    timezone?: string;
    orderingMode?: AutopilotPolicy['orderingMode'];
    language?: string;
    captionStyle?: string;
    hashtagStrategy?: AutopilotPolicy['hashtagStrategy'];
    maxHashtags?: number;
    executionMode?: AutopilotPolicy['executionMode'];
    authorizedAutoPublishAccountIds?: string[];
    maxProcessingCostUsdPerDay?: number;
    failurePolicy?: AutopilotPolicy['failurePolicy'];
  },
  ctx?: RepositoryContext,
): Promise<AutopilotPolicy> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'publishing:schedule', ctx);
  const existing = await getAutopilotPolicy(store, workspaceId, policyId);
  if (!existing) {
    throw new AppError(404, 'AUTOPILOT_POLICY_NOT_FOUND', 'Autopilot policy not found.');
  }

  const nowIso = new Date().toISOString();
  const nextDestinations = patch.destinationAccountIds ?? existing.destinationAccountIds;
  const nextAuthorized = (
    patch.authorizedAutoPublishAccountIds ?? existing.authorizedAutoPublishAccountIds
  ).filter((id) => nextDestinations.includes(id));

  let nextStatus = existing.status;
  let nextPauseReason = existing.pauseReason;
  let eventType: AutopilotExecutionEvent['eventType'] = 'policy_updated';
  let eventSummary = `Updated Drive Autopilot policy "${patch.name || existing.name}".`;

  if (patch.action === 'pause') {
    nextStatus = 'paused';
    nextPauseReason = patch.pauseReason || 'Paused manually by workspace operator.';
    eventType = 'policy_paused';
    eventSummary = `Paused Drive Autopilot policy "${existing.name}": ${nextPauseReason}`;
  } else if (patch.action === 'resume') {
    nextStatus = 'active';
    nextPauseReason = undefined;
    eventType = 'policy_resumed';
    eventSummary = `Resumed Drive Autopilot policy "${existing.name}".`;
  }

  const updated: AutopilotPolicy = {
    ...existing,
    name: patch.name ?? existing.name,
    includeSubfolders: patch.includeSubfolders ?? existing.includeSubfolders,
    maxSubfolderDepth: patch.maxSubfolderDepth ?? existing.maxSubfolderDepth,
    destinationAccountIds: nextDestinations,
    allowedFormats: patch.allowedFormats ?? existing.allowedFormats,
    maxPostsPerDay: patch.maxPostsPerDay ?? existing.maxPostsPerDay,
    minGapMinutes: patch.minGapMinutes ?? existing.minGapMinutes,
    publishingDays: patch.publishingDays ?? existing.publishingDays,
    dailyTimeWindows: patch.dailyTimeWindows ?? existing.dailyTimeWindows,
    timezone: patch.timezone ?? existing.timezone,
    orderingMode: patch.orderingMode ?? existing.orderingMode,
    language: patch.language ?? existing.language,
    captionStyle: patch.captionStyle ?? existing.captionStyle,
    hashtagStrategy: patch.hashtagStrategy ?? existing.hashtagStrategy,
    maxHashtags: patch.maxHashtags ?? existing.maxHashtags,
    executionMode: patch.executionMode ?? existing.executionMode,
    authorizedAutoPublishAccountIds: nextAuthorized,
    maxProcessingCostUsdPerDay:
      patch.maxProcessingCostUsdPerDay ?? existing.maxProcessingCostUsdPerDay,
    failurePolicy: patch.failurePolicy ?? existing.failurePolicy,
    status: nextStatus,
    pauseReason: nextPauseReason,
    updatedBy: uid,
    updatedAt: nowIso,
  };

  await saveDoc(
    store,
    `workspaces/${workspaceId}/autopilotPolicies/${policyId}`,
    cleanRecord(updated),
  );

  const scheduleChanged =
    patch.maxPostsPerDay !== undefined ||
    patch.minGapMinutes !== undefined ||
    patch.publishingDays !== undefined ||
    patch.dailyTimeWindows !== undefined ||
    patch.timezone !== undefined ||
    patch.orderingMode !== undefined;

  if (scheduleChanged) {
    const jobs = await listAutopilotJobs(store, workspaceId, policyId);
    const pending = jobs.filter((j) => j.status === 'scheduled' || j.status === 'awaiting_approval');
    const fixed = jobs.filter((j) => j.status === 'published' || j.status === 'running' || j.status === 'claimed');
    const recalculated = recalculateFutureSlotsAfterFailure({
      policy: updated,
      pendingJobs: pending,
      publishedOrFixedJobs: fixed,
      fromIsoUtc: nowIso,
    });
    for (const job of recalculated) {
      await saveDoc(store, `workspaces/${workspaceId}/autopilotJobs/${job.id}`, cleanRecord(job));
    }
    if (recalculated.length > 0) {
      await recordAutopilotEvent(store, {
        workspaceId,
        policyId,
        eventType: 'job_slots_recalculated',
        status: 'ok',
        summary: `Recalculated ${recalculated.length} future scheduled slots after policy schedule update.`,
        actorUid: uid,
      });
    }
  }

  await recordAutopilotEvent(store, {
    workspaceId,
    policyId,
    eventType,
    status: 'ok',
    summary: eventSummary,
    actorUid: uid,
  });

  return updated;
}

export async function removeAutopilotPolicy(
  uid: string,
  workspaceId: string,
  policyId: string,
  ctx?: RepositoryContext,
): Promise<{ deleted: true; cancelledJobsCount: number }> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'publishing:schedule', ctx);
  const existing = await getAutopilotPolicy(store, workspaceId, policyId);
  if (!existing) {
    throw new AppError(404, 'AUTOPILOT_POLICY_NOT_FOUND', 'Autopilot policy not found.');
  }

  const nowIso = new Date().toISOString();
  const jobs = await listAutopilotJobs(store, workspaceId, policyId);
  let cancelledJobsCount = 0;
  for (const job of jobs) {
    if (
      job.status === 'scheduled' ||
      job.status === 'awaiting_approval' ||
      job.status === 'queued' ||
      job.status === 'paused'
    ) {
      await saveDoc(
        store,
        `workspaces/${workspaceId}/autopilotJobs/${job.id}`,
        cleanRecord({
          ...job,
          status: 'cancelled',
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          updatedAt: nowIso,
        }),
      );
      cancelledJobsCount += 1;
    }
  }

  await removeDoc(store, `workspaces/${workspaceId}/autopilotPolicies/${policyId}`);
  await recordAutopilotEvent(store, {
    workspaceId,
    policyId,
    eventType: 'policy_removed',
    status: 'warning',
    summary: `Removed Drive source folder policy "${existing.name}" (${existing.sourceFolderName}) and cancelled ${cancelledJobsCount} pending jobs.`,
    actorUid: uid,
  });

  return { deleted: true, cancelledJobsCount };
}

export async function performAutopilotFileAction(
  uid: string,
  userEmail: string,
  workspaceId: string,
  fileId: string,
  input: {
    action:
      | 'edit_metadata'
      | 'approve'
      | 'skip'
      | 'unskip'
      | 'retry_failed_jobs'
      | 'request_reprocess'
      | 'set_priority';
    priority?: number;
    note?: string;
    metadata?: Partial<AutopilotGeneratedMetadata>;
  },
  ctx?: RepositoryContext,
): Promise<{ file: AutopilotDriveFileRecord; updatedJobsCount: number }> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'content:write', ctx);
  const raw = await store.getDoc(`workspaces/${workspaceId}/autopilotFiles/${fileId}`);
  if (!raw) {
    throw new AppError(404, 'AUTOPILOT_FILE_NOT_FOUND', 'Autopilot file record not found.');
  }
  const file = raw as unknown as AutopilotDriveFileRecord;
  const policy = await getAutopilotPolicy(store, workspaceId, file.policyId);
  if (!policy) {
    throw new AppError(404, 'AUTOPILOT_POLICY_NOT_FOUND', 'Parent autopilot policy not found.');
  }

  const nowIso = new Date().toISOString();
  const jobs = (await listAutopilotJobs(store, workspaceId, policy.id)).filter(
    (j) => j.fileRecordId === file.id,
  );
  let updatedFile: AutopilotDriveFileRecord = { ...file, updatedAt: nowIso };
  let updatedJobsCount = 0;

  if (input.action === 'edit_metadata') {
    if (!file.generatedMetadata) {
      throw new AppError(400, 'METADATA_NOT_READY', 'Video has no generated metadata to edit yet.');
    }
    const mergedBase: Omit<AutopilotGeneratedMetadata, 'metadataFingerprint'> = {
      ...file.generatedMetadata,
      ...input.metadata,
      editedByUser: true,
      editedAt: nowIso,
    };
    const nextMeta: AutopilotGeneratedMetadata = {
      ...mergedBase,
      metadataFingerprint: computeMetadataFingerprint(mergedBase),
    };
    const nextPayloadHash = computeAutopilotMetadataPayloadHash({
      driveFileId: file.driveFileId,
      brandId: file.brandId,
      destinationAccountIds: policy.destinationAccountIds,
      metadata: nextMeta,
    });
    const approvalInvalidated = Boolean(
      file.approvedPayloadHash && file.approvedPayloadHash !== nextPayloadHash,
    );

    updatedFile = {
      ...updatedFile,
      generatedMetadata: nextMeta,
      payloadHash: nextPayloadHash,
      approvedPayloadHash: approvalInvalidated ? undefined : file.approvedPayloadHash,
      status:
        approvalInvalidated && policy.executionMode === 'APPROVAL_REQUIRED'
          ? 'awaiting_approval'
          : file.status,
    };

    for (const job of jobs) {
      if (job.status === 'scheduled' || job.status === 'awaiting_approval' || job.status === 'failed') {
        await saveDoc(
          store,
          `workspaces/${workspaceId}/autopilotJobs/${job.id}`,
          cleanRecord({
            ...job,
            payloadHash: nextPayloadHash,
            status:
              approvalInvalidated && policy.executionMode === 'APPROVAL_REQUIRED'
                ? 'awaiting_approval'
                : job.status,
            updatedAt: nowIso,
          }),
        );
        updatedJobsCount += 1;
      }
    }

    await recordAutopilotEvent(store, {
      workspaceId,
      policyId: policy.id,
      fileRecordId: file.id,
      eventType: 'metadata_edited',
      status: 'ok',
      summary: `Edited generated metadata for "${file.name}"${approvalInvalidated ? ' (prior approval invalidated — re-approval required)' : ''}.`,
      actorUid: uid,
    });
  } else if (input.action === 'approve') {
    if (!file.generatedMetadata || !file.payloadHash) {
      throw new AppError(400, 'METADATA_NOT_READY', 'Video metadata must be generated before approval.');
    }
    const primaryJob = jobs[0];
    const approval = await createApprovalRequest(
      uid,
      userEmail,
      workspaceId,
      {
        brandId: file.brandId,
        actionType: 'publish_post',
        targetResourceType: 'scheduled_post',
        targetResourceId: primaryJob?.id || file.id,
        platform: primaryJob?.platform,
        accountId: primaryJob?.accountId,
        payloadHash: file.payloadHash,
        summary: `Drive Autopilot video "${file.name}" — ${file.generatedMetadata.contentTitle}`,
        riskLevel: 'medium',
        requestedByType: 'human',
      },
      ctx,
    );
    await decideApprovalRequest(
      uid,
      userEmail,
      workspaceId,
      approval.id,
      { action: 'approve', note: input.note || 'Approved from Drive Autopilot dashboard.' },
      ctx,
    );

    updatedFile = {
      ...updatedFile,
      approvalRequestId: approval.id,
      approvedPayloadHash: file.payloadHash,
      status: jobs.length > 0 ? 'scheduled' : 'analyzed',
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
    };

    for (const job of jobs) {
      if (job.status === 'awaiting_approval' || job.status === 'paused') {
        await saveDoc(
          store,
          `workspaces/${workspaceId}/autopilotJobs/${job.id}`,
          cleanRecord({
            ...job,
            status: 'scheduled',
            approvalRequestId: approval.id,
            lastErrorCode: undefined,
            lastErrorMessage: undefined,
            updatedAt: nowIso,
          }),
        );
        updatedJobsCount += 1;
      }
    }

    await recordAutopilotEvent(store, {
      workspaceId,
      policyId: policy.id,
      fileRecordId: file.id,
      eventType: 'approval_granted',
      status: 'ok',
      summary: `Approved "${file.name}" (approval ${approval.id}, payload hash verified).`,
      actorUid: uid,
    });
  } else if (input.action === 'skip') {
    updatedFile = { ...updatedFile, status: 'skipped_by_user' };
    for (const job of jobs) {
      if (job.status !== 'published' && job.status !== 'cancelled') {
        await saveDoc(
          store,
          `workspaces/${workspaceId}/autopilotJobs/${job.id}`,
          cleanRecord({ ...job, status: 'cancelled', updatedAt: nowIso }),
        );
        updatedJobsCount += 1;
      }
    }
    await recordAutopilotEvent(store, {
      workspaceId,
      policyId: policy.id,
      fileRecordId: file.id,
      eventType: 'file_skipped_by_user',
      status: 'warning',
      summary: `Skipped video "${file.name}" and cancelled ${updatedJobsCount} queued job(s).`,
      actorUid: uid,
    });
  } else if (input.action === 'unskip') {
    updatedFile = {
      ...updatedFile,
      status: file.analysis ? 'analyzed' : 'discovered',
    };
  } else if (input.action === 'retry_failed_jobs') {
    for (const job of jobs) {
      if (job.status === 'failed' || job.status === 'dead_letter' || job.status === 'paused') {
        await saveDoc(
          store,
          `workspaces/${workspaceId}/autopilotJobs/${job.id}`,
          cleanRecord({
            ...job,
            status: 'scheduled',
            scheduledForUtc: nowIso,
            attemptCount: 0,
            leaseOwner: undefined,
            leaseExpiresAt: undefined,
            lastErrorCode: undefined,
            lastErrorMessage: undefined,
            updatedAt: nowIso,
          }),
        );
        updatedJobsCount += 1;
      }
    }
    if (updatedJobsCount > 0) {
      updatedFile = {
        ...updatedFile,
        status: 'scheduled',
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
      };
      await recordAutopilotEvent(store, {
        workspaceId,
        policyId: policy.id,
        fileRecordId: file.id,
        eventType: 'job_retry_scheduled',
        status: 'ok',
        summary: `Operator triggered manual retry for ${updatedJobsCount} failed job(s) on "${file.name}".`,
        actorUid: uid,
      });
    }
  } else if (input.action === 'request_reprocess') {
    updatedFile = {
      ...updatedFile,
      reprocessRequestedAt: nowIso,
      status: 'discovered',
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
    };
  } else if (input.action === 'set_priority') {
    updatedFile = {
      ...updatedFile,
      priority: input.priority ?? file.priority,
    };
  }

  await saveDoc(
    store,
    `workspaces/${workspaceId}/autopilotFiles/${file.id}`,
    cleanRecord(updatedFile),
  );
  return { file: updatedFile, updatedJobsCount };
}

export interface AutopilotCycleSummary {
  workspaceId: string;
  workerId: string;
  ranAt: string;
  policiesProcessed: number;
  discoveredNewCount: number;
  duplicateSkippedCount: number;
  analyzedCount: number;
  scheduledCount: number;
  recoveredStaleLeasesCount: number;
  publishedCount: number;
  failedOrBlockedCount: number;
  warnings: string[];
}

async function resolveGoogleAccessTokenForBackgroundPolicy(
  store: DataStore,
  workspaceId: string,
  policy: AutopilotPolicy,
  fetchImpl?: typeof fetch,
): Promise<string> {
  const connDoc = await store.getDoc(
    `workspaces/${workspaceId}/googleConnections/${policy.googleConnectionId}`,
  );
  if (!connDoc) {
    throw new AppError(401, 'GOOGLE_AUTH_EXPIRED', 'Google connection record no longer exists.');
  }
  const connection = connDoc as unknown as GoogleConnectionRecord;
  if (connection.status !== 'connected') {
    throw new AppError(
      401,
      'GOOGLE_AUTH_EXPIRED',
      `Google connection "${connection.googleEmail}" is in status "${connection.status}".`,
    );
  }
  const platformOAuth = await getPlatformGoogleOAuthCredentials({});
  const tokenResult = await getValidGoogleAccessToken({
    workspaceId,
    connection,
    clientId: platformOAuth.clientId,
    clientSecret: platformOAuth.clientSecret,
    fetchImpl,
  });
  return tokenResult.accessToken;
}

/**
 * Durable unattended worker cycle for a workspace.
 * Runs independently of any open browser session via `/api/cron/autopilot-worker`,
 * Drive webhooks, or manual "Scan & Run Now" trigger.
 */
export async function runAutopilotCycleForWorkspace(
  store: DataStore,
  workspaceId: string,
  options: {
    workerId: string;
    actorUid?: string;
    onlyPolicyId?: string;
    nowIso?: string;
    registerWatchWebhookUrl?: string;
    fetchImpl?: typeof fetch;
    analyzerAdapter?: AutopilotVideoAnalyzerAdapter;
    testMultimodalFixturesByDriveId?: Record<string, TestVideoMultimodalFixture>;
    publishingAdapterByPlatform?: Partial<Record<SocialPlatformId, SocialPublishingAdapter>>;
    socialAccessTokenOverride?: string;
    googleAccessTokenOverride?: string;
  },
): Promise<AutopilotCycleSummary> {
  const nowIso = options.nowIso || new Date().toISOString();
  const actorUid = options.actorUid || options.workerId;
  const warnings: string[] = [];

  const allPolicies = await listAutopilotPolicies(store, workspaceId);
  const targetPolicies = options.onlyPolicyId
    ? allPolicies.filter((p) => p.id === options.onlyPolicyId)
    : allPolicies;

  const [
    allBrandsRaw,
    allBrandFactsRaw,
    allSocialAccountsRaw,
    allApprovalsRaw,
    allBrandPoliciesRaw,
    emergencyStop,
  ] = await Promise.all([
    store.listWorkspaceSubcollection(workspaceId, 'brands'),
    store.listWorkspaceSubcollection(workspaceId, 'brandKnowledge'),
    store.listWorkspaceSubcollection(workspaceId, 'socialAccounts'),
    store.listWorkspaceSubcollection(workspaceId, 'approvalRequests'),
    store.listWorkspaceSubcollection(workspaceId, 'autonomyPolicies'),
    getWorkspaceEmergencyStop(store, workspaceId),
  ]);

  const allBrands = asArray<BrandProfile>(allBrandsRaw);
  const allBrandFacts = asArray<BrandKnowledgeFact>(allBrandFactsRaw);
  const allSocialAccounts = asArray<ConnectedSocialAccount>(allSocialAccountsRaw);
  const allApprovals = asArray<ApprovalRequestRecord>(allApprovalsRaw);
  const allBrandPolicies = asArray<BrandAutonomyPolicy>(allBrandPoliciesRaw);

  let policiesProcessed = 0;
  let discoveredNewCount = 0;
  let duplicateSkippedCount = 0;
  let analyzedCount = 0;
  let scheduledCount = 0;
  let recoveredStaleLeasesCount = 0;
  let publishedCount = 0;
  let failedOrBlockedCount = 0;

  for (const initialPolicy of targetPolicies) {
    let policy = initialPolicy;
    if (policy.status !== 'active') continue;
    policiesProcessed += 1;

    let files = await listAutopilotFiles(store, workspaceId, policy.id);
    let jobs = await listAutopilotJobs(store, workspaceId, policy.id);

    // STAGE 1: Recover stale leases left behind by crashed/restarted workers
    const recovery = recoverStaleAutopilotLeases(jobs, nowIso);
    for (const recJob of [...recovery.recoveredJobs, ...recovery.unknownStatusJobs]) {
      await saveDoc(store, `workspaces/${workspaceId}/autopilotJobs/${recJob.id}`, cleanRecord(recJob));
      recoveredStaleLeasesCount += 1;
      await recordAutopilotEvent(store, {
        workspaceId,
        policyId: policy.id,
        fileRecordId: recJob.fileRecordId,
        jobId: recJob.id,
        eventType: 'job_lease_recovered',
        status: recJob.status === 'publish_status_unknown' ? 'warning' : 'ok',
        summary:
          recJob.status === 'publish_status_unknown'
            ? `Recovered post-submit crash job ${recJob.id} into publish_status_unknown (reconciliation required).`
            : `Recovered stale worker lease for job ${recJob.id} back to scheduled queue.`,
        actorUid,
        createdAt: nowIso,
      });
    }
    if (recovery.recoveredJobs.length > 0 || recovery.unknownStatusJobs.length > 0) {
      jobs = await listAutopilotJobs(store, workspaceId, policy.id);
    }

    // STAGE 2: Google Drive folder scan & reconciliation
    let googleAccessToken = options.googleAccessTokenOverride || '';
    if (!googleAccessToken) {
      try {
        googleAccessToken = await resolveGoogleAccessTokenForBackgroundPolicy(
          store,
          workspaceId,
          policy,
          options.fetchImpl,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Google Drive OAuth token expired.';
        warnings.push(`Policy ${policy.name}: ${msg}`);
        if (policy.failurePolicy.pauseOnAuthExpired) {
          policy = {
            ...policy,
            status: 'paused_auth_expired',
            pauseReason: msg,
            lastErrorCode: 'GOOGLE_AUTH_EXPIRED',
            lastErrorMessage: msg,
            updatedAt: nowIso,
          };
          await saveDoc(
            store,
            `workspaces/${workspaceId}/autopilotPolicies/${policy.id}`,
            cleanRecord(policy),
          );
          await recordAutopilotEvent(store, {
            workspaceId,
            policyId: policy.id,
            eventType: 'auth_expired_paused',
            status: 'error',
            summary: `Auto-paused policy "${policy.name}" because Google Drive credentials expired.`,
            actorUid,
            createdAt: nowIso,
          });
        }
        continue;
      }
    }

    try {
      const scan = await scanDriveFolderRecursive({
        accessToken: googleAccessToken,
        folderId: policy.sourceFolderId,
        includeSubfolders: policy.includeSubfolders,
        maxSubfolderDepth: policy.maxSubfolderDepth,
        fetchImpl: options.fetchImpl,
      });
      warnings.push(...scan.warnings);

      const diff = reconcileDriveSnapshot({
        policy,
        existingRegistry: files,
        scannedNodes: scan.files,
        nowIso,
      });

      for (const rec of diff.allUpdatedRecords) {
        await saveDoc(store, `workspaces/${workspaceId}/autopilotFiles/${rec.id}`, cleanRecord(rec));
      }

      discoveredNewCount += diff.newFiles.length;
      duplicateSkippedCount += diff.duplicateFiles.length;

      for (const delFile of diff.deletedFiles) {
        for (const j of jobs) {
          if (j.fileRecordId === delFile.id && (j.status === 'scheduled' || j.status === 'awaiting_approval')) {
            await saveDoc(
              store,
              `workspaces/${workspaceId}/autopilotJobs/${j.id}`,
              cleanRecord({ ...j, status: 'cancelled', lastErrorCode: 'DRIVE_FILE_DELETED', updatedAt: nowIso }),
            );
          }
        }
        await recordAutopilotEvent(store, {
          workspaceId,
          policyId: policy.id,
          fileRecordId: delFile.id,
          eventType: 'file_deleted',
          status: 'warning',
          summary: `Detected deleted/removed Drive video "${delFile.name}"; pending jobs cancelled.`,
          actorUid,
          createdAt: nowIso,
        });
      }

      for (const dup of diff.duplicateFiles) {
        await recordAutopilotEvent(store, {
          workspaceId,
          policyId: policy.id,
          fileRecordId: dup.id,
          eventType: 'file_duplicate_skipped',
          status: 'warning',
          summary: `Skipped duplicate Drive file "${dup.name}" matching content hash of existing video.`,
          actorUid,
          createdAt: nowIso,
        });
      }

      let watchPatch: Partial<AutopilotPolicy> = {};
      if (
        options.registerWatchWebhookUrl &&
        (!policy.watchExpiresAt || Date.parse(policy.watchExpiresAt) <= Date.parse(nowIso) + 3_600_000)
      ) {
        try {
          const token =
            policy.driveChangePageToken ||
            (await getDriveStartPageToken({
              accessToken: googleAccessToken,
              fetchImpl: options.fetchImpl,
            }));
          const channelId = `antara_drv_${policy.id}_${Date.now()}`;
          const watch = await registerDriveChangesWatch({
            accessToken: googleAccessToken,
            pageToken: token,
            webhookAddress: options.registerWatchWebhookUrl,
            channelId,
            channelToken: `${workspaceId}:${policy.id}`,
            fetchImpl: options.fetchImpl,
          });
          watchPatch = {
            driveChangePageToken: token,
            watchChannelId: watch.channelId,
            watchResourceId: watch.resourceId,
            watchExpiresAt: watch.expirationIso,
          };
        } catch (watchErr) {
          warnings.push(
            `Drive webhook watch unavailable (falling back to scheduled reconciliation): ${watchErr instanceof Error ? watchErr.message : 'error'}`,
          );
        }
      }

      policy = {
        ...policy,
        ...watchPatch,
        sourceFolderName: scan.folder.name || policy.sourceFolderName,
        lastScanAt: nowIso,
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
        updatedAt: nowIso,
      };
      await saveDoc(
        store,
        `workspaces/${workspaceId}/autopilotPolicies/${policy.id}`,
        cleanRecord(policy),
      );

      await recordAutopilotEvent(store, {
        workspaceId,
        policyId: policy.id,
        eventType: 'drive_scan_completed',
        status: 'ok',
        summary: `Scanned "${policy.sourceFolderName}" (${scan.subfoldersTraversed} subfolders): ${diff.newFiles.length} new, ${diff.duplicateFiles.length} duplicate, ${diff.modifiedFiles.length} modified, ${diff.deletedFiles.length} deleted, ${diff.unchangedCount} unchanged.`,
        actorUid,
        createdAt: nowIso,
      });

      files = await listAutopilotFiles(store, workspaceId, policy.id);
    } catch (scanErr) {
      const code = scanErr instanceof AppError ? scanErr.code : 'DRIVE_SCAN_FAILED';
      const msg = scanErr instanceof Error ? scanErr.message : 'Drive folder scan failed.';
      warnings.push(`Policy ${policy.name} scan error: ${msg}`);
      if (
        (code === 'GOOGLE_AUTH_EXPIRED' || code === 'TOKEN_EXPIRED') &&
        policy.failurePolicy.pauseOnAuthExpired
      ) {
        policy = {
          ...policy,
          status: 'paused_auth_expired',
          pauseReason: msg,
          lastErrorCode: code,
          lastErrorMessage: msg,
          updatedAt: nowIso,
        };
        await saveDoc(
          store,
          `workspaces/${workspaceId}/autopilotPolicies/${policy.id}`,
          cleanRecord(policy),
        );
        await recordAutopilotEvent(store, {
          workspaceId,
          policyId: policy.id,
          eventType: 'auth_expired_paused',
          status: 'error',
          summary: `Auto-paused "${policy.name}" after Drive auth error: ${msg}`,
          actorUid,
          createdAt: nowIso,
        });
        continue;
      }
    }

    // STAGE 3: Intelligent multimodal video analysis & metadata generation
    const brand = allBrands.find((b) => b.id === policy.brandId);
    const brandFacts = allBrandFacts.filter((f) => f.brandId === policy.brandId);
    const destAccounts = allSocialAccounts.filter((a) =>
      policy.destinationAccountIds.includes(a.id),
    );
    const targetPlatforms: SocialPlatformId[] = Array.from(
      new Set(
        destAccounts
          .filter((a) => a.provider !== 'canva' && a.provider !== 'meta_ads')
          .map((a) => a.provider as SocialPlatformId),
      ),
    );

    const todayKey = getLocalDateKey(nowIso, policy.timezone);
    let spentTodayUsd = files
      .filter((f) => f.analysis && getLocalDateKey(f.analysis.analyzedAt, policy.timezone) === todayKey)
      .reduce((sum, f) => sum + (f.actualProcessingCostUsd ?? f.estimatedProcessingCostUsd ?? 0), 0);

    const pendingAnalysisFiles = files.filter((f) => f.status === 'discovered').slice(0, 6);
    if (brand && pendingAnalysisFiles.length > 0) {
      for (const file of pendingAnalysisFiles) {
        if (spentTodayUsd >= policy.maxProcessingCostUsdPerDay) {
          warnings.push(
            `Daily AI processing cost cap ($${policy.maxProcessingCostUsdPerDay}) reached for "${policy.name}".`,
          );
          if (policy.failurePolicy.pauseOnCostExceeded) {
            policy = {
              ...policy,
              status: 'paused_cost_limit',
              pauseReason: `Daily video processing cost limit ($${policy.maxProcessingCostUsdPerDay}) reached.`,
              updatedAt: nowIso,
            };
            await saveDoc(
              store,
              `workspaces/${workspaceId}/autopilotPolicies/${policy.id}`,
              cleanRecord(policy),
            );
          }
          break;
        }

        try {
          const testFixture = options.testMultimodalFixturesByDriveId?.[file.driveFileId];
          let videoBytes: Buffer | undefined;
          let contentSha256 = file.contentSha256;

          if (!testFixture) {
            const downloaded = await downloadDriveMediaBytes({
              accessToken: googleAccessToken,
              driveFileId: file.driveFileId,
              maxBytes: MAX_INLINE_MULTIMODAL_BYTES,
              fetchImpl: options.fetchImpl,
            });
            videoBytes = downloaded.bytes;
            contentSha256 = downloaded.sha256;

            if (policy.duplicatePrevention.byContentHash) {
              const shaDup = files.find(
                (other) =>
                  other.id !== file.id &&
                  other.contentSha256 === contentSha256 &&
                  other.status !== 'deleted' &&
                  other.status !== 'duplicate_skipped',
              );
              if (shaDup) {
                const dupRec: AutopilotDriveFileRecord = {
                  ...file,
                  contentSha256,
                  status: 'duplicate_skipped',
                  duplicateOfFileId: shaDup.id,
                  lastErrorCode: 'DUPLICATE_CONTENT_HASH',
                  lastErrorMessage: `Skipped SHA-256 duplicate matching "${shaDup.name}".`,
                  updatedAt: nowIso,
                };
                await saveDoc(
                  store,
                  `workspaces/${workspaceId}/autopilotFiles/${dupRec.id}`,
                  cleanRecord(dupRec),
                );
                duplicateSkippedCount += 1;
                continue;
              }
            }
          }

          const priorPackages = files
            .filter((other) => other.generatedMetadata && other.id !== file.id)
            .map((other) => ({
              fileId: other.id,
              contentTitle: other.generatedMetadata!.contentTitle,
              openingHook: other.generatedMetadata!.openingHook,
              instagramCaption: other.generatedMetadata!.instagramCaption,
            }));

          const result = await analyzeVideoAndGenerateMetadata({
            file,
            policy,
            brand,
            brandFacts,
            targetPlatforms: targetPlatforms.length > 0 ? targetPlatforms : ['instagram', 'youtube'],
            priorMetadataFingerprints: priorPackages,
            videoBytes,
            testMultimodalFixture: testFixture,
            analyzerAdapter: options.analyzerAdapter,
            nowIso,
          });

          const payloadHash = computeAutopilotMetadataPayloadHash({
            driveFileId: file.driveFileId,
            brandId: file.brandId,
            destinationAccountIds: policy.destinationAccountIds,
            metadata: result.generatedMetadata,
          });

          const nextStatus: AutopilotDriveFileRecord['status'] = !result.analysis.safeToPublish
            ? 'awaiting_approval'
            : policy.executionMode === 'DRAFT_ONLY'
              ? 'analyzed'
              : policy.executionMode === 'APPROVAL_REQUIRED'
                ? 'awaiting_approval'
                : 'analyzed';

          const analyzedFile: AutopilotDriveFileRecord = {
            ...file,
            contentSha256,
            analysis: result.analysis,
            generatedMetadata: result.generatedMetadata,
            payloadHash,
            status: nextStatus,
            estimatedProcessingCostUsd: result.analysis.estimatedCostUsd,
            actualProcessingCostUsd: result.analysis.estimatedCostUsd,
            lastErrorCode:
              result.validationIssues.length > 0 ? 'ANALYSIS_REVIEW_REQUIRED' : undefined,
            lastErrorMessage:
              result.validationIssues.length > 0 ? result.validationIssues.join(' ') : undefined,
            updatedAt: nowIso,
          };

          await saveDoc(
            store,
            `workspaces/${workspaceId}/autopilotFiles/${analyzedFile.id}`,
            cleanRecord(analyzedFile),
          );
          files = files.map((f) => (f.id === analyzedFile.id ? analyzedFile : f));
          spentTodayUsd += result.analysis.estimatedCostUsd ?? 0;
          analyzedCount += 1;

          await recordAutopilotEvent(store, {
            workspaceId,
            policyId: policy.id,
            fileRecordId: analyzedFile.id,
            eventType: 'video_analyzed',
            status: result.analysis.safeToPublish ? 'ok' : 'warning',
            summary: `Analyzed "${file.name}" (${result.analysis.sourceMethod}): "${result.generatedMetadata.contentTitle}" (uniqueness ${Math.round(result.uniquenessScore * 100)}%).`,
            actorUid,
            createdAt: nowIso,
          });
        } catch (analysisErr) {
          const code = analysisErr instanceof AppError ? analysisErr.code : 'VIDEO_ANALYSIS_FAILED';
          const msg = analysisErr instanceof Error ? analysisErr.message : 'Video analysis failed.';
          warnings.push(`Video "${file.name}" analysis skipped: ${msg}`);
          await saveDoc(
            store,
            `workspaces/${workspaceId}/autopilotFiles/${file.id}`,
            cleanRecord({
              ...file,
              status: code === 'AI_PROVIDER_NOT_CONFIGURED' ? 'discovered' : 'failed',
              lastErrorCode: code,
              lastErrorMessage: msg,
              updatedAt: nowIso,
            }),
          );
        }
      }
    }

    // STAGE 4: Schedule eligible analyzed videos into durable slots
    if (policy.status === 'active') {
      const batch = planAutopilotScheduleBatch({
        policy,
        files,
        destinationAccounts: destAccounts,
        existingJobs: jobs,
        nowIso,
      });

      for (const job of batch.newJobs) {
        await saveDoc(store, `workspaces/${workspaceId}/autopilotJobs/${job.id}`, cleanRecord(job));
        scheduledCount += 1;
        await recordAutopilotEvent(store, {
          workspaceId,
          policyId: policy.id,
          fileRecordId: job.fileRecordId,
          jobId: job.id,
          eventType: job.status === 'awaiting_approval' ? 'approval_requested' : 'job_scheduled',
          status: 'ok',
          summary:
            job.status === 'awaiting_approval'
              ? `Queued ${job.platform} post awaiting human approval for slot ${job.scheduledForUtc}.`
              : `Scheduled ${job.platform} (${job.format}) publish job for ${job.scheduledForUtc}.`,
          actorUid,
          createdAt: nowIso,
        });
      }
      for (const uf of batch.updatedFiles) {
        await saveDoc(store, `workspaces/${workspaceId}/autopilotFiles/${uf.id}`, cleanRecord(uf));
      }
      if (batch.newJobs.length > 0) {
        files = await listAutopilotFiles(store, workspaceId, policy.id);
        jobs = await listAutopilotJobs(store, workspaceId, policy.id);
      }
    }

    // STAGE 5: Execute due scheduled jobs through Central Action Gateway & provider adapters
    const brandAutonomyPolicy: BrandAutonomyPolicy | null =
      allBrandPolicies.find((p) => p.brandId === policy.brandId) || null;

    const alreadyExecutedKeys = new Set(
      jobs
        .filter((j) => j.status === 'published' || j.status === 'publish_status_unknown')
        .map((j) => j.idempotencyKey),
    );
    let publishedTodayCount = new Set(
      jobs
        .filter(
          (j) => j.status === 'published' && getLocalDateKey(j.updatedAt, policy.timezone) === todayKey,
        )
        .map((j) => j.fileRecordId),
    ).size;

    const dueJobs = jobs
      .filter((j) => j.status === 'scheduled' && Date.parse(j.scheduledForUtc) <= Date.parse(nowIso))
      .slice(0, 6);

    for (const dueJob of dueJobs) {
      if (policy.status !== 'active') break;

      const lease = claimAutopilotJobLease(dueJob, options.workerId, nowIso);
      if (!lease.claimed) continue;

      await saveDoc(
        store,
        `workspaces/${workspaceId}/autopilotJobs/${lease.job.id}`,
        cleanRecord(lease.job),
      );

      const file = files.find((f) => f.id === lease.job.fileRecordId);
      const account = allSocialAccounts.find((a) => a.id === lease.job.accountId) || null;
      const approval: ApprovalRequestRecord | null = lease.job.approvalRequestId
        ? allApprovals.find((a) => a.id === lease.job.approvalRequestId) || null
        : file?.approvalRequestId
          ? allApprovals.find((a) => a.id === file.approvalRequestId) || null
          : null;

      if (!file) {
        await saveDoc(
          store,
          `workspaces/${workspaceId}/autopilotJobs/${lease.job.id}`,
          cleanRecord({ ...lease.job, status: 'cancelled', lastErrorCode: 'FILE_MISSING', updatedAt: nowIso }),
        );
        continue;
      }

      let accountToken: string | null = options.socialAccessTokenOverride || null;
      if (!accountToken && account) {
        try {
          accountToken = await readDecryptedSocialAccessToken(store, workspaceId, account);
        } catch {
          accountToken = null;
        }
      }

      const execResult = await executeAutopilotPublishJob({
        policy,
        file,
        job: lease.job,
        account,
        accountAccessToken: accountToken,
        approval,
        brandAutonomyPolicy,
        emergencyStop,
        todayPublishedCount: publishedTodayCount,
        alreadyExecutedIdempotencyKeys: alreadyExecutedKeys,
        adapterOverride: options.publishingAdapterByPlatform?.[lease.job.platform],
        fetchImpl: options.fetchImpl,
        nowIso,
      });

      await saveDoc(
        store,
        `workspaces/${workspaceId}/autopilotJobs/${execResult.updatedJob.id}`,
        cleanRecord(execResult.updatedJob),
      );
      await saveDoc(
        store,
        `workspaces/${workspaceId}/autopilotFiles/${execResult.updatedFile.id}`,
        cleanRecord(execResult.updatedFile),
      );

      if (execResult.outcome === 'published') {
        publishedCount += 1;
        publishedTodayCount += 1;
        alreadyExecutedKeys.add(execResult.updatedJob.idempotencyKey);
        await recordAutopilotEvent(store, {
          workspaceId,
          policyId: policy.id,
          fileRecordId: file.id,
          jobId: lease.job.id,
          eventType: 'job_published',
          status: 'ok',
          summary: `Published "${file.name}" to ${lease.job.platform} (postId: ${execResult.updatedJob.externalPostId || 'recorded'}).`,
          actorUid,
          createdAt: nowIso,
        });
      } else if (execResult.outcome === 'publish_status_unknown') {
        failedOrBlockedCount += 1;
        alreadyExecutedKeys.add(execResult.updatedJob.idempotencyKey);
        await recordAutopilotEvent(store, {
          workspaceId,
          policyId: policy.id,
          fileRecordId: file.id,
          jobId: lease.job.id,
          eventType: 'job_publish_unknown',
          status: 'warning',
          summary: `Publish status unknown for "${file.name}" on ${lease.job.platform}; blind retry suppressed pending reconciliation.`,
          actorUid,
          createdAt: nowIso,
        });
      } else if (execResult.outcome === 'retry_scheduled') {
        failedOrBlockedCount += 1;
        await recordAutopilotEvent(store, {
          workspaceId,
          policyId: policy.id,
          fileRecordId: file.id,
          jobId: lease.job.id,
          eventType: 'job_retry_scheduled',
          status: 'warning',
          summary: `Temporary failure on ${lease.job.platform} (${execResult.updatedJob.lastErrorCode}); safe backoff retry scheduled for ${execResult.updatedJob.nextRetryAtUtc}.`,
          actorUid,
          createdAt: nowIso,
        });
      } else {
        failedOrBlockedCount += 1;
        await recordAutopilotEvent(store, {
          workspaceId,
          policyId: policy.id,
          fileRecordId: file.id,
          jobId: lease.job.id,
          eventType: 'job_failed',
          status: 'error',
          summary: `Job blocked/failed for "${file.name}" on ${lease.job.platform}: ${execResult.updatedJob.lastErrorMessage || execResult.updatedJob.lastErrorCode}.`,
          actorUid,
          createdAt: nowIso,
        });
      }

      if (execResult.shouldPausePolicy && execResult.newPolicyStatus) {
        policy = {
          ...policy,
          status: execResult.newPolicyStatus,
          pauseReason: execResult.policyPauseReason,
          lastErrorCode: execResult.updatedJob.lastErrorCode,
          lastErrorMessage: execResult.updatedJob.lastErrorMessage,
          updatedAt: nowIso,
        };
        await saveDoc(
          store,
          `workspaces/${workspaceId}/autopilotPolicies/${policy.id}`,
          cleanRecord(policy),
        );
        await recordAutopilotEvent(store, {
          workspaceId,
          policyId: policy.id,
          fileRecordId: file.id,
          jobId: lease.job.id,
          eventType:
            execResult.newPolicyStatus === 'paused_auth_expired'
              ? 'auth_expired_paused'
              : 'policy_violation_paused',
          status: 'error',
          summary: execResult.policyPauseReason || `Auto-paused policy "${policy.name}".`,
          actorUid,
          createdAt: nowIso,
        });
      }
    }
  }

  return {
    workspaceId,
    workerId: options.workerId,
    ranAt: nowIso,
    policiesProcessed,
    discoveredNewCount,
    duplicateSkippedCount,
    analyzedCount,
    scheduledCount,
    recoveredStaleLeasesCount,
    publishedCount,
    failedOrBlockedCount,
    warnings,
  };
}

export async function triggerImmediatePolicyScanAndRun(
  uid: string,
  workspaceId: string,
  policyId: string,
  options?: { registerWatchWebhookUrl?: string; ctx?: Phase2ExecutionContext },
): Promise<AutopilotCycleSummary> {
  const { store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'publishing:schedule',
    options?.ctx,
  );
  const policy = await getAutopilotPolicy(store, workspaceId, policyId);
  if (!policy) {
    throw new AppError(404, 'AUTOPILOT_POLICY_NOT_FOUND', 'Autopilot policy not found.');
  }

  const { accessToken } = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'publishing:schedule',
    preferredConnectionId: policy.googleConnectionId,
    ctx: options?.ctx,
  });

  return runAutopilotCycleForWorkspace(store, workspaceId, {
    workerId: `manual_scan_${uid.slice(0, 8)}`,
    actorUid: uid,
    onlyPolicyId: policyId,
    registerWatchWebhookUrl: options?.registerWatchWebhookUrl,
    googleAccessTokenOverride: accessToken,
    fetchImpl: options?.ctx?.fetchImpl,
  });
}

export function getAutopilotBackgroundStore(): DataStore | null {
  try {
    return getStore({});
  } catch {
    return null;
  }
}
