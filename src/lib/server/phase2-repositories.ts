import type {
  AppsScriptDeploymentRecord,
  AppsScriptFile,
  AppsScriptProjectRecord,
  AppsScriptSnapshotRecord,
  AppsScriptTriggerInstallInput,
  AppsScriptVersionRecord,
  ApprovedExecutionTarget,
  DoctorDiagnosticCode,
  GoogleConnectionRecord,
  GoogleDoctorReport,
  GoogleIntegrationAuditRecord,
  Permission,
  ScriptExecutionRecord,
  ScriptTriggerRecord,
  WorkspaceRole,
} from '@/types/domain';
import {
  createAppsScriptDeployment,
  createAppsScriptProject,
  createAppsScriptVersion,
  deleteAppsScriptDeployment,
  getAppsScriptContent,
  getAppsScriptProject,
  listAppsScriptDeployments,
  listAppsScriptProcesses,
  listAppsScriptVersions,
  runAppsScriptFunction,
  updateAppsScriptDeployment,
  type GoogleAppsScriptDeploymentResponse,
} from '@/lib/google/apps-script-client';
import { computeProjectContentHash } from '@/lib/google/diff';
import { runGoogleIntegrationDoctor } from '@/lib/google/doctor';
import {
  discoverAppsScriptProjects,
  type DriveDiscoveryResult,
} from '@/lib/google/drive-client';
import {
  buildDefaultManifest,
  parseAndValidateManifest,
  serializeManifest,
} from '@/lib/google/manifest';
import { getPhase4MarketingAppsScriptTemplate } from '@/lib/google/marketing-templates';
import {
  disconnectAndRevokeConnection,
  getValidGoogleAccessToken,
  verifyGoogleTokenInfo,
  type FetchLike,
} from '@/lib/google/oauth';
import {
  evaluateCapabilities,
  normalizeGrantedScopeList,
} from '@/lib/google/permissions';
import {
  createSnapshotRecord,
  protectedUpdateProjectContent,
  type ProtectedUpdateResult,
} from '@/lib/google/source-manager';
import { getAppsScriptTemplate } from '@/lib/google/templates';
import {
  ANTARA_TRIGGER_FILE_NAME,
  buildTriggerScheduleDescription,
  generateAntaraTriggerHelperSource,
  installAntaraTriggerRemotely,
  removeAntaraTriggerRemotely,
  scriptContainsHandlerFunction,
} from '@/lib/google/triggers';
import { validateAppsScriptProject } from '@/lib/google/validator';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { AppError } from '@/lib/server/error-handler';
import {
  deleteLocalConnectionMetadataMirror,
  listLocalConnectionMetadataMirrors,
  saveLocalConnectionMetadataMirror,
  type VaultStorageOptions,
} from '@/lib/server/google-vault';
import { getPlatformGoogleOAuthCredentials } from '@/lib/server/platform-oauth';
import {
  getStore,
  makeId,
  recordAuditLog,
  requireWorkspaceAccess,
  toIsoString,
  type DataStore,
  type RepositoryContext,
} from '@/lib/server/repositories';
import { assertCrossTenantMatch } from '@/lib/server/tenant-guard';
import { DEFAULT_WORKSPACE_TIMEZONE } from '@/lib/validation';
import type { CommitWriteOp } from './firestore-rest';

export interface Phase2ExecutionContext extends RepositoryContext {
  fetchImpl?: FetchLike;
  vaultOptions?: VaultStorageOptions;
  origin?: string;
}

function mapConnectionDoc(d: Record<string, unknown>): GoogleConnectionRecord {
  return {
    id: String(d.id),
    workspaceId: String(d.workspaceId),
    userId: String(d.userId),
    userEmail: String(d.userEmail || ''),
    googleAccountId: String(d.googleAccountId),
    googleEmail: String(d.googleEmail),
    googleName: d.googleName ? String(d.googleName) : undefined,
    googlePicture: d.googlePicture ? String(d.googlePicture) : undefined,
    status: (d.status as GoogleConnectionRecord['status']) || 'connected',
    grantedScopes: Array.isArray(d.grantedScopes)
      ? d.grantedScopes.map(String)
      : [],
    encryptedCredentialId: String(d.encryptedCredentialId || d.id),
    accessTokenExpiresAt: toIsoString(d.accessTokenExpiresAt),
    hasRefreshToken: Boolean(d.hasRefreshToken),
    sharedWithWorkspace: Boolean(d.sharedWithWorkspace),
    consentSeparatedFromLogin: true,
    lastVerifiedAt: d.lastVerifiedAt ? toIsoString(d.lastVerifiedAt) : undefined,
    lastErrorCode: d.lastErrorCode ? String(d.lastErrorCode) : undefined,
    lastErrorMessage: d.lastErrorMessage ? String(d.lastErrorMessage) : undefined,
    connectedAt: toIsoString(d.connectedAt),
    revokedAt: d.revokedAt ? toIsoString(d.revokedAt) : undefined,
    updatedAt: toIsoString(d.updatedAt),
  };
}

function mapProjectDoc(d: Record<string, unknown>): AppsScriptProjectRecord {
  return {
    id: String(d.id),
    scriptId: String(d.scriptId),
    workspaceId: String(d.workspaceId),
    ownerUid: String(d.ownerUid),
    ownerConnectionId: String(d.ownerConnectionId),
    title: String(d.title),
    parentId: d.parentId ? String(d.parentId) : undefined,
    projectType: (d.projectType as AppsScriptProjectRecord['projectType']) || 'standalone',
    ownershipKind:
      (d.ownershipKind as AppsScriptProjectRecord['ownershipKind']) || 'owned_by_user',
    lastKnownContentHash: d.lastKnownContentHash
      ? String(d.lastKnownContentHash)
      : undefined,
    lastSyncAt: d.lastSyncAt ? toIsoString(d.lastSyncAt) : undefined,
    status: (d.status as AppsScriptProjectRecord['status']) || 'active',
    templateKey: d.templateKey ? String(d.templateKey) : undefined,
    editorUrl: String(
      d.editorUrl ||
        `https://script.google.com/home/projects/${String(d.scriptId)}/edit`,
    ),
    createdAt: toIsoString(d.createdAt),
    updatedAt: toIsoString(d.updatedAt),
  };
}

function mapDeploymentDoc(d: Record<string, unknown>): AppsScriptDeploymentRecord {
  return {
    id: String(d.id),
    workspaceId: String(d.workspaceId),
    scriptId: String(d.scriptId),
    deploymentId: String(d.deploymentId),
    deploymentType:
      (d.deploymentType as AppsScriptDeploymentRecord['deploymentType']) || 'WEB_APP',
    versionNumber: Number(d.versionNumber || 1),
    description: String(d.description || ''),
    accessLevel: d.accessLevel
      ? (String(d.accessLevel) as AppsScriptDeploymentRecord['accessLevel'])
      : undefined,
    executeAs: d.executeAs
      ? (String(d.executeAs) as AppsScriptDeploymentRecord['executeAs'])
      : undefined,
    webAppUrl: d.webAppUrl ? String(d.webAppUrl) : undefined,
    entryPointsJson: d.entryPointsJson ? String(d.entryPointsJson) : undefined,
    status: (d.status as AppsScriptDeploymentRecord['status']) || 'active',
    verified: Boolean(d.verified),
    lastVerifiedAt: d.lastVerifiedAt ? toIsoString(d.lastVerifiedAt) : undefined,
    lastErrorMessage: d.lastErrorMessage ? String(d.lastErrorMessage) : undefined,
    createdByUid: String(d.createdByUid),
    createdAt: toIsoString(d.createdAt),
    updatedAt: toIsoString(d.updatedAt),
  };
}

export function canUserAccessGoogleConnection(
  conn: GoogleConnectionRecord,
  actorUid: string,
  actorRole: WorkspaceRole,
): boolean {
  if (conn.userId === actorUid) return true;
  if (conn.sharedWithWorkspace && actorRole !== 'viewer') return true;
  return false;
}

export async function recordGoogleIntegrationAudit(
  store: DataStore,
  workspaceId: string,
  input: Omit<GoogleIntegrationAuditRecord, 'id' | 'workspaceId' | 'createdAt'>,
): Promise<void> {
  const id = makeId('gaud');
  await store.commit([
    {
      path: `workspaces/${workspaceId}/googleIntegrationAudit/${id}`,
      data: {
        id,
        workspaceId,
        ...input,
      },
      serverTimestampFields: ['createdAt'],
    },
  ]);
}

async function syncWorkspaceGoogleIntegrationCards(
  store: DataStore,
  workspaceId: string,
  conn: GoogleConnectionRecord | null,
  actorUid: string,
): Promise<void> {
  const ops: CommitWriteOp[] = [];
  const connected = conn && conn.status === 'connected';
  const status = connected
    ? 'connected'
    : conn?.status === 'revoked' || conn?.status === 'reauth_required'
      ? 'error'
      : 'authorization_required';

  for (const id of ['google_workspace', 'google_apps_script'] as const) {
    ops.push({
      path: `workspaces/${workspaceId}/integrations/${id}`,
      data: {
        id,
        workspaceId,
        provider: id,
        category: id === 'google_workspace' ? 'google_workspace' : 'apps_script',
        status,
        capabilityClass: connected
          ? 'already_available'
          : 'requires_external_authorization',
        accountEmail: conn?.googleEmail || '',
        accountName: conn?.googleName || '',
        grantedScopes: conn?.grantedScopes || [],
        hasRefreshToken: Boolean(conn?.hasRefreshToken),
        consentSeparatedFromLogin: true,
        lastErrorMessage: conn?.lastErrorMessage || '',
        configuredBy: actorUid,
      },
      updateMask: [
        'status',
        'capabilityClass',
        'accountEmail',
        'accountName',
        'grantedScopes',
        'hasRefreshToken',
        'lastErrorMessage',
        'configuredBy',
        'updatedAt',
      ],
      serverTimestampFields: ['updatedAt'],
    });
  }

  await store.commit(ops).catch(() => null);
}

