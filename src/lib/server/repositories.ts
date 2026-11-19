import crypto from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { canAssignRole, canManageMember } from '@/lib/rbac';
import { STARTER_BRAND_PRESETS, getStarterPreset } from '@/lib/starter-brands';
import { DEFAULT_WORKSPACE_TIMEZONE, slugify } from '@/lib/validation';
import type {
  ApplicationSetting,
  AuditLog,
  BrandProfile,
  IntegrationRecord,
  NotificationRecord,
  Permission,
  SettingCategory,
  StarterBrandKey,
  UserMembershipIndex,
  UserProfile,
  Workspace,
  WorkspaceInvitation,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceWithRole,
} from '@/types/domain';
import type { AuthenticatedUser } from './auth';
import { AppError } from './error-handler';
import { getFirebaseAdmin } from './firebase-admin';
import { FirestoreRestClient, type CommitWriteOp } from './firestore-rest';
import { assertCrossTenantMatch, evaluateTenantAccess } from './tenant-guard';

export interface DataStore {
  mode: 'admin' | 'rest' | 'development_test_adapter';
  isProductionPersistence: boolean;
  getDoc(path: string): Promise<Record<string, unknown> | null>;
  listUserMemberships(uid: string): Promise<Record<string, unknown>[]>;
  listWorkspaceSubcollection(
    workspaceId: string,
    collectionId: string,
  ): Promise<Record<string, unknown>[]>;
  commit(ops: CommitWriteOp[]): Promise<void>;
}

export interface RepositoryContext {
  idToken?: string;
  store?: DataStore;
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

export function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

/**
 * Isolated in-memory adapter strictly for automated unit tests (`isProductionPersistence: false`).
 * Never used silently in production requests.
 */
export function createDevelopmentTestStore(): DataStore & {
  docs: Map<string, Record<string, unknown>>;
} {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    mode: 'development_test_adapter',
    isProductionPersistence: false,
    docs,
    async getDoc(docPath: string) {
      const hit = docs.get(docPath);
      return hit ? structuredClone(hit) : null;
    },
    async listUserMemberships(uid: string) {
      const prefix = `users/${uid}/memberships/`;
      const out: Record<string, unknown>[] = [];
      for (const [k, v] of docs.entries()) {
        if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
          out.push(structuredClone(v));
        }
      }
      return out;
    },
    async listWorkspaceSubcollection(workspaceId: string, collectionId: string) {
      const prefix = `workspaces/${workspaceId}/${collectionId}/`;
      const out: Record<string, unknown>[] = [];
      for (const [k, v] of docs.entries()) {
        if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
          out.push(structuredClone(v));
        }
      }
      return out;
    },
    async commit(ops: CommitWriteOp[]) {
      const now = new Date().toISOString();
      for (const op of ops) {
        if (op.delete) {
          docs.delete(op.path);
          continue;
        }
        const prev = (op.updateMask ? docs.get(op.path) : undefined) || {};
        const next: Record<string, unknown> = { ...prev, ...(op.data || {}) };
        for (const f of op.serverTimestampFields || []) {
          next[f] = now;
        }
        docs.set(op.path, next);
      }
    },
  };
}

export function getStore(ctx: RepositoryContext = {}): DataStore {
  if (ctx.store) return ctx.store;

  const { db, hasExplicitServiceAccount } = getFirebaseAdmin();
  if (hasExplicitServiceAccount && db) {
    return {
      mode: 'admin',
      isProductionPersistence: true,
      async getDoc(docPath: string) {
        const snap = await db.doc(docPath).get();
        return snap.exists ? (snap.data() as Record<string, unknown>) : null;
      },
      async listUserMemberships(uid: string) {
        const snap = await db
          .collection('users')
          .doc(uid)
          .collection('memberships')
          .where('status', '==', 'active')
          .get();
        return snap.docs.map((d) => d.data() as Record<string, unknown>);
      },
      async listWorkspaceSubcollection(workspaceId: string, collectionId: string) {
        const snap = await db
          .collection('workspaces')
          .doc(workspaceId)
          .collection(collectionId)
          .get();
        return snap.docs.map((d) => d.data() as Record<string, unknown>);
      },
      async commit(ops: CommitWriteOp[]) {
        const batch = db.batch();
        for (const op of ops) {
          const ref = db.doc(op.path);
          if (op.delete) {
            batch.delete(ref);
            continue;
          }
          const payload: Record<string, unknown> = { ...(op.data || {}) };
          for (const f of op.serverTimestampFields || []) {
            payload[f] = FieldValue.serverTimestamp();
          }
          if (op.updateMask && op.updateMask.length > 0) {
            batch.set(ref, payload, { merge: true });
          } else {
            batch.set(ref, payload);
          }
        }
        await batch.commit();
      },
    };
  }

  if (ctx.idToken) {
    const rest = new FirestoreRestClient(ctx.idToken);
    return {
      mode: 'rest',
      isProductionPersistence: true,
      getDoc: (docPath) => rest.getDoc(docPath),
      listUserMemberships: (uid) => rest.listCollection(`users/${uid}/memberships`),
      listWorkspaceSubcollection: (workspaceId, collectionId) =>
        rest.runWorkspaceSubcollectionQuery(workspaceId, collectionId),
      commit: (ops) => rest.commit(ops),
    };
  }

  throw new AppError(
    503,
    'PERSISTENCE_UNAVAILABLE',
    'Firestore persistence requires Firebase Admin credentials or a verified user Bearer ID token.',
  );
}

export async function recordAuditLog(
  store: DataStore,
  workspaceId: string,
  actorUid: string,
  actorEmail: string,
  action: string,
  resourceType: string,
  resourceId: string,
  summary: string,
): Promise<void> {
  const logId = makeId('log');
  await store.commit([
    {
      path: `workspaces/${workspaceId}/auditLogs/${logId}`,
      data: {
        id: logId,
        workspaceId,
        actorUid,
        actorEmail,
        action,
        resourceType,
        resourceId,
        summary,
      },
      serverTimestampFields: ['createdAt'],
    },
  ]);
}