/**
 * Reconciles any locally persisted OAuth callback records (created when Firebase Admin SA is omitted locally)
 * into the user's Firestore workspace subcollection as soon as an authenticated store is available.
 */
async function reconcileLocalConnectionsIntoStore(
  store: DataStore,
  workspaceId: string,
  actorUid: string,
  vaultOptions?: VaultStorageOptions,
): Promise<GoogleConnectionRecord[]> {
  const rawDocs = await store.listWorkspaceSubcollection(workspaceId, 'googleConnections');
  const byId = new Map<string, GoogleConnectionRecord>();

  for (const d of rawDocs) {
    const mapped = mapConnectionDoc(d);
    byId.set(mapped.id, mapped);
  }

  const mirrors = listLocalConnectionMetadataMirrors(workspaceId, vaultOptions);
  const toSyncOps: CommitWriteOp[] = [];

  for (const mirror of mirrors) {
    const existing = byId.get(mirror.id);
    if (!existing || Date.parse(mirror.updatedAt) > Date.parse(existing.updatedAt)) {
      byId.set(mirror.id, mirror);
      if (mirror.userId === actorUid) {
        toSyncOps.push({
          path: `workspaces/${workspaceId}/googleConnections/${mirror.id}`,
          data: {
            ...mirror,
          },
          serverTimestampFields: ['updatedAt'],
        });
      }
    }
  }

  if (toSyncOps.length > 0 && store.mode !== 'development_test_adapter') {
    await store.commit(toSyncOps).catch(() => null);
  }

  return Array.from(byId.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export async function listWorkspaceGoogleConnections(
  uid: string,
  workspaceId: string,
  ctx: Phase2ExecutionContext = {},
): Promise<{
  connections: GoogleConnectionRecord[];
  activeConnection: GoogleConnectionRecord | null;
  capabilities: ReturnType<typeof evaluateCapabilities>;
  platformOAuthConfigured: boolean;
}> {
  const { member, store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'google:read',
    ctx,
  );
  const platformOAuth = await getPlatformGoogleOAuthCredentials({
    origin: ctx.origin,
  });

  const all = await reconcileLocalConnectionsIntoStore(
    store,
    workspaceId,
    uid,
    ctx.vaultOptions,
  );
  const visible = all.filter((c) => canUserAccessGoogleConnection(c, uid, member.role));

  // Prefer caller's own active connection, otherwise shared active connection
  const activeConnection =
    visible.find((c) => c.userId === uid && c.status === 'connected') ||
    visible.find((c) => c.status === 'connected') ||
    visible[0] ||
    null;

  const capabilities = evaluateCapabilities({
    platformOAuthConfigured: platformOAuth.configured,
    connection: activeConnection,
  });

  return {
    connections: visible,
    activeConnection,
    capabilities,
    platformOAuthConfigured: platformOAuth.configured,
  };
}

export async function resolveConnectionAndAccessToken(params: {
  uid: string;
  workspaceId: string;
  requiredPermission: Permission;
  preferredConnectionId?: string;
  ctx?: Phase2ExecutionContext;
}): Promise<{
  store: DataStore;
  role: WorkspaceRole;
  connection: GoogleConnectionRecord;
  accessToken: string;
  scopes: string[];
}> {
  const ctx = params.ctx || {};
  const { member, store } = await requireWorkspaceAccess(
    params.uid,
    params.workspaceId,
    params.requiredPermission,
    ctx,
  );

  const all = await reconcileLocalConnectionsIntoStore(
    store,
    params.workspaceId,
    params.uid,
    ctx.vaultOptions,
  );
  const accessible = all.filter((c) =>
    canUserAccessGoogleConnection(c, params.uid, member.role),
  );

  const selected = params.preferredConnectionId
    ? accessible.find((c) => c.id === params.preferredConnectionId)
    : accessible.find((c) => c.userId === params.uid && c.status === 'connected') ||
      accessible.find((c) => c.status === 'connected') ||
      accessible[0];

  if (!selected) {
    throw new AppError(
      403,
      'GOOGLE_NOT_CONNECTED',
      'No authorized Google connection available to this user in the active workspace.',
    );
  }

  assertCrossTenantMatch(selected.workspaceId, params.workspaceId, 'Google connection');

  const platformOAuth = await getPlatformGoogleOAuthCredentials({
    origin: ctx.origin,
  });

  const tokenResult = await getValidGoogleAccessToken({
    workspaceId: params.workspaceId,
    connection: selected,
    clientId: platformOAuth.clientId,
    clientSecret: platformOAuth.clientSecret,
    fetchImpl: ctx.fetchImpl,
    vaultOptions: ctx.vaultOptions,
    onStatusChange: async (patch) => {
      const updated: GoogleConnectionRecord = {
        ...selected,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      saveLocalConnectionMetadataMirror(updated, ctx.vaultOptions);
      await store
        .commit([
          {
            path: `workspaces/${params.workspaceId}/googleConnections/${selected.id}`,
            data: patch,
            updateMask: [...Object.keys(patch), 'updatedAt'],
            serverTimestampFields: ['updatedAt'],
          },
        ])
        .catch(() => null);
    },
  });

  return {
    store,
    role: member.role,
    connection: selected,
    accessToken: tokenResult.accessToken,
    scopes: tokenResult.scopes,
  };
}

export async function persistGoogleConnectionMetadata(params: {
  connection: GoogleConnectionRecord;
  ctx?: Phase2ExecutionContext;
}): Promise<void> {
  const { connection, ctx = {} } = params;
  saveLocalConnectionMetadataMirror(connection, ctx.vaultOptions);

  try {
    const store = getStore(ctx);
    await store.commit([
      {
        path: `workspaces/${connection.workspaceId}/googleConnections/${connection.id}`,
        data: { ...connection },
        serverTimestampFields: ['updatedAt'],
      },
    ]);
    await syncWorkspaceGoogleIntegrationCards(
      store,
      connection.workspaceId,
      connection,
      connection.userId,
    );
    await recordGoogleIntegrationAudit(store, connection.workspaceId, {
      actorUid: connection.userId,
      actorEmail: connection.userEmail,
      operation: 'google.oauth_connected',
      connectionId: connection.id,
      providerClassification: 'success',
      summary: `Connected external Google account ${connection.googleEmail} (${connection.grantedScopes.length} scope(s)).`,
    });
  } catch {
    // When Admin SDK is unavailable during un-tokened GET callback, local mirror safely retains
    // metadata until the authenticated dashboard session reconciles into Firestore cleanly.
  }
}

export async function toggleGoogleConnectionSharing(
  uid: string,
  userEmail: string,
  workspaceId: string,
  connectionId: string,
  sharedWithWorkspace: boolean,
  ctx: Phase2ExecutionContext = {},
): Promise<GoogleConnectionRecord> {
  const { member, store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'google:connect',
    ctx,
  );

  const all = await reconcileLocalConnectionsIntoStore(
    store,
    workspaceId,
    uid,
    ctx.vaultOptions,
  );
  const existing = all.find((c) => c.id === connectionId);
  if (!existing) {
    throw new AppError(404, 'CONNECTION_NOT_FOUND', 'Google connection not found.');
  }

  if (existing.userId !== uid && member.role !== 'owner' && member.role !== 'admin') {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Only the connection owner or a workspace owner/admin can change workspace sharing.',
    );
  }

  const now = new Date().toISOString();
  const next: GoogleConnectionRecord = {
    ...existing,
    sharedWithWorkspace,
    updatedAt: now,
  };
  saveLocalConnectionMetadataMirror(next, ctx.vaultOptions);

  await store.commit([
    {
      path: `workspaces/${workspaceId}/googleConnections/${connectionId}`,
      data: { sharedWithWorkspace },
      updateMask: ['sharedWithWorkspace', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordGoogleIntegrationAudit(store, workspaceId, {
    actorUid: uid,
    actorEmail: userEmail,
    operation: sharedWithWorkspace
      ? 'google.connection_shared'
      : 'google.connection_made_private',
    connectionId,
    providerClassification: 'success',
    summary: sharedWithWorkspace
      ? `Shared Google connection (${existing.googleEmail}) with workspace members.`
      : `Restricted Google connection (${existing.googleEmail}) to personal owner use only.`,
  });

  return next;
}

export async function verifyGoogleConnectionStatus(
  uid: string,
  userEmail: string,
  workspaceId: string,
  connectionId: string,
  ctx: Phase2ExecutionContext = {},
): Promise<{
  connection: GoogleConnectionRecord;
  tokenValid: boolean;
  scopes: string[];
}> {
  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'google:read',
    preferredConnectionId: connectionId,
    ctx,
  });

  const info = await verifyGoogleTokenInfo(resolved.accessToken, ctx.fetchImpl);
  const now = new Date().toISOString();
  const nextScopes = info.valid && info.scopes.length > 0
    ? Array.from(new Set([...resolved.connection.grantedScopes, ...info.scopes]))
    : resolved.connection.grantedScopes;

  const updated: GoogleConnectionRecord = {
    ...resolved.connection,
    status: info.valid ? 'connected' : 'reauth_required',
    grantedScopes: nextScopes,
    lastVerifiedAt: now,
    lastErrorCode: info.valid ? undefined : 'GOOGLE_REAUTH_REQUIRED',
    lastErrorMessage: info.valid ? undefined : info.reason,
    updatedAt: now,
  };

  saveLocalConnectionMetadataMirror(updated, ctx.vaultOptions);
  await resolved.store.commit([
    {
      path: `workspaces/${workspaceId}/googleConnections/${connectionId}`,
      data: {
        status: updated.status,
        grantedScopes: updated.grantedScopes,
        lastVerifiedAt: now,
        lastErrorCode: updated.lastErrorCode || '',
        lastErrorMessage: updated.lastErrorMessage || '',
      },
      updateMask: [
        'status',
        'grantedScopes',
        'lastVerifiedAt',
        'lastErrorCode',
        'lastErrorMessage',
        'updatedAt',
      ],
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordGoogleIntegrationAudit(resolved.store, workspaceId, {
    actorUid: uid,
    actorEmail: userEmail,
    operation: 'google.connection_verified',
    connectionId,
    providerClassification: info.valid ? 'success' : 'reauth_required',
    summary: info.valid
      ? `Verified live Google token for ${updated.googleEmail} (${nextScopes.length} scopes).`
      : `Token verification failed for ${updated.googleEmail}: ${info.reason || 'invalid token'}.`,
  });

  return {
    connection: updated,
    tokenValid: info.valid,
    scopes: nextScopes,
  };
}

export async function disconnectAndRevokeWorkspaceGoogleConnection(
  uid: string,
  userEmail: string,
  workspaceId: string,
  connectionId: string,
  ctx: Phase2ExecutionContext = {},
): Promise<{ revokedUpstream: boolean; detail?: string }> {
  const { member, store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'google:disconnect',
    ctx,
  );

  const all = await reconcileLocalConnectionsIntoStore(
    store,
    workspaceId,
    uid,
    ctx.vaultOptions,
  );
  const existing = all.find((c) => c.id === connectionId);
  if (!existing) {
    throw new AppError(404, 'CONNECTION_NOT_FOUND', 'Google connection not found.');
  }

  if (existing.userId !== uid && member.role !== 'owner' && member.role !== 'admin') {
    throw new AppError(
      403,
      'FORBIDDEN',
      'You can only disconnect your own Google connection unless you are a workspace Owner or Admin.',
    );
  }

  const revokeRes = await disconnectAndRevokeConnection({
    workspaceId,
    connectionId,
    fetchImpl: ctx.fetchImpl,
    vaultOptions: ctx.vaultOptions,
  });

  const now = new Date().toISOString();
  const disconnectedRecord: GoogleConnectionRecord = {
    ...existing,
    status: 'disconnected',
    hasRefreshToken: false,
    revokedAt: now,
    updatedAt: now,
  };
  deleteLocalConnectionMetadataMirror(workspaceId, connectionId, ctx.vaultOptions);

  await store.commit([
    {
      path: `workspaces/${workspaceId}/googleConnections/${connectionId}`,
      data: {
        status: 'disconnected',
        hasRefreshToken: false,
        revokedAt: now,
      },
      updateMask: ['status', 'hasRefreshToken', 'revokedAt', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await syncWorkspaceGoogleIntegrationCards(store, workspaceId, disconnectedRecord, uid);

  await recordGoogleIntegrationAudit(store, workspaceId, {
    actorUid: uid,
    actorEmail: userEmail,
    operation: 'google.connection_revoked',
    connectionId,
    providerClassification: 'success',
    summary: `Disconnected & wiped encrypted tokens for ${existing.googleEmail} (upstream revoked: ${revokeRes.revokedUpstream}).`,
  });

  await recordAuditLog(
    store,
    workspaceId,
    uid,
    userEmail,
    'google.disconnected',
    'googleConnection',
    connectionId,
    `Disconnected Google account ${existing.googleEmail} and wiped vault credentials.`,
  );

  return revokeRes;
}

export async function runWorkspaceGoogleDoctor(
  uid: string,
  workspaceId: string,
  scriptId?: string,
  ctx: Phase2ExecutionContext = {},
): Promise<GoogleDoctorReport> {
  const { snapshot } = resolveAutonomousConfiguration();
  const platformOAuth = await getPlatformGoogleOAuthCredentials({
    origin: ctx.origin,
  });
  const listRes = await listWorkspaceGoogleConnections(uid, workspaceId, ctx);
  const store = getStore(ctx);

  let accessToken: string | undefined;
  if (listRes.activeConnection && listRes.activeConnection.status === 'connected') {
    try {
      const tokenRes = await resolveConnectionAndAccessToken({
        uid,
        workspaceId,
        requiredPermission: 'google:read',
        preferredConnectionId: listRes.activeConnection.id,
        ctx,
      });
      accessToken = tokenRes.accessToken;
    } catch {
      accessToken = undefined;
    }
  }

  let targetProject: AppsScriptProjectRecord | null = null;
  let targetDeployments: AppsScriptDeploymentRecord[] = [];
  if (scriptId) {
    const rawProject = await store.getDoc(
      `workspaces/${workspaceId}/appsScriptProjects/${scriptId}`,
    );
    if (rawProject) {
      targetProject = mapProjectDoc(rawProject);
    }
    const rawDeployments = await store.listWorkspaceSubcollection(
      workspaceId,
      'appsScriptDeployments',
    );
    targetDeployments = rawDeployments
      .map(mapDeploymentDoc)
      .filter((d) => d.scriptId === scriptId);
  }

  return runGoogleIntegrationDoctor({
    platformOAuthConfigured: platformOAuth.configured,
    encryptionVaultReady: snapshot.capabilities.encryptedVaultReady,
    redirectUri: platformOAuth.redirectUri,
    connection: listRes.activeConnection,
    accessToken,
    targetProject,
    targetDeployments,
    fetchImpl: ctx.fetchImpl,
  });
}

export async function discoverWorkspaceDriveAppsScripts(
  uid: string,
  workspaceId: string,
  input: { query?: string; pageToken?: string; pageSize?: number; connectionId?: string },
  ctx: Phase2ExecutionContext = {},
): Promise<DriveDiscoveryResult> {
  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'apps_script:read',
    preferredConnectionId: input.connectionId,
    ctx,
  });

  const result = await discoverAppsScriptProjects({
    accessToken: resolved.accessToken,
    query: input.query,
    pageToken: input.pageToken,
    pageSize: input.pageSize,
    fetchImpl: ctx.fetchImpl,
  });

  return result;
}

export async function listWorkspaceAppsScriptProjects(
  uid: string,
  workspaceId: string,
  ctx: Phase2ExecutionContext = {},
): Promise<AppsScriptProjectRecord[]> {
  const { store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'apps_script:read',
    ctx,
  );
  const docs = await store.listWorkspaceSubcollection(
    workspaceId,
    'appsScriptProjects',
  );
  return docs
    .map(mapProjectDoc)
    .filter((p) => p.status !== 'detached')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createOrImportWorkspaceAppsScriptProject(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input:
    | {
        mode: 'create';
        title: string;
        parentId?: string;
        templateKey?: string;
        timezone?: string;
        connectionId?: string;
        idempotencyKey?: string;
      }
    | {
        mode: 'import';
        scriptId: string;
        title?: string;
        ownershipKind?: 'owned_by_user' | 'shared_with_user';
        connectionId?: string;
      },
  ctx: Phase2ExecutionContext = {},
): Promise<{
  project: AppsScriptProjectRecord;
  files: AppsScriptFile[];
  snapshotId?: string;
  idempotentReplay?: boolean;
}> {
  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'apps_script:write',
    preferredConnectionId: input.connectionId,
    ctx,
  });

  if (input.mode === 'create' && input.idempotencyKey) {
    const existingAll = await resolved.store.listWorkspaceSubcollection(
      workspaceId,
      'appsScriptProjects',
    );
    const hit = existingAll.find(
      (d) =>
        d.idempotencyKey === input.idempotencyKey &&
        d.status === 'active',
    );
    if (hit) {
      const mapped = mapProjectDoc(hit);
      const remote = await getAppsScriptContent(
        resolved.accessToken,
        mapped.scriptId,
        ctx.fetchImpl,
      );
      return {
        project: mapped,
        files: remote.files || [],
        idempotentReplay: true,
      };
    }
  }

  let scriptId: string;
  let title: string;
  let parentId: string | undefined;
  let ownershipKind: AppsScriptProjectRecord['ownershipKind'];
  let projectType: AppsScriptProjectRecord['projectType'];
  let initialFiles: AppsScriptFile[] = [];
  let templateKey: string | undefined;

  if (input.mode === 'create') {
    const requestedKey = input.templateKey || 'antara_base_automation';
    const template =
      getAppsScriptTemplate(requestedKey) ||
      getPhase4MarketingAppsScriptTemplate(requestedKey);
    if (!template) {
      throw new AppError(
        400,
        'INVALID_TEMPLATE',
        `Unknown Apps Script starter template key: ${input.templateKey}`,
      );
    }

    const createdMeta = await createAppsScriptProject(
      resolved.accessToken,
      { title: input.title, parentId: input.parentId },
      ctx.fetchImpl,
    );
    scriptId = createdMeta.scriptId;
    title = createdMeta.title || input.title;
    parentId = createdMeta.parentId || input.parentId;
    ownershipKind = 'created_by_antara';
    projectType = parentId ? 'bound' : 'standalone';

    templateKey = template.key;
    const timezone = input.timezone || DEFAULT_WORKSPACE_TIMEZONE;
    initialFiles = template.buildFiles(timezone);

    // Push starter files cleanly through updateProjectContent
    await protectedUpdateProjectContent({
      accessToken: resolved.accessToken,
      workspaceId,
      scriptId,
      nextFiles: initialFiles,
      changeSummary: `Initialize project with Antara starter template (${template.name})`,
      actorUid: uid,
      actorEmail: userEmail,
      confirmFileDeletions: true,
      reason: 'pre_update_backup',
      fetchImpl: ctx.fetchImpl,
      persistSnapshot: async (snap) => {
        await resolved.store.commit([
          {
            path: `workspaces/${workspaceId}/appsScriptSnapshots/${snap.id}`,
            data: { ...snap },
          },
        ]);
      },
    });
  } else {
    const meta = await getAppsScriptProject(
      resolved.accessToken,
      input.scriptId,
      ctx.fetchImpl,
    );
    const content = await getAppsScriptContent(
      resolved.accessToken,
      input.scriptId,
      ctx.fetchImpl,
    );
    scriptId = meta.scriptId || input.scriptId;
    title = input.title?.trim() || meta.title || `Script ${scriptId.slice(0, 8)}`;
    parentId = meta.parentId;
    ownershipKind = input.ownershipKind || 'owned_by_user';
    projectType = parentId ? 'bound' : 'standalone';
    initialFiles = content.files || [];
  }

  const contentHash = computeProjectContentHash(initialFiles);
  const now = new Date().toISOString();
  const importSnapshot = createSnapshotRecord({
    workspaceId,
    scriptId,
    files: initialFiles,
    changeSummary:
      input.mode === 'create'
        ? `Created Apps Script project "${title}"`
        : `Imported existing Apps Script project "${title}"`,
    reason: 'manual_backup',
    actorUid: uid,
    actorEmail: userEmail,
  });

  const projectRecord: AppsScriptProjectRecord = {
    id: scriptId,
    scriptId,
    workspaceId,
    ownerUid: uid,
    ownerConnectionId: resolved.connection.id,
    title,
    ...(parentId ? { parentId } : {}),
    projectType,
    ownershipKind,
    lastKnownContentHash: contentHash,
    lastSyncAt: now,
    status: 'active',
    ...(templateKey ? { templateKey } : {}),
    editorUrl: `https://script.google.com/home/projects/${scriptId}/edit`,
    createdAt: now,
    updatedAt: now,
  };

  await resolved.store.commit([
    {
      path: `workspaces/${workspaceId}/appsScriptSnapshots/${importSnapshot.id}`,
      data: { ...importSnapshot },
    },
    {
      path: `workspaces/${workspaceId}/appsScriptProjects/${scriptId}`,
      data: {
        ...projectRecord,
        ...(input.mode === 'create' && input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    },
  ]);

  await recordGoogleIntegrationAudit(resolved.store, workspaceId, {
    actorUid: uid,
    actorEmail: userEmail,
    operation:
      input.mode === 'create'
        ? 'apps_script.project_created'
        : 'apps_script.project_imported',
    targetScriptId: scriptId,
    connectionId: resolved.connection.id,
    providerClassification: 'success',
    summary:
      input.mode === 'create'
        ? `Created Apps Script project "${title}" (${scriptId}).`
        : `Linked existing Apps Script project "${title}" (${scriptId}) with initial backup snapshot.`,
  });

  return {
    project: projectRecord,
    files: initialFiles,
    snapshotId: importSnapshot.id,
  };
}

export async function detachWorkspaceAppsScriptProject(
  uid: string,
  userEmail: string,
  workspaceId: string,
  scriptId: string,
  ctx: Phase2ExecutionContext = {},
): Promise<void> {
  const { store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'apps_script:write',
    ctx,
  );
  const path = `workspaces/${workspaceId}/appsScriptProjects/${scriptId}`;
  const existing = await store.getDoc(path);
  if (!existing) {
    throw new AppError(404, 'SCRIPT_PROJECT_NOT_FOUND', 'Linked Apps Script project not found.');
  }
  assertCrossTenantMatch(String(existing.workspaceId), workspaceId, 'Apps Script project');

  await store.commit([
    {
      path,
      data: { status: 'detached' },
      updateMask: ['status', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordGoogleIntegrationAudit(store, workspaceId, {
    actorUid: uid,
    actorEmail: userEmail,
    operation: 'apps_script.project_detached',
    targetScriptId: scriptId,
    providerClassification: 'success',
    summary: `Detached Antara workspace link for "${String(existing.title)}" (${scriptId}). Remote Google Apps Script files remain untouched.`,
  });
}

export async function getProjectDetailsAndContent(
  uid: string,
  workspaceId: string,
  scriptId: string,
  ctx: Phase2ExecutionContext = {},
): Promise<{
  project: AppsScriptProjectRecord;
  files: AppsScriptFile[];
  validation: ReturnType<typeof validateAppsScriptProject>;
  snapshots: AppsScriptSnapshotRecord[];
}> {
  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'apps_script:read',
    ctx,
  });

  const rawProj = await resolved.store.getDoc(
    `workspaces/${workspaceId}/appsScriptProjects/${scriptId}`,
  );
  if (!rawProj || rawProj.status === 'detached') {
    throw new AppError(404, 'SCRIPT_PROJECT_NOT_FOUND', 'Apps Script project is not linked to this workspace.');
  }

  const project = mapProjectDoc(rawProj);
  const [content, allSnapshots] = await Promise.all([
    getAppsScriptContent(resolved.accessToken, scriptId, ctx.fetchImpl),
    resolved.store.listWorkspaceSubcollection(workspaceId, 'appsScriptSnapshots'),
  ]);

  const files = content.files || [];
  const validation = validateAppsScriptProject({ scriptId, files });
  const snapshots = (allSnapshots as unknown as AppsScriptSnapshotRecord[])
    .filter((s) => s.scriptId === scriptId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { project, files, validation, snapshots };
}

export async function updateWorkspaceProjectContentProtected(
  uid: string,
  userEmail: string,
  workspaceId: string,
  scriptId: string,
  input: {
    files: AppsScriptFile[];
    changeSummary: string;
    confirmFileDeletions?: boolean;
  },
  ctx: Phase2ExecutionContext = {},
): Promise<ProtectedUpdateResult> {
  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'apps_script:write',
    ctx,
  });

  const projPath = `workspaces/${workspaceId}/appsScriptProjects/${scriptId}`;
  const rawProj = await resolved.store.getDoc(projPath);
  if (!rawProj || rawProj.status === 'detached') {
    throw new AppError(404, 'SCRIPT_PROJECT_NOT_FOUND', 'Apps Script project not found.');
  }

  const result = await protectedUpdateProjectContent({
    accessToken: resolved.accessToken,
    workspaceId,
    scriptId,
    nextFiles: input.files,
    changeSummary: input.changeSummary,
    actorUid: uid,
    actorEmail: userEmail,
    confirmFileDeletions: input.confirmFileDeletions,
    reason: 'pre_update_backup',
    fetchImpl: ctx.fetchImpl,
    persistSnapshot: async (snapshot) => {
      await resolved.store.commit([
        {
          path: `workspaces/${workspaceId}/appsScriptSnapshots/${snapshot.id}`,
          data: { ...snapshot },
        },
      ]);
    },
  });

  const now = new Date().toISOString();
  await resolved.store.commit([
    {
      path: projPath,
      data: {
        lastKnownContentHash: result.verifiedContentHash,
        lastSyncAt: now,
      },
      updateMask: ['lastKnownContentHash', 'lastSyncAt', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordGoogleIntegrationAudit(resolved.store, workspaceId, {
    actorUid: uid,
    actorEmail: userEmail,
    operation: 'apps_script.content_updated',
    targetScriptId: scriptId,
    connectionId: resolved.connection.id,
    providerClassification: 'success',
    summary: `Updated "${String(rawProj.title)}" (${input.changeSummary}). Pre-update backup: ${result.preUpdateSnapshotId}. Parity: ${result.verifiedFileParity}.`,
  });

  return result;
}

export async function restoreWorkspaceProjectSnapshot(
  uid: string,
  userEmail: string,
  workspaceId: string,
  scriptId: string,
  snapshotId: string,
  ctx: Phase2ExecutionContext = {},
): Promise<ProtectedUpdateResult> {
  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'apps_script:write',
    ctx,
  });

  const snapRaw = await resolved.store.getDoc(
    `workspaces/${workspaceId}/appsScriptSnapshots/${snapshotId}`,
  );
  if (!snapRaw || String(snapRaw.scriptId) !== scriptId) {
    throw new AppError(404, 'SNAPSHOT_NOT_FOUND', 'Backup snapshot not found for this project.');
  }
  const snapshot = snapRaw as unknown as AppsScriptSnapshotRecord;

  const result = await protectedUpdateProjectContent({
    accessToken: resolved.accessToken,
    workspaceId,
    scriptId,
    nextFiles: snapshot.files,
    changeSummary: `Restore snapshot ${snapshotId} (${snapshot.changeSummary})`,
    actorUid: uid,
    actorEmail: userEmail,
    confirmFileDeletions: true,
    reason: 'restore',
    fetchImpl: ctx.fetchImpl,
    persistSnapshot: async (preSnap) => {
      await resolved.store.commit([
        {
          path: `workspaces/${workspaceId}/appsScriptSnapshots/${preSnap.id}`,
          data: { ...preSnap },
        },
      ]);
    },
  });

  await recordGoogleIntegrationAudit(resolved.store, workspaceId, {
    actorUid: uid,
    actorEmail: userEmail,
    operation: 'apps_script.snapshot_restored',
    targetScriptId: scriptId,
    connectionId: resolved.connection.id,
    providerClassification: 'success',
    summary: `Restored project ${scriptId} from snapshot ${snapshotId}.`,
  });

  return result;
}

export async function listAndSyncProjectVersions(
  uid: string,
  workspaceId: string,
  scriptId: string,
  ctx: Phase2ExecutionContext = {},
): Promise<AppsScriptVersionRecord[]> {
  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'apps_script:read',
    ctx,
  });

  const [localRaw, remote] = await Promise.all([
    resolved.store.listWorkspaceSubcollection(workspaceId, 'appsScriptVersions'),
    listAppsScriptVersions(resolved.accessToken, scriptId, ctx.fetchImpl).catch(() => ({
      versions: [],
    })),
  ]);

  const byVersion = new Map<number, AppsScriptVersionRecord>();
  for (const d of localRaw) {
    if (String(d.scriptId) !== scriptId) continue;
    const v = d as unknown as AppsScriptVersionRecord;
    byVersion.set(Number(v.versionNumber), v);
  }

  for (const rv of remote.versions) {
    if (!byVersion.has(rv.versionNumber)) {
      byVersion.set(rv.versionNumber, {
        id: `v${rv.versionNumber}`,
        workspaceId,
        scriptId,
        versionNumber: rv.versionNumber,
        description: rv.description || `Google Apps Script Version v${rv.versionNumber}`,
        snapshotId: '',
        manifestJson: '{}',
        creatorUid: 'google_upstream',
        creatorEmail: 'Google Apps Script',
        changeSummary: rv.description || `Upstream version ${rv.versionNumber}`,
        createdAt: rv.createTime || new Date().toISOString(),
      });
    }
  }

  return Array.from(byVersion.values()).sort(
    (a, b) => b.versionNumber - a.versionNumber,
  );
}

export async function createWorkspaceProjectVersionRelease(
  uid: string,
  userEmail: string,
  workspaceId: string,
  scriptId: string,
  input: { description: string; changeSummary?: string },
  ctx: Phase2ExecutionContext = {},
): Promise<AppsScriptVersionRecord> {
  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'apps_script:write',
    ctx,
  });

  const content = await getAppsScriptContent(
    resolved.accessToken,
    scriptId,
    ctx.fetchImpl,
  );
  const validation = validateAppsScriptProject({
    scriptId,
    files: content.files || [],
  });
  if (!validation.valid) {
    throw new AppError(
      400,
      'VERSION_VALIDATION_FAILED',
      validation.diagnostics.find((d) => d.severity === 'error')?.message ||
        'Cannot create immutable version because project validation failed.',
    );
  }

  const googleVersion = await createAppsScriptVersion(
    resolved.accessToken,
    scriptId,
    input.description,
    ctx.fetchImpl,
  );

  const existingVersions = await resolved.store.listWorkspaceSubcollection(
    workspaceId,
    'appsScriptVersions',
  );
  const highestPrev = existingVersions
    .filter((d) => String(d.scriptId) === scriptId)
    .map((d) => Number(d.versionNumber || 0))
    .reduce((max, n) => Math.max(max, n), 0);

  const snapshot = createSnapshotRecord({
    workspaceId,
    scriptId,
    files: content.files || [],
    changeSummary: input.changeSummary || input.description,
    reason: 'version_release',
    actorUid: uid,
    actorEmail: userEmail,
    versionNumber: googleVersion.versionNumber,
  });

  const versionDocId = `${scriptId}_v${googleVersion.versionNumber}`;
  const versionRecord: AppsScriptVersionRecord = {
    id: versionDocId,
    workspaceId,
    scriptId,
    versionNumber: googleVersion.versionNumber,
    description: googleVersion.description || input.description,
    snapshotId: snapshot.id,
    manifestJson: snapshot.manifestJson,
    creatorUid: uid,
    creatorEmail: userEmail,
    changeSummary: input.changeSummary || input.description,
    ...(highestPrev > 0 ? { previousVersionNumber: highestPrev } : {}),
    createdAt: googleVersion.createTime || new Date().toISOString(),
  };

  await resolved.store.commit([
    {
      path: `workspaces/${workspaceId}/appsScriptSnapshots/${snapshot.id}`,
      data: { ...snapshot },
    },
    {
      path: `workspaces/${workspaceId}/appsScriptVersions/${versionDocId}`,
      data: { ...versionRecord },
    },
  ]);

  await recordGoogleIntegrationAudit(resolved.store, workspaceId, {
    actorUid: uid,
    actorEmail: userEmail,
    operation: 'apps_script.version_created',
    targetScriptId: scriptId,
    connectionId: resolved.connection.id,
    providerClassification: 'success',
    summary: `Published immutable Apps Script version v${versionRecord.versionNumber}: "${versionRecord.description}".`,
  });

  return versionRecord;
}

function classifyRemoteDeployment(
  dep: GoogleAppsScriptDeploymentResponse,
): {
  deploymentType: AppsScriptDeploymentRecord['deploymentType'];
  webAppUrl?: string;
  accessLevel?: AppsScriptDeploymentRecord['accessLevel'];
  executeAs?: AppsScriptDeploymentRecord['executeAs'];
} {
  const entryPoints = dep.entryPoints || [];
  const webAppEntry = entryPoints.find((e) => e.entryPointType === 'WEB_APP');
  const execEntry = entryPoints.find((e) => e.entryPointType === 'EXECUTION_API');

  if (execEntry && !webAppEntry) {
    return {
      deploymentType: 'API_EXECUTABLE',
      accessLevel: (execEntry.executionApi?.entryPointConfig?.access as AppsScriptDeploymentRecord['accessLevel']) || 'MYSELF',
    };
  }
  return {
    deploymentType: webAppEntry ? 'WEB_APP' : 'API_EXECUTABLE',
    webAppUrl: webAppEntry?.webApp?.url,
    accessLevel: (webAppEntry?.webApp?.entryPointConfig?.access as AppsScriptDeploymentRecord['accessLevel']) || 'MYSELF',
    executeAs: (webAppEntry?.webApp?.entryPointConfig?.executeAs as AppsScriptDeploymentRecord['executeAs']) || 'USER_DEPLOYING',
  };
}

export async function listAndVerifyProjectDeployments(
  uid: string,
  workspaceId: string,
  scriptId: string,
  ctx: Phase2ExecutionContext = {},
): Promise<AppsScriptDeploymentRecord[]> {
  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'apps_script:read',
    ctx,
  });

  const remote = await listAppsScriptDeployments(
    resolved.accessToken,
    scriptId,
    ctx.fetchImpl,
  );
  const storedRaw = await resolved.store.listWorkspaceSubcollection(
    workspaceId,
    'appsScriptDeployments',
  );

  const now = new Date().toISOString();
  const byDeploymentId = new Map<string, AppsScriptDeploymentRecord>();

  for (const row of storedRaw) {
    const mapped = mapDeploymentDoc(row);
    if (mapped.scriptId === scriptId) {
      byDeploymentId.set(mapped.deploymentId, mapped);
    }
  }

  for (const dep of remote.deployments) {
    const classified = classifyRemoteDeployment(dep);
    const existing = byDeploymentId.get(dep.deploymentId);
    const versionNum = Number(dep.deploymentConfig?.versionNumber || 0);
    // Skip HEAD read-only synthetic deployment unless explicitly tracked
    if (!versionNum && !existing) continue;

    byDeploymentId.set(dep.deploymentId, {
      id: dep.deploymentId,
      workspaceId,
      scriptId,
      deploymentId: dep.deploymentId,
      deploymentType: existing?.deploymentType || classified.deploymentType,
      versionNumber: versionNum || existing?.versionNumber || 1,
      description:
        dep.deploymentConfig?.description ||
        existing?.description ||
        'Google Apps Script Deployment',
      accessLevel: classified.accessLevel || existing?.accessLevel,
      executeAs: classified.executeAs || existing?.executeAs,
      webAppUrl: classified.webAppUrl || existing?.webAppUrl,
      entryPointsJson: JSON.stringify(dep.entryPoints || []),
      status: 'active',
      verified: true,
      lastVerifiedAt: now,
      createdByUid: existing?.createdByUid || uid,
      createdAt: existing?.createdAt || dep.updateTime || now,
      updatedAt: dep.updateTime || now,
    });
  }

  return Array.from(byDeploymentId.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export async function createWorkspaceProjectDeployment(
  uid: string,
  userEmail: string,
  workspaceId: string,
  scriptId: string,
  input: {
    deploymentType: 'WEB_APP' | 'API_EXECUTABLE';
    versionNumber?: number;
    description: string;
    accessLevel?: 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS';
    executeAs?: 'USER_ACCESSING' | 'USER_DEPLOYING';
    confirmPublicAccess?: boolean;
  },
  ctx: Phase2ExecutionContext = {},
): Promise<AppsScriptDeploymentRecord> {
  const { member } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'apps_script:deploy',
    ctx,
  );

  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'apps_script:deploy',
    ctx,
  });

  // Security guard: public Web App deployment requires explicit approval + confirmation
  const requestedAccess = input.accessLevel || 'MYSELF';
  if (
    input.deploymentType === 'WEB_APP' &&
    (requestedAccess === 'ANYONE' || requestedAccess === 'ANYONE_ANONYMOUS')
  ) {
    if (!input.confirmPublicAccess) {
      throw new AppError(
        409,
        'PUBLIC_ACCESS_CONFIRMATION_REQUIRED',
        `Public Web App access (${requestedAccess}) requires explicit owner/admin confirmation (confirmPublicAccess=true).`,
      );
    }
    if (member.role !== 'owner' && member.role !== 'admin') {
      throw new AppError(
        403,
        'APPS_SCRIPT_APPROVAL_REQUIRED',
        'Only a Workspace Owner or Admin can approve public (ANYONE / ANYONE_ANONYMOUS) deployments.',
      );
    }
  }

  // Ensure manifest aligns with intended deployment type (executionApi vs webapp) cleanly before versioning
  const content = await getAppsScriptContent(
    resolved.accessToken,
    scriptId,
    ctx.fetchImpl,
  );
  const files = content.files || [];
  const manifestIdx = files.findIndex(
    (f) => f.type === 'JSON' && (f.name === 'appsscript' || f.name === 'appsscript.json'),
  );
  const currentManifest =
    manifestIdx >= 0
      ? parseAndValidateManifest(files[manifestIdx]!.source).manifest
      : null;

  let targetVersionNumber = input.versionNumber;
  if (!targetVersionNumber) {
    // Prepare manifest entry point defaults (MYSELF / USER_DEPLOYING by default)
    const nextManifest = currentManifest
      ? { ...currentManifest }
      : buildDefaultManifest({ timeZone: DEFAULT_WORKSPACE_TIMEZONE });

    if (input.deploymentType === 'API_EXECUTABLE') {
      nextManifest.executionApi = {
        access:
          requestedAccess === 'ANYONE' || requestedAccess === 'DOMAIN'
            ? requestedAccess
            : 'MYSELF',
      };
    } else {
      nextManifest.webapp = {
        access: requestedAccess,
        executeAs: input.executeAs || 'USER_DEPLOYING',
      };
    }

    const nextManifestJson = serializeManifest(nextManifest);
    if (manifestIdx >= 0 && files[manifestIdx]!.source !== nextManifestJson) {
      const updatedFiles = [...files];
      updatedFiles[manifestIdx] = {
        ...updatedFiles[manifestIdx]!,
        source: nextManifestJson,
      };
      await updateWorkspaceProjectContentProtected(
        uid,
        userEmail,
        workspaceId,
        scriptId,
        {
          files: updatedFiles,
          changeSummary: `Configure manifest entryPoint for ${input.deploymentType} (${requestedAccess})`,
          confirmFileDeletions: false,
        },
        ctx,
      );
    }

    const newVer = await createWorkspaceProjectVersionRelease(
      uid,
      userEmail,
      workspaceId,
      scriptId,
      {
        description: `${input.description} (${input.deploymentType})`,
        changeSummary: `Version auto-published for ${input.deploymentType} deployment`,
      },
      ctx,
    );
    targetVersionNumber = newVer.versionNumber;
  }

  const createdDep = await createAppsScriptDeployment(
    resolved.accessToken,
    scriptId,
    {
      versionNumber: targetVersionNumber,
      description: input.description,
    },
    ctx.fetchImpl,
  );

  // Immediately reconcile deployments.list to confirm live entryPoints/webAppUrl
  const remoteList = await listAppsScriptDeployments(
    resolved.accessToken,
    scriptId,
    ctx.fetchImpl,
  ).catch(() => ({ deployments: [createdDep] }));
  const verifiedDep =
    remoteList.deployments.find((d) => d.deploymentId === createdDep.deploymentId) ||
    createdDep;

  const classified = classifyRemoteDeployment(verifiedDep);
  const now = new Date().toISOString();
  const record: AppsScriptDeploymentRecord = {
    id: verifiedDep.deploymentId,
    workspaceId,
    scriptId,
    deploymentId: verifiedDep.deploymentId,
    deploymentType: input.deploymentType,
    versionNumber: targetVersionNumber,
    description: input.description,
    accessLevel: classified.accessLevel || requestedAccess,
    executeAs:
      input.deploymentType === 'WEB_APP'
        ? classified.executeAs || input.executeAs || 'USER_DEPLOYING'
        : undefined,
    webAppUrl: classified.webAppUrl,
    entryPointsJson: JSON.stringify(verifiedDep.entryPoints || []),
    status: 'active',
    verified: true,
    lastVerifiedAt: now,
    createdByUid: uid,
    createdAt: now,
    updatedAt: now,
  };

  await resolved.store.commit([
    {
      path: `workspaces/${workspaceId}/appsScriptDeployments/${record.deploymentId}`,
      data: { ...record },
    },
  ]);

  await recordGoogleIntegrationAudit(resolved.store, workspaceId, {
    actorUid: uid,
    actorEmail: userEmail,
    operation: 'apps_script.deployment_created',
    targetScriptId: scriptId,
    connectionId: resolved.connection.id,
    providerClassification: 'success',
    summary: `Deployed ${input.deploymentType} v${targetVersionNumber} (${record.deploymentId}) with access=${record.accessLevel}.`,
  });

  return record;
}

export async function updateWorkspaceDeploymentVersion(
  uid: string,
  userEmail: string,
  workspaceId: string,
  scriptId: string,
  input: {
    deploymentId: string;
    versionNumber: number;
    description: string;
    confirmProductionUpdate?: boolean;
  },
  ctx: Phase2ExecutionContext = {},
): Promise<AppsScriptDeploymentRecord> {
  if (!input.confirmProductionUpdate) {
    throw new AppError(
      409,
      'DEPLOYMENT_UPDATE_CONFIRMATION_REQUIRED',
      'Updating or rolling back a live deployment requires explicit confirmation (confirmProductionUpdate=true).',
    );
  }

  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'apps_script:deploy',
    ctx,
  });

  const existingRaw = await resolved.store.getDoc(
    `workspaces/${workspaceId}/appsScriptDeployments/${input.deploymentId}`,
  );
  const existing = existingRaw ? mapDeploymentDoc(existingRaw) : null;

  const updatedRemote = await updateAppsScriptDeployment(
    resolved.accessToken,
    scriptId,
    input.deploymentId,
    {
      versionNumber: input.versionNumber,
      description: input.description,
    },
    ctx.fetchImpl,
  );

  const classified = classifyRemoteDeployment(updatedRemote);
  const now = new Date().toISOString();
  const next: AppsScriptDeploymentRecord = {
    id: input.deploymentId,
    workspaceId,
    scriptId,
    deploymentId: input.deploymentId,
    deploymentType: existing?.deploymentType || classified.deploymentType,
    versionNumber: input.versionNumber,
    description: input.description,
    accessLevel: classified.accessLevel || existing?.accessLevel,
    executeAs: classified.executeAs || existing?.executeAs,
    webAppUrl: classified.webAppUrl || existing?.webAppUrl,
    entryPointsJson: JSON.stringify(updatedRemote.entryPoints || []),
    status: 'active',
    verified: true,
    lastVerifiedAt: now,
    createdByUid: existing?.createdByUid || uid,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await resolved.store.commit([
    {
      path: `workspaces/${workspaceId}/appsScriptDeployments/${input.deploymentId}`,
      data: { ...next },
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordGoogleIntegrationAudit(resolved.store, workspaceId, {
    actorUid: uid,
    actorEmail: userEmail,
    operation: 'apps_script.deployment_updated',
    targetScriptId: scriptId,
    connectionId: resolved.connection.id,
    providerClassification: 'success',
    summary: `Switched deployment ${input.deploymentId} to version v${input.versionNumber} (${input.description}).`,
  });

  return next;
}

export async function retireWorkspaceProjectDeployment(
  uid: string,
  userEmail: string,
  workspaceId: string,
  scriptId: string,
  deploymentId: string,
  ctx: Phase2ExecutionContext = {},
): Promise<void> {
  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'apps_script:deploy',
    ctx,
  });

  await deleteAppsScriptDeployment(
    resolved.accessToken,
    scriptId,
    deploymentId,
    ctx.fetchImpl,
  );

  await resolved.store.commit([
    {
      path: `workspaces/${workspaceId}/appsScriptDeployments/${deploymentId}`,
      data: { status: 'archived' },
      updateMask: ['status', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordGoogleIntegrationAudit(resolved.store, workspaceId, {
    actorUid: uid,
    actorEmail: userEmail,
    operation: 'apps_script.deployment_retired',
    targetScriptId: scriptId,
    connectionId: resolved.connection.id,
    providerClassification: 'success',
    summary: `Retired Apps Script deployment ${deploymentId}.`,
  });
}

export async function listExecutionRegistryAndHistory(
  uid: string,
  workspaceId: string,
  scriptId: string,
  ctx: Phase2ExecutionContext = {},
): Promise<{
  targets: ApprovedExecutionTarget[];
  executions: ScriptExecutionRecord[];
  processes: Array<Record<string, unknown>>;
}> {
  const { store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'apps_script:read',
    ctx,
  );

  const [targetsRaw, execRaw] = await Promise.all([
    store.listWorkspaceSubcollection(workspaceId, 'approvedExecutionTargets'),
    store.listWorkspaceSubcollection(workspaceId, 'scriptExecutions'),
  ]);

  const targets = (targetsRaw as unknown as ApprovedExecutionTarget[]).filter(
    (t) => t.scriptId === scriptId,
  );
  const executions = (execRaw as unknown as ScriptExecutionRecord[])
    .filter((e) => e.scriptId === scriptId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  let processes: Array<Record<string, unknown>> = [];
  try {
    const resolved = await resolveConnectionAndAccessToken({
      uid,
      workspaceId,
      requiredPermission: 'apps_script:read',
      ctx,
    });
    if (resolved.scopes.includes('https://www.googleapis.com/auth/script.processes')) {
      const p = await listAppsScriptProcesses(
        resolved.accessToken,
        scriptId,
        ctx.fetchImpl,
      );
      processes = p.processes as unknown as Array<Record<string, unknown>>;
    }
  } catch {
    processes = [];
  }

  return { targets, executions, processes };
}

export async function registerApprovedExecutionTarget(
  uid: string,
  userEmail: string,
  workspaceId: string,
  scriptId: string,
  input: {
    deploymentId: string;
    functionName: string;
    description: string;
    requiredScopes?: string[];
    riskClassification: 'low' | 'medium' | 'high';
    requiresHumanApproval?: boolean;
    parameterSchemaJson?: string;
    expectedOutputSummary?: string;
    timeoutSeconds?: number;
  },
  ctx: Phase2ExecutionContext = {},
): Promise<ApprovedExecutionTarget> {
  const { store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'apps_script:approve',
    ctx,
  );

  const depRaw = await store.getDoc(
    `workspaces/${workspaceId}/appsScriptDeployments/${input.deploymentId}`,
  );
  if (!depRaw || String(depRaw.scriptId) !== scriptId) {
    throw new AppError(
      404,
      'DEPLOYMENT_NOT_FOUND',
      'Target deploymentId was not found under this workspace project.',
    );
  }
  const dep = mapDeploymentDoc(depRaw);
  if (dep.deploymentType !== 'API_EXECUTABLE' || dep.status !== 'active') {
    throw new AppError(
      400,
      'API_EXECUTABLE_REQUIRED',
      'Only active API_EXECUTABLE deployments can be registered in the Approved Execution Registry.',
    );
  }

  const id = `${scriptId}_${input.functionName}`;
  const target: ApprovedExecutionTarget = {
    id,
    workspaceId,
    scriptId,
    deploymentId: input.deploymentId,
    functionName: input.functionName,
    description: input.description,
    requiredScopes: input.requiredScopes || [],
    riskClassification: input.riskClassification,
    requiresHumanApproval:
      input.riskClassification === 'high' ? true : Boolean(input.requiresHumanApproval),
    parameterSchemaJson: input.parameterSchemaJson || '{"type":"array","items":{}}',
    expectedOutputSummary: input.expectedOutputSummary || 'JSON execution result object',
    timeoutSeconds: input.timeoutSeconds || 30,
    createdByUid: uid,
    createdAt: new Date().toISOString(),
  };

  await store.commit([
    {
      path: `workspaces/${workspaceId}/approvedExecutionTargets/${id}`,
      data: { ...target },
    },
  ]);

  await recordGoogleIntegrationAudit(store, workspaceId, {
    actorUid: uid,
    actorEmail: userEmail,
    operation: 'apps_script.execution_target_approved',
    targetScriptId: scriptId,
    providerClassification: 'success',
    summary: `Approved allowlisted execution function "${input.functionName}" on deployment ${input.deploymentId} (risk=${input.riskClassification}).`,
  });

  return target;
}

export async function executeAllowlistedScriptFunction(
  uid: string,
  userEmail: string,
  workspaceId: string,
  scriptId: string,
  input: {
    deploymentId: string;
    functionName: string;
    parameters?: unknown[];
    approvalConfirmed?: boolean;
    idempotencyKey?: string;
  },
  ctx: Phase2ExecutionContext = {},
): Promise<ScriptExecutionRecord> {
  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'apps_script:execute',
    ctx,
  });

  if (input.idempotencyKey) {
    const existingExecs = await resolved.store.listWorkspaceSubcollection(
      workspaceId,
      'scriptExecutions',
    );
    const replay = (existingExecs as unknown as ScriptExecutionRecord[]).find(
      (e) => e.idempotencyKey === input.idempotencyKey && e.scriptId === scriptId,
    );
    if (replay) return replay;
  }

  // 1. Strict Allowlist Verification
  const targetsRaw = await resolved.store.listWorkspaceSubcollection(
    workspaceId,
    'approvedExecutionTargets',
  );
  const target = (targetsRaw as unknown as ApprovedExecutionTarget[]).find(
    (t) =>
      t.scriptId === scriptId &&
      t.deploymentId === input.deploymentId &&
      t.functionName === input.functionName,
  );

  if (!target) {
    await recordGoogleIntegrationAudit(resolved.store, workspaceId, {
      actorUid: uid,
      actorEmail: userEmail,
      operation: 'apps_script.execution_blocked',
      targetScriptId: scriptId,
      connectionId: resolved.connection.id,
      providerClassification: 'blocked',
      summary: `Blocked unapproved function execution "${input.functionName}" on deployment ${input.deploymentId}.`,
    });
    throw new AppError(
      403,
      'EXECUTION_NOT_ALLOWLISTED',
      `Function "${input.functionName}" is not approved on API Executable deployment "${input.deploymentId}". Register it in Approved Execution Registry first.`,
    );
  }

  // 2. Verify Deployment is active API_EXECUTABLE
  const depRaw = await resolved.store.getDoc(
    `workspaces/${workspaceId}/appsScriptDeployments/${input.deploymentId}`,
  );
  if (!depRaw) {
    throw new AppError(
      404,
      'API_EXECUTABLE_NOT_DEPLOYED',
      'API Executable deployment record not found.',
    );
  }
  const dep = mapDeploymentDoc(depRaw);
  if (dep.deploymentType !== 'API_EXECUTABLE' || dep.status !== 'active') {
    throw new AppError(
      400,
      'API_EXECUTABLE_NOT_DEPLOYED',
      'Target deployment is not an active API_EXECUTABLE deployment.',
    );
  }

  // 3. Human approval guard for high-risk or confirmation-required targets
  if ((target.requiresHumanApproval || target.riskClassification === 'high') && !input.approvalConfirmed) {
    throw new AppError(
      409,
      'EXECUTION_APPROVAL_REQUIRED',
      `Executing "${input.functionName}" (${target.riskClassification} risk) requires explicit human confirmation (approvalConfirmed=true).`,
    );
  }

  // 4. Verify all scopes required by target & script manifest are granted
  const grantedSet = new Set(normalizeGrantedScopeList(resolved.scopes));
  const missingScopes = target.requiredScopes.filter((s) => !grantedSet.has(s));
  if (missingScopes.length > 0) {
    throw new AppError(
      403,
      'EXECUTION_SCOPE_REQUIRED',
      `Missing execution OAuth scope(s): ${missingScopes.join(', ')}. Use incremental Google authorization first.`,
    );
  }

  const execId = makeId('exec');
  const startedAt = new Date().toISOString();

  try {
    const response = await runAppsScriptFunction(
      resolved.accessToken,
      input.deploymentId,
      {
        functionName: input.functionName,
        parameters: input.parameters || [],
        devMode: false,
      },
      ctx.fetchImpl,
    );

    const finishedAt = new Date().toISOString();
    if (response.error) {
      const failedRec: ScriptExecutionRecord = {
        id: execId,
        workspaceId,
        scriptId,
        deploymentId: input.deploymentId,
        functionName: input.functionName,
        parametersJson: JSON.stringify(input.parameters || []),
        initiatorUid: uid,
        initiatorEmail: userEmail,
        riskClassification: target.riskClassification,
        approvalConfirmed: Boolean(input.approvalConfirmed),
        status: 'failed',
        startedAt,
        finishedAt,
        errorCode: 'SCRIPT_RUNTIME_ERROR',
        errorMessage: response.error.message || 'Apps Script function threw a runtime error.',
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      };

      await resolved.store.commit([
        {
          path: `workspaces/${workspaceId}/scriptExecutions/${execId}`,
          data: { ...failedRec },
        },
      ]);

      await recordGoogleIntegrationAudit(resolved.store, workspaceId, {
        actorUid: uid,
        actorEmail: userEmail,
        operation: 'apps_script.execution_failed',
        targetScriptId: scriptId,
        connectionId: resolved.connection.id,
        providerClassification: 'error',
        summary: `Execution of "${input.functionName}" failed at runtime: ${failedRec.errorMessage}`,
      });

      return failedRec;
    }

    const completedRec: ScriptExecutionRecord = {
      id: execId,
      workspaceId,
      scriptId,
      deploymentId: input.deploymentId,
      functionName: input.functionName,
      parametersJson: JSON.stringify(input.parameters || []),
      initiatorUid: uid,
      initiatorEmail: userEmail,
      riskClassification: target.riskClassification,
      approvalConfirmed: Boolean(input.approvalConfirmed),
      status: 'completed',
      startedAt,
      finishedAt,
      resultJson: JSON.stringify(response.response?.result ?? null),
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };

    await resolved.store.commit([
      {
        path: `workspaces/${workspaceId}/scriptExecutions/${execId}`,
        data: { ...completedRec },
      },
    ]);

    await recordGoogleIntegrationAudit(resolved.store, workspaceId, {
      actorUid: uid,
      actorEmail: userEmail,
      operation: 'apps_script.execution_completed',
      targetScriptId: scriptId,
      connectionId: resolved.connection.id,
      providerClassification: 'success',
      summary: `Executed "${input.functionName}" via deployment ${input.deploymentId}.`,
    });

    return completedRec;
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const errCode =
      err instanceof AppError
        ? (err.code as DoctorDiagnosticCode | string)
        : 'PROVIDER_ERROR';
    const errMsg = err instanceof Error ? err.message : 'Execution request failed.';

    const failedRec: ScriptExecutionRecord = {
      id: execId,
      workspaceId,
      scriptId,
      deploymentId: input.deploymentId,
      functionName: input.functionName,
      parametersJson: JSON.stringify(input.parameters || []),
      initiatorUid: uid,
      initiatorEmail: userEmail,
      riskClassification: target.riskClassification,
      approvalConfirmed: Boolean(input.approvalConfirmed),
      status: 'failed',
      startedAt,
      finishedAt,
      errorCode: errCode,
      errorMessage: errMsg,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };

    await resolved.store
      .commit([
        {
          path: `workspaces/${workspaceId}/scriptExecutions/${execId}`,
          data: { ...failedRec },
        },
      ])
      .catch(() => null);

    await recordGoogleIntegrationAudit(resolved.store, workspaceId, {
      actorUid: uid,
      actorEmail: userEmail,
      operation: 'apps_script.execution_error',
      targetScriptId: scriptId,
      connectionId: resolved.connection.id,
      providerClassification: errCode === 'QUOTA_LIMITED' ? 'quota_limited' : 'error',
      summary: `Execution error (${errCode}) on "${input.functionName}": ${errMsg}`,
    });

    throw err;
  }
}

export async function listScriptTriggers(
  uid: string,
  workspaceId: string,
  scriptId: string,
  ctx: Phase2ExecutionContext = {},
): Promise<ScriptTriggerRecord[]> {
  const { store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'apps_script:read',
    ctx,
  );
  const raw = await store.listWorkspaceSubcollection(workspaceId, 'scriptTriggers');
  return (raw as unknown as ScriptTriggerRecord[])
    .filter((t) => t.scriptId === scriptId && t.state !== 'removed')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function installOrSyncScriptTrigger(
  uid: string,
  userEmail: string,
  workspaceId: string,
  scriptId: string,
  input: AppsScriptTriggerInstallInput,
  ctx: Phase2ExecutionContext = {},
): Promise<ScriptTriggerRecord> {
  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'apps_script:deploy',
    ctx,
  });

  const timezone = input.timezone || DEFAULT_WORKSPACE_TIMEZONE;
  const scheduleDescription = buildTriggerScheduleDescription({
    triggerType: input.triggerType,
    intervalValue: input.intervalValue,
    hourOfDay: input.hourOfDay,
    timezone,
  });

  // Verify handler function exists in remote script source
  const remote = await getAppsScriptContent(
    resolved.accessToken,
    scriptId,
    ctx.fetchImpl,
  );
  const files = remote.files || [];

  if (!scriptContainsHandlerFunction(files, input.handler)) {
    throw new AppError(
      400,
      'TRIGGER_HANDLER_MISSING',
      `Handler function "${input.handler}" does not exist in this Apps Script project.`,
    );
  }

  // Re-use existing Antara trigger record for idempotency when handler+triggerType match
  const existingAll = await resolved.store.listWorkspaceSubcollection(
    workspaceId,
    'scriptTriggers',
  );
  const existing = (existingAll as unknown as ScriptTriggerRecord[]).find(
    (t) =>
      t.scriptId === scriptId &&
      t.handler === input.handler &&
      t.state !== 'removed',
  );
  const triggerId = existing?.id || makeId('trg');
  const now = new Date().toISOString();

  // For time-based triggers with an active API Executable deploymentId: inject helper if absent and install remotely
  const isTimeBased =
    input.triggerType === 'time_hourly' ||
    input.triggerType === 'time_daily' ||
    input.triggerType === 'time_weekly';

  let state: ScriptTriggerRecord['state'] = isTimeBased ? 'pending_install' : 'unsupported';
  let googleTriggerId: string | undefined = existing?.googleTriggerId;
  let lastErrorMessage: string | undefined;

  if (!isTimeBased) {
    lastErrorMessage =
      'Simple/container-bound triggers (on_open/on_edit/on_change) must be attached in a container-bound sheet or document.';
  } else if (input.deploymentId) {
    try {
      // Ensure __antara_triggers.gs helper exists
      const hasHelper = files.some((f) => f.name === ANTARA_TRIGGER_FILE_NAME);
      if (!hasHelper) {
        const nextFiles = [
          ...files,
          {
            name: ANTARA_TRIGGER_FILE_NAME,
            type: 'SERVER_JS' as const,
            source: generateAntaraTriggerHelperSource(),
          },
        ];
        await updateWorkspaceProjectContentProtected(
          uid,
          userEmail,
          workspaceId,
          scriptId,
          {
            files: nextFiles,
            changeSummary: 'Install idempotent Antara trigger helper (__antara_triggers.gs)',
            confirmFileDeletions: false,
          },
          ctx,
        );
      }

      const installed = await installAntaraTriggerRemotely({
        accessToken: resolved.accessToken,
        deploymentId: input.deploymentId,
        handler: input.handler,
        triggerType: input.triggerType,
        intervalValue: input.intervalValue,
        hourOfDay: input.hourOfDay,
        timezone,
        fetchImpl: ctx.fetchImpl,
      });
      state = installed.installed ? 'active' : 'pending_install';
      googleTriggerId = installed.googleTriggerId || googleTriggerId;
    } catch (err) {
      state = 'error';
      lastErrorMessage =
        err instanceof Error ? err.message : 'Trigger remote sync failed.';
    }
  } else {
    lastErrorMessage =
      'Saved trigger specification in Antara. Deploy an API_EXECUTABLE and re-sync to install inside Google Apps Script.';
  }

  const record: ScriptTriggerRecord = {
    id: triggerId,
    workspaceId,
    scriptId,
    ...(input.deploymentId ? { deploymentId: input.deploymentId } : {}),
    ...(googleTriggerId ? { googleTriggerId } : {}),
    handler: input.handler,
    triggerType: input.triggerType,
    scheduleDescription,
    timezone,
    ...(input.intervalValue ? { intervalValue: input.intervalValue } : {}),
    ...(input.hourOfDay !== undefined ? { hourOfDay: input.hourOfDay } : {}),
    ownership: 'antara_managed',
    state,
    ...(lastErrorMessage ? { lastErrorMessage } : {}),
    createdByUid: existing?.createdByUid || uid,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await resolved.store.commit([
    {
      path: `workspaces/${workspaceId}/scriptTriggers/${triggerId}`,
      data: { ...record },
    },
  ]);

  await recordGoogleIntegrationAudit(resolved.store, workspaceId, {
    actorUid: uid,
    actorEmail: userEmail,
    operation: 'apps_script.trigger_synced',
    targetScriptId: scriptId,
    connectionId: resolved.connection.id,
    providerClassification: state === 'error' ? 'error' : 'success',
    summary: `Synced Antara trigger for "${input.handler}" (${scheduleDescription}) -> state=${state}.`,
  });

  return record;
}

export async function removeScriptTrigger(
  uid: string,
  userEmail: string,
  workspaceId: string,
  scriptId: string,
  triggerId: string,
  ctx: Phase2ExecutionContext = {},
): Promise<void> {
  const resolved = await resolveConnectionAndAccessToken({
    uid,
    workspaceId,
    requiredPermission: 'apps_script:deploy',
    ctx,
  });

  const path = `workspaces/${workspaceId}/scriptTriggers/${triggerId}`;
  const raw = await resolved.store.getDoc(path);
  if (!raw || String(raw.scriptId) !== scriptId) {
    throw new AppError(404, 'TRIGGER_NOT_FOUND', 'Trigger record not found.');
  }
  const existing = raw as unknown as ScriptTriggerRecord;

  if (existing.deploymentId && existing.state === 'active') {
    await removeAntaraTriggerRemotely({
      accessToken: resolved.accessToken,
      deploymentId: existing.deploymentId,
      handler: existing.handler,
      googleTriggerId: existing.googleTriggerId,
      fetchImpl: ctx.fetchImpl,
    }).catch(() => null);
  }

  await resolved.store.commit([
    {
      path,
      data: { state: 'removed' },
      updateMask: ['state', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordGoogleIntegrationAudit(resolved.store, workspaceId, {
    actorUid: uid,
    actorEmail: userEmail,
    operation: 'apps_script.trigger_removed',
    targetScriptId: scriptId,
    connectionId: resolved.connection.id,
    providerClassification: 'success',
    summary: `Removed Antara-managed trigger "${existing.handler}". Unrelated Google script triggers remain untouched.`,
  });
}

export async function listGoogleIntegrationAuditLogs(
  uid: string,
  workspaceId: string,
  ctx: Phase2ExecutionContext = {},
): Promise<GoogleIntegrationAuditRecord[]> {
  const { store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'audit:read',
    ctx,
  );
  const raw = await store.listWorkspaceSubcollection(
    workspaceId,
    'googleIntegrationAudit',
  );
  return (raw as unknown as GoogleIntegrationAuditRecord[])
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 80);
}