export async function createNotificationRecord(
  store: DataStore,
  workspaceId: string,
  recipientUid: string,
  input: {
    title: string;
    message: string;
    severity: NotificationRecord['severity'];
    category: string;
  },
): Promise<void> {
  const id = makeId('ntf');
  await store.commit([
    {
      path: `workspaces/${workspaceId}/notifications/${id}`,
      data: {
        id,
        workspaceId,
        recipientUid,
        title: input.title,
        message: input.message,
        severity: input.severity,
        category: input.category,
        read: false,
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    },
  ]);
}

export async function requireWorkspaceAccess(
  uid: string,
  workspaceId: string,
  permission: Permission,
  ctx: RepositoryContext = {},
): Promise<{ workspace: Workspace; member: WorkspaceMember; store: DataStore }> {
  const store = getStore(ctx);
  const [wsRaw, memberRaw] = await Promise.all([
    store.getDoc(`workspaces/${workspaceId}`),
    store.getDoc(`workspaces/${workspaceId}/members/${uid}`),
  ]);

  if (!wsRaw) {
    throw new AppError(404, 'WORKSPACE_NOT_FOUND', 'Workspace not found.');
  }

  const member = memberRaw as WorkspaceMember | null;
  const check = evaluateTenantAccess(member, workspaceId, permission);
  if (!check.allowed || !member) {
    throw new AppError(
      403,
      'FORBIDDEN',
      check.reason || 'You do not have permission to access this workspace resource.',
    );
  }

  return {
    store,
    workspace: {
      id: String(wsRaw.id),
      name: String(wsRaw.name),
      slug: String(wsRaw.slug),
      description: String(wsRaw.description || ''),
      ownerId: String(wsRaw.ownerId),
      timezone: String(wsRaw.timezone || DEFAULT_WORKSPACE_TIMEZONE),
      planTier: (wsRaw.planTier as Workspace['planTier']) || 'foundation',
      createdAt: toIsoString(wsRaw.createdAt),
      updatedAt: toIsoString(wsRaw.updatedAt),
    },
    member: {
      ...member,
      joinedAt: toIsoString(member.joinedAt),
      updatedAt: toIsoString(member.updatedAt),
    },
  };
}

function mapUserProfile(
  raw: Record<string, unknown>,
  fallback: AuthenticatedUser,
): UserProfile {
  return {
    uid: String(raw.uid || fallback.uid),
    email: String(raw.email || fallback.email),
    displayName: String(raw.displayName || fallback.displayName),
    jobTitle: String(raw.jobTitle || ''),
    photoUrl: String(raw.photoUrl || fallback.photoUrl || ''),
    timezone: String(raw.timezone || DEFAULT_WORKSPACE_TIMEZONE),
    locale: String(raw.locale || 'en-IN'),
    defaultWorkspaceId: String(raw.defaultWorkspaceId || ''),
    onboardingCompleted: Boolean(raw.onboardingCompleted),
    authProvider:
      (raw.authProvider as UserProfile['authProvider']) || fallback.authProvider,
    accountDeletionStatus:
      (raw.accountDeletionStatus as UserProfile['accountDeletionStatus']) || 'none',
    accountDeletionRequestedAt: raw.accountDeletionRequestedAt
      ? toIsoString(raw.accountDeletionRequestedAt)
      : undefined,
    createdAt: toIsoString(raw.createdAt),
    updatedAt: toIsoString(raw.updatedAt),
  };
}

export async function bootstrapUserProfile(
  authUser: AuthenticatedUser,
  ctx: RepositoryContext = {},
): Promise<UserProfile> {
  const store = getStore(ctx);
  const docPath = `users/${authUser.uid}`;
  const existing = await store.getDoc(docPath);

  if (!existing) {
    const safeDisplayName =
      (authUser.displayName || authUser.email.split('@')[0] || 'Antara Member')
        .trim()
        .slice(0, 100) || 'Antara Member';
    const safePhotoUrl =
      authUser.photoUrl && authUser.photoUrl.length <= 1024
        ? authUser.photoUrl
        : undefined;

    try {
      await store.commit([
        {
          path: docPath,
          data: {
            uid: authUser.uid,
            email: authUser.email,
            displayName: safeDisplayName,
            ...(safePhotoUrl ? { photoUrl: safePhotoUrl } : {}),
            timezone: DEFAULT_WORKSPACE_TIMEZONE,
            locale: 'en-IN',
            onboardingCompleted: false,
            authProvider: authUser.authProvider,
            accountDeletionStatus: 'none',
          },
          preconditionExists: false,
          serverTimestampFields: ['createdAt', 'updatedAt'],
        },
      ]);
    } catch (err) {
      // Handle concurrent first-sign-in race (e.g., onAuthStateChanged + explicit popup sync)
      const refetched = await store.getDoc(docPath).catch(() => null);
      if (refetched) {
        return mapUserProfile(refetched, authUser);
      }
      throw err;
    }

    const created = (await store.getDoc(docPath)) || {};
    return mapUserProfile(created, authUser);
  }

  return mapUserProfile(existing, authUser);
}

export async function updateUserProfile(
  authUser: AuthenticatedUser,
  input: Partial<{
    displayName: string;
    jobTitle: string;
    photoUrl: string;
    timezone: string;
    locale: string;
    defaultWorkspaceId: string;
    onboardingCompleted: boolean;
  }>,
  ctx: RepositoryContext = {},
): Promise<UserProfile> {
  const store = getStore(ctx);
  if (input.defaultWorkspaceId) {
    await requireWorkspaceAccess(
      authUser.uid,
      input.defaultWorkspaceId,
      'workspace:read',
      ctx,
    );
  }

  const updateData: Record<string, unknown> = {};
  const mask: string[] = ['updatedAt'];

  const keys = [
    'displayName',
    'jobTitle',
    'photoUrl',
    'timezone',
    'locale',
    'defaultWorkspaceId',
    'onboardingCompleted',
  ] as const;

  for (const key of keys) {
    if (input[key] !== undefined) {
      updateData[key] = input[key];
      mask.push(key);
    }
  }

  await store.commit([
    {
      path: `users/${authUser.uid}`,
      data: updateData,
      updateMask: mask,
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  const updated = (await store.getDoc(`users/${authUser.uid}`)) || {};
  return mapUserProfile(updated, authUser);
}

export async function requestAccountDeletion(
  authUser: AuthenticatedUser,
  ctx: RepositoryContext = {},
): Promise<UserProfile> {
  const store = getStore(ctx);
  const docPath = `users/${authUser.uid}`;
  await store.commit([
    {
      path: docPath,
      data: {
        accountDeletionStatus: 'requested',
        accountDeletionRequestedAt: new Date().toISOString(),
      },
      updateMask: ['accountDeletionStatus', 'accountDeletionRequestedAt', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    },
  ]);
  const updated = (await store.getDoc(docPath)) || {};
  return mapUserProfile(updated, authUser);
}

function defaultIntegrationRecordsForWorkspace(
  workspaceId: string,
  configuredBy: string,
): CommitWriteOp[] {
  const { snapshot } = resolveAutonomousConfiguration();
  const seeds: Array<{
    id: string;
    provider: string;
    category: IntegrationRecord['category'];
    status: IntegrationRecord['status'];
    capabilityClass: IntegrationRecord['capabilityClass'];
    scopes: string[];
  }> = [
    {
      id: 'google_workspace',
      provider: 'google_workspace',
      category: 'google_workspace',
      status: snapshot.capabilities.googleOAuthConfigured
        ? 'authorization_required'
        : 'not_configured',
      capabilityClass: snapshot.capabilities.googleOAuthConfigured
        ? 'requires_external_authorization'
        : 'optional_unused',
      scopes: ['openid', 'email', 'profile'],
    },
    {
      id: 'google_apps_script',
      provider: 'google_apps_script',
      category: 'apps_script',
      status: snapshot.capabilities.googleOAuthConfigured
        ? 'authorization_required'
        : 'not_configured',
      capabilityClass: snapshot.capabilities.googleOAuthConfigured
        ? 'requires_external_authorization'
        : 'optional_unused',
      scopes: ['https://www.googleapis.com/auth/script.projects'],
    },
    {
      id: 'gemini_ai',
      provider: 'gemini_ai',
      category: 'ai_provider',
      status: 'not_configured',
      capabilityClass: snapshot.capabilities.geminiConfigured
        ? 'already_available'
        : 'optional_unused',
      scopes: [],
    },
    {
      id: 'meta_platforms',
      provider: 'meta_platforms',
      category: 'social_media',
      status: 'not_configured',
      capabilityClass: 'optional_unused',
      scopes: [],
    },
    {
      id: 'linkedin',
      provider: 'linkedin',
      category: 'social_media',
      status: 'not_configured',
      capabilityClass: 'optional_unused',
      scopes: [],
    },
    {
      id: 'tiktok',
      provider: 'tiktok',
      category: 'social_media',
      status: 'not_configured',
      capabilityClass: 'optional_unused',
      scopes: [],
    },
    {
      id: 'canva',
      provider: 'canva',
      category: 'creative',
      status: 'not_configured',
      capabilityClass: 'optional_unused',
      scopes: [],
    },
  ];

  return seeds.map((item) => ({
    path: `workspaces/${workspaceId}/integrations/${item.id}`,
    data: {
      id: item.id,
      workspaceId,
      provider: item.provider,
      category: item.category,
      status: item.status,
      capabilityClass: item.capabilityClass,
      grantedScopes: [],
      requestedScopes: item.scopes,
      hasRefreshToken: false,
      consentSeparatedFromLogin: true,
      configuredBy,
    },
    serverTimestampFields: ['createdAt', 'updatedAt'],
  }));
}

function defaultSettingsRecordsForWorkspace(
  workspaceId: string,
  timezone: string,
  updatedBy: string,
): CommitWriteOp[] {
  const { snapshot } = resolveAutonomousConfiguration();
  const initialCategories: Array<{
    category: SettingCategory;
    values: Record<string, string | number | boolean | string[]>;
  }> = [
    {
      category: 'general',
      values: {
        defaultTimezone: timezone,
        language: 'en-IN',
        dateFormat: 'DD MMM YYYY',
      },
    },
    {
      category: 'account',
      values: {
        identityBoundaryNotice: 'Login identity is strictly separated from external service OAuth consent.',
      },
    },
    {
      category: 'workspace',
      values: {
        defaultTimezone: timezone,
        requireAdminForSettings: true,
        phaseScope: 'phase_1_foundation',
      },
    },
    {
      category: 'brands',
      values: {
        allowEditorBrandEdits: true,
        starterBrandsEnabled: true,
      },
    },
    {
      category: 'integrations',
      values: {
        oauthConsentMode: 'explicit_workspace_only',
        appsScriptDeploymentPhase: 'phase_2_placeholder',
      },
    },
    {
      category: 'ai_configuration',
      values: {
        geminiAvailable: snapshot.capabilities.geminiConfigured,
        phase3ActivationState: 'architecture_placeholder',
      },
    },
    {
      category: 'security',
      values: {
        sessionCookieHttpOnly: true,
        tenantIsolationMode: 'strict_workspace_membership',
      },
    },
    {
      category: 'encryption_status',
      values: {
        algorithm: 'AES-256-GCM',
        activeKeyVersion: snapshot.secrets.encryptionKeyVersion,
        masterKeyStoredOutsideFirestore: true,
      },
    },
    {
      category: 'automation',
      values: {
        phase4EngineStatus: 'placeholder_ready',
      },
    },
    {
      category: 'notifications',
      values: {
        securityAlerts: true,
        onboardingNotices: true,
      },
    },
    {
      category: 'database_health',
      values: {
        databaseId: snapshot.firebase.databaseId,
        projectId: snapshot.firebase.projectId || 'unconfigured',
      },
    },
    {
      category: 'deployment_health',
      values: {
        runtimeTarget: snapshot.environment.isVercel ? 'vercel' : 'local_node',
        realGoogleTestsEnabled: snapshot.capabilities.realGoogleTestsEnabled,
      },
    },
  ];

  return initialCategories.map((entry) => ({
    path: `workspaces/${workspaceId}/settings/${entry.category}`,
    data: {
      id: entry.category,
      workspaceId,
      category: entry.category,
      valuesJson: JSON.stringify(entry.values),
      updatedBy,
    },
    serverTimestampFields: ['createdAt', 'updatedAt'],
  }));
}

export async function createWorkspace(
  authUser: AuthenticatedUser,
  input: {
    name: string;
    slug?: string;
    description?: string;
    timezone?: string;
    starterBrands?: Exclude<StarterBrandKey, 'custom'>[];
  },
  ctx: RepositoryContext = {},
): Promise<WorkspaceWithRole> {
  const store = getStore(ctx);
  const workspaceId = makeId('ws');
  const computedSlug =
    input.slug || `${slugify(input.name) || 'workspace'}-${workspaceId.slice(-5)}`;
  const timezone = input.timezone || DEFAULT_WORKSPACE_TIMEZONE;

  const foundationOps: CommitWriteOp[] = [
    {
      path: `workspaces/${workspaceId}`,
      data: {
        id: workspaceId,
        name: input.name,
        slug: computedSlug,
        description: input.description || '',
        ownerId: authUser.uid,
        timezone,
        planTier: 'foundation',
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    },
    {
      path: `workspaces/${workspaceId}/members/${authUser.uid}`,
      data: {
        uid: authUser.uid,
        workspaceId,
        email: authUser.email,
        displayName: authUser.displayName,
        role: 'owner',
        status: 'active',
        invitedBy: authUser.uid,
      },
      serverTimestampFields: ['joinedAt', 'updatedAt'],
    },
    {
      path: `users/${authUser.uid}/memberships/${workspaceId}`,
      data: {
        workspaceId,
        workspaceName: input.name,
        workspaceSlug: computedSlug,
        role: 'owner',
        status: 'active',
      },
      serverTimestampFields: ['joinedAt', 'updatedAt'],
    },
    {
      path: `users/${authUser.uid}`,
      data: {
        displayName: authUser.displayName,
        timezone,
        defaultWorkspaceId: workspaceId,
        onboardingCompleted: true,
      },
      updateMask: [
        'displayName',
        'timezone',
        'defaultWorkspaceId',
        'onboardingCompleted',
        'updatedAt',
      ],
      serverTimestampFields: ['updatedAt'],
    },
  ];

  // Commit workspace + owner membership first so Firestore rules evaluating
  // exists(/workspaces/{id}/members/{uid}) pass on subsequent subcollection seeds.
  await store.commit(foundationOps);

  const subcollectionOps: CommitWriteOp[] = [
    ...defaultIntegrationRecordsForWorkspace(workspaceId, authUser.uid),
    ...defaultSettingsRecordsForWorkspace(workspaceId, timezone, authUser.uid),
  ];

  const chosenStarterKeys = input.starterBrands || [];
  let createdBrandCount = 0;
  for (const starterKey of chosenStarterKeys) {
    const preset = getStarterPreset(starterKey);
    const brandId = makeId('br');
    createdBrandCount += 1;
    subcollectionOps.push({
      path: `workspaces/${workspaceId}/brands/${brandId}`,
      data: {
        id: brandId,
        workspaceId,
        name: preset.name,
        slug: preset.slug,
        description: preset.description,
        industry: preset.industry,
        websiteUrl: '',
        targetAudience: preset.targetAudience,
        brandVoice: preset.brandVoice,
        contentPillars: preset.contentPillars,
        primaryColor: preset.primaryColor,
        accentColor: preset.accentColor,
        restrictions: preset.restrictions,
        logoPath: '',
        starterKey: preset.starterKey,
        status: preset.status,
        createdBy: authUser.uid,
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    });
  }

  if (subcollectionOps.length > 0) {
    await store.commit(subcollectionOps);
  }

  await recordAuditLog(
    store,
    workspaceId,
    authUser.uid,
    authUser.email,
    'workspace.created',
    'workspace',
    workspaceId,
    `Initialized workspace "${input.name}" (${timezone}) with ${createdBrandCount} starter brand profile(s).`,
  );

  await createNotificationRecord(store, workspaceId, authUser.uid, {
    title: 'Workspace Foundation Initialized',
    message: `Workspace "${input.name}" is ready (${timezone}). Authentication stays isolated from external OAuth integrations.`,
    severity: 'success',
    category: 'onboarding',
  });

  const ws = (await store.getDoc(`workspaces/${workspaceId}`)) || {};
  return {
    id: String(ws.id || workspaceId),
    name: String(ws.name || input.name),
    slug: String(ws.slug || computedSlug),
    description: String(ws.description || input.description || ''),
    ownerId: String(ws.ownerId || authUser.uid),
    timezone: String(ws.timezone || timezone),
    planTier: (ws.planTier as Workspace['planTier']) || 'foundation',
    createdAt: toIsoString(ws.createdAt),
    updatedAt: toIsoString(ws.updatedAt),
    role: 'owner',
    brandCount: createdBrandCount,
    memberCount: 1,
    connectedIntegrationCount: 0,
  };
}

export async function listUserWorkspaces(
  uid: string,
  ctx: RepositoryContext = {},
): Promise<WorkspaceWithRole[]> {
  const store = getStore(ctx);
  const memberships = await store.listUserMemberships(uid);
  const results: WorkspaceWithRole[] = [];

  for (const idxRaw of memberships) {
    const idx = idxRaw as unknown as UserMembershipIndex;
    if (idx.status !== 'active') continue;

    const [wsRaw, memberRaw, brandsRaw, membersRaw, integrationsRaw] = await Promise.all([
      store.getDoc(`workspaces/${idx.workspaceId}`).catch(() => null),
      store.getDoc(`workspaces/${idx.workspaceId}/members/${uid}`).catch(() => null),
      store.listWorkspaceSubcollection(idx.workspaceId, 'brands').catch(() => []),
      store.listWorkspaceSubcollection(idx.workspaceId, 'members').catch(() => []),
      store.listWorkspaceSubcollection(idx.workspaceId, 'integrations').catch(() => []),
    ]);

    if (!wsRaw || !memberRaw) continue;
    const member = memberRaw as unknown as WorkspaceMember;
    if (member.status !== 'active') continue;

    results.push({
      id: String(wsRaw.id),
      name: String(wsRaw.name),
      slug: String(wsRaw.slug),
      description: String(wsRaw.description || ''),
      ownerId: String(wsRaw.ownerId),
      timezone: String(wsRaw.timezone || DEFAULT_WORKSPACE_TIMEZONE),
      planTier: (wsRaw.planTier as Workspace['planTier']) || 'foundation',
      createdAt: toIsoString(wsRaw.createdAt),
      updatedAt: toIsoString(wsRaw.updatedAt),
      role: member.role,
      brandCount: brandsRaw.length,
      memberCount: membersRaw.filter((m) => m.status === 'active').length,
      connectedIntegrationCount: integrationsRaw.filter((i) => i.status === 'connected').length,
    });
  }

  results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return results;
}

export async function getWorkspaceDetails(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<WorkspaceWithRole> {
  const { workspace, member, store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'workspace:read',
    ctx,
  );
  const [brandsRaw, membersRaw, integrationsRaw] = await Promise.all([
    store.listWorkspaceSubcollection(workspaceId, 'brands'),
    store.listWorkspaceSubcollection(workspaceId, 'members'),
    store.listWorkspaceSubcollection(workspaceId, 'integrations'),
  ]);

  return {
    ...workspace,
    role: member.role,
    brandCount: brandsRaw.length,
    memberCount: membersRaw.filter((m) => m.status === 'active').length,
    connectedIntegrationCount: integrationsRaw.filter((i) => i.status === 'connected').length,
  };
}

export async function updateWorkspace(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: Partial<{ name: string; slug: string; description: string; timezone: string }>,
  ctx: RepositoryContext = {},
): Promise<WorkspaceWithRole> {
  const { store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'workspace:update',
    ctx,
  );

  const updateData: Record<string, unknown> = {};
  const mask: string[] = ['updatedAt'];
  for (const k of ['name', 'slug', 'description', 'timezone'] as const) {
    if (input[k] !== undefined) {
      updateData[k] = input[k];
      mask.push(k);
    }
  }

  const ops: CommitWriteOp[] = [
    {
      path: `workspaces/${workspaceId}`,
      data: updateData,
      updateMask: mask,
      serverTimestampFields: ['updatedAt'],
    },
  ];

  if (input.name !== undefined || input.slug !== undefined) {
    const idxMask: string[] = ['updatedAt'];
    const idxData: Record<string, unknown> = {};
    if (input.name !== undefined) {
      idxData.workspaceName = input.name;
      idxMask.push('workspaceName');
    }
    if (input.slug !== undefined) {
      idxData.workspaceSlug = input.slug;
      idxMask.push('workspaceSlug');
    }
    ops.push({
      path: `users/${uid}/memberships/${workspaceId}`,
      data: idxData,
      updateMask: idxMask,
      serverTimestampFields: ['updatedAt'],
    });
  }

  await store.commit(ops);
  await recordAuditLog(
    store,
    workspaceId,
    uid,
    userEmail,
    'workspace.updated',
    'workspace',
    workspaceId,
    'Updated workspace governance settings.',
  );

  return getWorkspaceDetails(uid, workspaceId, ctx);
}

function mapBrandProfile(d: Record<string, unknown>): BrandProfile {
  return {
    id: String(d.id),
    workspaceId: String(d.workspaceId),
    name: String(d.name),
    slug: String(d.slug),
    description: String(d.description || ''),
    industry: String(d.industry || ''),
    websiteUrl: String(d.websiteUrl || ''),
    targetAudience: String(d.targetAudience || ''),
    brandVoice: String(d.brandVoice || ''),
    contentPillars: Array.isArray(d.contentPillars)
      ? d.contentPillars.map((v) => String(v))
      : [],
    primaryColor: String(d.primaryColor || '#1D4ED8'),
    accentColor: d.accentColor ? String(d.accentColor) : '',
    restrictions: String(d.restrictions || ''),
    logoPath: String(d.logoPath || ''),
    starterKey: (d.starterKey as BrandProfile['starterKey']) || 'custom',
    status: (d.status as BrandProfile['status']) || 'active',
    createdBy: String(d.createdBy),
    createdAt: toIsoString(d.createdAt),
    updatedAt: toIsoString(d.updatedAt),
  };
}

export async function listBrands(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<BrandProfile[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'brands:read', ctx);
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'brands');
  const brands = docs.map(mapBrandProfile);
  brands.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return brands;
}

export async function createBrand(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    name: string;
    slug?: string;
    description?: string;
    industry?: string;
    websiteUrl?: string;
    targetAudience?: string;
    brandVoice?: string;
    contentPillars?: string[];
    primaryColor: string;
    accentColor?: string;
    restrictions?: string;
    logoPath?: string;
    starterKey?: StarterBrandKey;
    status?: BrandProfile['status'];
  },
  ctx: RepositoryContext = {},
): Promise<BrandProfile> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'brands:create', ctx);
  const brandId = makeId('br');
  const computedSlug = input.slug || `${slugify(input.name) || 'brand'}-${brandId.slice(-4)}`;
  const brandPath = `workspaces/${workspaceId}/brands/${brandId}`;

  await store.commit([
    {
      path: brandPath,
      data: {
        id: brandId,
        workspaceId,
        name: input.name,
        slug: computedSlug,
        description: input.description || '',
        industry: input.industry || '',
        websiteUrl: input.websiteUrl || '',
        targetAudience: input.targetAudience || '',
        brandVoice: input.brandVoice || '',
        contentPillars: input.contentPillars || [],
        primaryColor: input.primaryColor,
        accentColor: input.accentColor || '',
        restrictions: input.restrictions || '',
        logoPath: input.logoPath || '',
        starterKey: input.starterKey || 'custom',
        status: input.status || 'active',
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
    'brand.created',
    'brand',
    brandId,
    `Created brand profile "${input.name}"`,
  );

  const created = (await store.getDoc(brandPath)) || {};
  return mapBrandProfile(created);
}

export async function seedStarterBrandsForWorkspace(
  uid: string,
  userEmail: string,
  workspaceId: string,
  keys?: Exclude<StarterBrandKey, 'custom'>[],
  ctx: RepositoryContext = {},
): Promise<BrandProfile[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'brands:create', ctx);
  const existing = await listBrands(uid, workspaceId, ctx);
  const existingSlugs = new Set(existing.map((b) => b.slug));

  const targetKeys =
    keys && keys.length > 0
      ? keys
      : STARTER_BRAND_PRESETS.map((p) => p.starterKey);

  const ops: CommitWriteOp[] = [];
  const createdNames: string[] = [];

  for (const key of targetKeys) {
    const preset = getStarterPreset(key);
    if (existingSlugs.has(preset.slug)) continue;
    const brandId = makeId('br');
    createdNames.push(preset.name);
    ops.push({
      path: `workspaces/${workspaceId}/brands/${brandId}`,
      data: {
        id: brandId,
        workspaceId,
        name: preset.name,
        slug: preset.slug,
        description: preset.description,
        industry: preset.industry,
        websiteUrl: '',
        targetAudience: preset.targetAudience,
        brandVoice: preset.brandVoice,
        contentPillars: preset.contentPillars,
        primaryColor: preset.primaryColor,
        accentColor: preset.accentColor,
        restrictions: preset.restrictions,
        logoPath: '',
        starterKey: preset.starterKey,
        status: preset.status,
        createdBy: uid,
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    });
  }

  if (ops.length > 0) {
    await store.commit(ops);
    await recordAuditLog(
      store,
      workspaceId,
      uid,
      userEmail,
      'brand.starter_seeded',
      'brand',
      workspaceId,
      `Initialized starter brand profiles: ${createdNames.join(', ')}`,
    );
  }

  return listBrands(uid, workspaceId, ctx);
}

export async function updateBrand(
  uid: string,
  userEmail: string,
  workspaceId: string,
  brandId: string,
  input: Partial<{
    name: string;
    slug: string;
    description: string;
    industry: string;
    websiteUrl: string;
    targetAudience: string;
    brandVoice: string;
    contentPillars: string[];
    primaryColor: string;
    accentColor: string;
    restrictions: string;
    logoPath: string;
    status: BrandProfile['status'];
  }>,
  ctx: RepositoryContext = {},
): Promise<BrandProfile> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'brands:update', ctx);
  const brandPath = `workspaces/${workspaceId}/brands/${brandId}`;
  const existing = await store.getDoc(brandPath);

  if (!existing) {
    throw new AppError(404, 'BRAND_NOT_FOUND', 'Brand profile not found.');
  }
  assertCrossTenantMatch(String(existing.workspaceId), workspaceId, 'brand profile');

  const updates: Record<string, unknown> = {};
  const mask: string[] = ['updatedAt'];

  const fields = [
    'name',
    'slug',
    'description',
    'industry',
    'websiteUrl',
    'targetAudience',
    'brandVoice',
    'contentPillars',
    'primaryColor',
    'accentColor',
    'restrictions',
    'logoPath',
    'status',
  ] as const;

  for (const key of fields) {
    if (input[key] !== undefined) {
      updates[key] = input[key];
      mask.push(key);
    }
  }

  await store.commit([
    {
      path: brandPath,
      data: updates,
      updateMask: mask,
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordAuditLog(
    store,
    workspaceId,
    uid,
    userEmail,
    'brand.updated',
    'brand',
    brandId,
    `Updated brand profile "${input.name || String(existing.name)}"`,
  );

  const updated = (await store.getDoc(brandPath)) || {};
  return mapBrandProfile(updated);
}

export async function deleteBrand(
  uid: string,
  userEmail: string,
  workspaceId: string,
  brandId: string,
  ctx: RepositoryContext = {},
): Promise<void> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'brands:delete', ctx);
  const brandPath = `workspaces/${workspaceId}/brands/${brandId}`;
  const existing = await store.getDoc(brandPath);

  if (!existing) {
    throw new AppError(404, 'BRAND_NOT_FOUND', 'Brand profile not found.');
  }
  assertCrossTenantMatch(String(existing.workspaceId), workspaceId, 'brand profile');

  await store.commit([{ path: brandPath, delete: true }]);
  await recordAuditLog(
    store,
    workspaceId,
    uid,
    userEmail,
    'brand.deleted',
    'brand',
    brandId,
    `Deleted brand profile "${String(existing.name)}"`,
  );
}

export async function listMembersAndInvitations(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<{
  members: WorkspaceMember[];
  invitations: WorkspaceInvitation[];
}> {
  const { member, store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'members:read',
    ctx,
  );
  const membersRaw = await store.listWorkspaceSubcollection(workspaceId, 'members');
  const members: WorkspaceMember[] = membersRaw.map((m) => ({
    uid: String(m.uid),
    workspaceId: String(m.workspaceId),
    email: String(m.email),
    displayName: String(m.displayName),
    role: m.role as WorkspaceRole,
    status: m.status as WorkspaceMember['status'],
    invitedBy: String(m.invitedBy),
    joinedAt: toIsoString(m.joinedAt),
    updatedAt: toIsoString(m.updatedAt),
  }));

  let invitations: WorkspaceInvitation[] = [];
  if (member.role === 'owner' || member.role === 'admin') {
    const invRaw = await store.listWorkspaceSubcollection(workspaceId, 'invitations');
    invitations = invRaw.map((inv) => ({
      id: String(inv.id),
      workspaceId: String(inv.workspaceId),
      email: String(inv.email),
      role: inv.role as WorkspaceInvitation['role'],
      status: inv.status as WorkspaceInvitation['status'],
      invitedBy: String(inv.invitedBy),
      createdAt: toIsoString(inv.createdAt),
      updatedAt: toIsoString(inv.updatedAt),
    }));
    invitations.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return { members, invitations };
}

export async function createInvitation(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: { email: string; role: Exclude<WorkspaceRole, 'owner'> },
  ctx: RepositoryContext = {},
): Promise<WorkspaceInvitation> {
  const { member, store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'members:invite',
    ctx,
  );
  if (!canAssignRole(member.role, input.role)) {
    throw new AppError(403, 'ROLE_ESCALATION_FORBIDDEN', 'You cannot assign this role.');
  }

  const invitationId = makeId('inv');
  const invPath = `workspaces/${workspaceId}/invitations/${invitationId}`;

  await store.commit([
    {
      path: invPath,
      data: {
        id: invitationId,
        workspaceId,
        email: input.email.toLowerCase(),
        role: input.role,
        status: 'pending',
        invitedBy: uid,
      },
      serverTimestampFields: ['createdAt', 'updatedAt'],
    },
  ]);

  await recordAuditLog(
    store,
    workspaceId,
    uid,
    userEmail,
    'member.invited',
    'invitation',
    invitationId,
    `Invited ${input.email.toLowerCase()} with role ${input.role}`,
  );

  const d = (await store.getDoc(invPath)) || {};
  return {
    id: String(d.id || invitationId),
    workspaceId: String(d.workspaceId || workspaceId),
    email: String(d.email || input.email.toLowerCase()),
    role: (d.role as WorkspaceInvitation['role']) || input.role,
    status: (d.status as WorkspaceInvitation['status']) || 'pending',
    invitedBy: String(d.invitedBy || uid),
    createdAt: toIsoString(d.createdAt),
    updatedAt: toIsoString(d.updatedAt),
  };
}

export async function updateMemberRole(
  uid: string,
  userEmail: string,
  workspaceId: string,
  targetUid: string,
  input: { role: Exclude<WorkspaceRole, 'owner'>; status?: 'active' | 'suspended' },
  ctx: RepositoryContext = {},
): Promise<WorkspaceMember> {
  const { member: actor, store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'members:update_role',
    ctx,
  );
  const targetPath = `workspaces/${workspaceId}/members/${targetUid}`;
  const targetRaw = await store.getDoc(targetPath);

  if (!targetRaw) {
    throw new AppError(404, 'MEMBER_NOT_FOUND', 'Workspace member not found.');
  }
  const targetData = targetRaw as unknown as WorkspaceMember;
  assertCrossTenantMatch(targetData.workspaceId, workspaceId, 'workspace member');

  if (!canManageMember(actor.role, uid, targetData)) {
    throw new AppError(403, 'MEMBER_MANAGEMENT_FORBIDDEN', 'You cannot modify this member.');
  }
  if (!canAssignRole(actor.role, input.role)) {
    throw new AppError(403, 'ROLE_ESCALATION_FORBIDDEN', 'You cannot assign this role.');
  }

  const updates: Record<string, unknown> = { role: input.role };
  const mask = ['role', 'updatedAt'];
  if (input.status) {
    updates.status = input.status;
    mask.push('status');
  }

  await store.commit([
    {
      path: targetPath,
      data: updates,
      updateMask: mask,
      serverTimestampFields: ['updatedAt'],
    },
  ]);

  await recordAuditLog(
    store,
    workspaceId,
    uid,
    userEmail,
    'member.role_updated',
    'member',
    targetUid,
    `Updated ${targetData.email} role to ${input.role}`,
  );

  const d = (await store.getDoc(targetPath)) || {};
  return {
    uid: String(d.uid || targetUid),
    workspaceId: String(d.workspaceId || workspaceId),
    email: String(d.email),
    displayName: String(d.displayName),
    role: d.role as WorkspaceRole,
    status: d.status as WorkspaceMember['status'],
    invitedBy: String(d.invitedBy),
    joinedAt: toIsoString(d.joinedAt),
    updatedAt: toIsoString(d.updatedAt),
  };
}

export async function listIntegrations(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<IntegrationRecord[]> {
  const { store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'integrations:read',
    ctx,
  );
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'integrations');
  return docs.map((d) => ({
    id: String(d.id),
    workspaceId: String(d.workspaceId),
    provider: String(d.provider),
    category: d.category as IntegrationRecord['category'],
    status: d.status as IntegrationRecord['status'],
    capabilityClass:
      (d.capabilityClass as IntegrationRecord['capabilityClass']) || 'optional_unused',
    accountEmail: d.accountEmail ? String(d.accountEmail) : undefined,
    accountName: d.accountName ? String(d.accountName) : undefined,
    grantedScopes: Array.isArray(d.grantedScopes) ? (d.grantedScopes as string[]) : [],
    requestedScopes: Array.isArray(d.requestedScopes)
      ? (d.requestedScopes as string[])
      : [],
    hasRefreshToken: Boolean(d.hasRefreshToken),
    consentSeparatedFromLogin: true,
    lastVerifiedAt: d.lastVerifiedAt ? toIsoString(d.lastVerifiedAt) : undefined,
    lastErrorMessage: d.lastErrorMessage ? String(d.lastErrorMessage) : undefined,
    configuredBy: String(d.configuredBy),
    createdAt: toIsoString(d.createdAt),
    updatedAt: toIsoString(d.updatedAt),
  }));
}

export async function saveIntegrationBoundary(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    provider: string;
    category: IntegrationRecord['category'];
    requestedScopes?: string[];
    disabled?: boolean;
  },
  ctx: RepositoryContext = {},
): Promise<IntegrationRecord> {
  const { store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'integrations:configure',
    ctx,
  );
  const integrationId = input.provider;
  const path = `workspaces/${workspaceId}/integrations/${integrationId}`;
  const existing = await store.getDoc(path);

  const nextStatus: IntegrationRecord['status'] = input.disabled
    ? 'disabled'
    : 'not_configured';
  const nextClass: IntegrationRecord['capabilityClass'] = input.disabled
    ? 'disabled'
    : 'optional_unused';

  if (existing) {
    await store.commit([
      {
        path,
        data: {
          status: nextStatus,
          capabilityClass: nextClass,
          requestedScopes: input.requestedScopes || [],
          configuredBy: uid,
        },
        updateMask: [
          'status',
          'capabilityClass',
          'requestedScopes',
          'configuredBy',
          'updatedAt',
        ],
        serverTimestampFields: ['updatedAt'],
      },
    ]);
  } else {
    await store.commit([
      {
        path,
        data: {
          id: integrationId,
          workspaceId,
          provider: input.provider,
          category: input.category,
          status: nextStatus,
          capabilityClass: nextClass,
          grantedScopes: [],
          requestedScopes: input.requestedScopes || [],
          hasRefreshToken: false,
          consentSeparatedFromLogin: true,
          configuredBy: uid,
        },
        serverTimestampFields: ['createdAt', 'updatedAt'],
      },
    ]);
  }

  await recordAuditLog(
    store,
    workspaceId,
    uid,
    userEmail,
    'integration.boundary_updated',
    'integration',
    integrationId,
    `Updated ${input.provider} boundary metadata (${nextStatus}).`,
  );

  const list = await listIntegrations(uid, workspaceId, ctx);
  const saved = list.find((item) => item.id === integrationId);
  if (!saved) {
    throw new AppError(500, 'INTEGRATION_SAVE_ERROR', 'Failed to read updated integration.');
  }
  return saved;
}

export async function listApplicationSettings(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<ApplicationSetting[]> {
  const { store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'settings:read',
    ctx,
  );
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'settings');
  return docs.map((d) => {
    let parsedValues: ApplicationSetting['values'] = {};
    try {
      parsedValues = JSON.parse(String(d.valuesJson || '{}')) as ApplicationSetting['values'];
    } catch {
      parsedValues = {};
    }
    return {
      id: String(d.id),
      workspaceId: String(d.workspaceId),
      category: d.category as SettingCategory,
      values: parsedValues,
      updatedBy: String(d.updatedBy),
      createdAt: toIsoString(d.createdAt),
      updatedAt: toIsoString(d.updatedAt),
    };
  });
}

export async function upsertApplicationSetting(
  uid: string,
  userEmail: string,
  workspaceId: string,
  input: {
    category: SettingCategory;
    values: Record<string, string | number | boolean | string[]>;
  },
  ctx: RepositoryContext = {},
): Promise<ApplicationSetting> {
  const { store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'settings:update',
    ctx,
  );
  const settingId = input.category;
  const path = `workspaces/${workspaceId}/settings/${settingId}`;
  const existing = await store.getDoc(path);
  const serialized = JSON.stringify(input.values);

  if (existing) {
    await store.commit([
      {
        path,
        data: {
          valuesJson: serialized,
          updatedBy: uid,
        },
        updateMask: ['valuesJson', 'updatedBy', 'updatedAt'],
        serverTimestampFields: ['updatedAt'],
      },
    ]);
  } else {
    await store.commit([
      {
        path,
        data: {
          id: settingId,
          workspaceId,
          category: input.category,
          valuesJson: serialized,
          updatedBy: uid,
        },
        serverTimestampFields: ['createdAt', 'updatedAt'],
      },
    ]);
  }

  await recordAuditLog(
    store,
    workspaceId,
    uid,
    userEmail,
    'setting.updated',
    'setting',
    settingId,
    `Updated centralized settings category "${input.category}".`,
  );

  const d = (await store.getDoc(path)) || {};
  return {
    id: String(d.id || settingId),
    workspaceId: String(d.workspaceId || workspaceId),
    category: (d.category as SettingCategory) || input.category,
    values: input.values,
    updatedBy: String(d.updatedBy || uid),
    createdAt: toIsoString(d.createdAt),
    updatedAt: toIsoString(d.updatedAt),
  };
}

export async function listAuditLogs(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<AuditLog[]> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'audit:read', ctx);
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'auditLogs');
  const logs = docs.map((d) => ({
    id: String(d.id),
    workspaceId: String(d.workspaceId),
    actorUid: String(d.actorUid),
    actorEmail: String(d.actorEmail || ''),
    action: String(d.action),
    resourceType: String(d.resourceType),
    resourceId: String(d.resourceId),
    summary: String(d.summary || ''),
    createdAt: toIsoString(d.createdAt),
  }));
  logs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return logs.slice(0, 60);
}

export async function listNotifications(
  uid: string,
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<NotificationRecord[]> {
  const { store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'notifications:read',
    ctx,
  );
  const docs = await store.listWorkspaceSubcollection(workspaceId, 'notifications');
  const items = docs.map((d) => ({
    id: String(d.id),
    workspaceId: String(d.workspaceId),
    recipientUid: String(d.recipientUid),
    title: String(d.title),
    message: String(d.message),
    severity: (d.severity as NotificationRecord['severity']) || 'info',
    category: String(d.category || 'system'),
    read: Boolean(d.read),
    createdAt: toIsoString(d.createdAt),
    updatedAt: toIsoString(d.updatedAt),
  }));
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return items;
}

export async function markNotificationRead(
  uid: string,
  workspaceId: string,
  notificationId: string,
  read: boolean,
  ctx: RepositoryContext = {},
): Promise<NotificationRecord> {
  const { store } = await requireWorkspaceAccess(
    uid,
    workspaceId,
    'notifications:read',
    ctx,
  );
  const path = `workspaces/${workspaceId}/notifications/${notificationId}`;
  const existing = await store.getDoc(path);
  if (!existing) {
    throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification record not found.');
  }
  assertCrossTenantMatch(String(existing.workspaceId), workspaceId, 'notification');

  await store.commit([
    {
      path,
      data: { read },
      updateMask: ['read', 'updatedAt'],
      serverTimestampFields: ['updatedAt'],
    },
  ]);
  const d = (await store.getDoc(path)) || {};
  return {
    id: String(d.id || notificationId),
    workspaceId: String(d.workspaceId || workspaceId),
    recipientUid: String(d.recipientUid),
    title: String(d.title),
    message: String(d.message),
    severity: (d.severity as NotificationRecord['severity']) || 'info',
    category: String(d.category || 'system'),
    read: Boolean(d.read),
    createdAt: toIsoString(d.createdAt),
    updatedAt: toIsoString(d.updatedAt),
  };
}
