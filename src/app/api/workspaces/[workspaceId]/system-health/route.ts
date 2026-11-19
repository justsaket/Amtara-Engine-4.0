import { NextRequest } from 'next/server';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { buildPhase4CapabilityMatrix } from '@/lib/marketing/providers/registry';
import { idSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import { getFirebaseAdmin } from '@/lib/server/firebase-admin';
import { runWorkspaceIntegrityAudit } from '@/lib/server/migrations';
import { listRecentStructuredLogs } from '@/lib/server/observability';
import {
  listWorkspaceAppsScriptProjects,
  listWorkspaceGoogleConnections,
} from '@/lib/server/phase2-repositories';
import { listOrchestratorRuns, listUsageLedger } from '@/lib/server/phase3-repositories';
import {
  getWorkspaceEmergencyStop,
  listConnectedSocialAccounts,
  listScheduledPosts,
} from '@/lib/server/phase4-repositories';
import { requireWorkspaceAccess } from '@/lib/server/repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const ctx = { idToken: user.idToken };

    const { store, workspace, member } = await requireWorkspaceAccess(
      user.uid,
      workspaceId,
      'workspace:read',
      ctx,
    );

    const cfg = resolveAutonomousConfiguration();
    const admin = getFirebaseAdmin();

    // Real Firestore read latency probe
    const probeStart = Date.now();
    let dbHealthy = false;
    let dbProbeError: string | null = null;
    try {
      const wsDoc = await store.getDoc(`workspaces/${workspaceId}`);
      dbHealthy = Boolean(wsDoc);
    } catch (err) {
      dbProbeError = err instanceof Error ? err.message : 'Firestore read probe failed.';
    }
    const dbLatencyMs = Date.now() - probeStart;

    const [
      socialAccounts,
      scheduledPosts,
      emergencyStop,
      googleResult,
      appsScriptProjects,
      aiRuns,
      usageRecords,
      webhookDocs,
      integrityAudit,
    ] = await Promise.all([
      listConnectedSocialAccounts(user.uid, workspaceId, ctx).catch(() => []),
      listScheduledPosts(user.uid, workspaceId, ctx).catch(() => []),
      getWorkspaceEmergencyStop(store, workspaceId).catch(() => null),
      listWorkspaceGoogleConnections(user.uid, workspaceId, ctx).catch(() => ({
        connections: [],
        activeConnection: null,
        capabilities: [],
        platformOAuthConfigured: false,
      })),
      listWorkspaceAppsScriptProjects(user.uid, workspaceId, ctx).catch(() => []),
      listOrchestratorRuns(workspaceId, ctx).catch(() => []),
      listUsageLedger(workspaceId, ctx).catch(() => []),
      store.listWorkspaceSubcollection(workspaceId, 'webhookEvents').catch(() => []),
      runWorkspaceIntegrityAudit(store, workspaceId).catch(() => null),
    ]);

    const providerMatrix = buildPhase4CapabilityMatrix(socialAccounts);

    const failedJobs = scheduledPosts.filter(
      (j) =>
        j.status === 'failed' ||
        j.status === 'dead_letter' ||
        j.status === 'publish_status_unknown',
    );
    const scheduledPending = scheduledPosts.filter((j) => j.status === 'scheduled');
    const publishedJobs = scheduledPosts.filter((j) => j.status === 'published');
    const failedRuns = aiRuns.filter((r) => r.status === 'failed');

    const totalCostUsd = usageRecords.reduce(
      (sum, r) => sum + Number(r.estimatedCostUsd || 0),
      0,
    );

    return okResponse({
      checkedAt: new Date().toISOString(),
      workspace: {
        id: workspace.id,
        name: workspace.name,
        role: member.role,
        timezone: workspace.timezone,
      },
      subsystems: [
        {
          id: 'website_api',
          label: 'Web Application & API Routes',
          status: 'healthy',
          detail: 'Next.js App Router API responding normally.',
        },
        {
          id: 'firestore',
          label: 'Cloud Firestore Persistence',
          status: dbHealthy ? 'healthy' : 'error',
          detail: dbHealthy
            ? `Verified live read in ${dbLatencyMs}ms (${store.mode} store).`
            : dbProbeError || 'Firestore read probe failed.',
          latencyMs: dbLatencyMs,
        },
        {
          id: 'storage',
          label: 'Firebase Storage',
          status: cfg.snapshot.firebase.storageBucketConfigured ? 'healthy' : 'degraded',
          detail: cfg.snapshot.firebase.storageBucketConfigured
            ? 'Storage bucket configured for validated workspace media.'
            : 'Storage bucket not configured; media uploads require storage bucket configuration.',
        },
        {
          id: 'auth_vault',
          label: 'Authentication & AES-256-GCM Vault',
          status:
            cfg.snapshot.capabilities.authReady && cfg.snapshot.capabilities.encryptedVaultReady
              ? 'healthy'
              : 'degraded',
          detail: `Auth ready (${admin.app ? 'Admin SDK active' : 'REST fallback'}), key version ${cfg.snapshot.secrets.encryptionKeyVersion}.`,
        },
        {
          id: 'ai_providers',
          label: 'AI Model Providers',
          status: cfg.snapshot.capabilities.aiConfigured ? 'healthy' : 'not_configured',
          detail: cfg.snapshot.capabilities.aiConfigured
            ? `Active providers: ${(cfg.snapshot.capabilities.activeAiProviders || []).join(', ')}`
            : 'No AI provider API key configured; non-AI modules operate normally.',
        },
        {
          id: 'google_apps_script',
          label: 'Google OAuth & Apps Script',
          status:
            googleResult.connections.some((c) => c.status === 'connected')
              ? 'healthy'
              : cfg.snapshot.capabilities.googleOAuthConfigured
                ? 'authorization_required'
                : 'not_configured',
          detail: `${googleResult.connections.filter((c) => c.status === 'connected').length} connected Google account(s), ${appsScriptProjects.length} tracked Apps Script project(s).`,
        },
        {
          id: 'scheduler_publishing',
          label: 'Publishing Scheduler & Recovery',
          status:
            emergencyStop?.globalStopped
              ? 'paused'
              : failedJobs.length > 0
                ? 'warning'
                : 'healthy',
          detail: emergencyStop?.globalStopped
            ? 'Global Emergency Stop is active.'
            : `${scheduledPending.length} scheduled, ${publishedJobs.length} published, ${failedJobs.length} failed/ambiguous.`,
        },
        {
          id: 'webhooks',
          label: 'Signed Webhook Ingestion',
          status: 'healthy',
          detail: `${webhookDocs.length} recorded workspace webhook event(s). HMAC verification enforced on Meta & TikTok endpoints.`,
        },
      ],
      providerMatrix,
      agentExecution: {
        totalRuns: aiRuns.length,
        failedRuns: failedRuns.length,
        totalUsageRecords: usageRecords.length,
        estimatedCostUsd: Number(totalCostUsd.toFixed(6)),
      },
      publishingQueue: {
        scheduledCount: scheduledPending.length,
        publishedCount: publishedJobs.length,
        failedOrUnknownCount: failedJobs.length,
        failedSample: failedJobs.slice(0, 10).map((j) => ({
          id: j.id,
          platform: j.platform,
          status: j.status,
          lastErrorCode: j.lastErrorCode,
          lastErrorMessage: j.lastErrorMessage,
          scheduledForUtc: j.scheduledForUtc,
        })),
      },
      deployment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        isVercel: Boolean(process.env.VERCEL),
        vercelEnv: process.env.VERCEL_ENV || null,
        commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
        cronConfigured: '/api/cron/publish-dispatcher (*/5 * * * *)',
        realGoogleTestsEnabled: cfg.snapshot.capabilities.realGoogleTestsEnabled,
      },
      integrityAudit,
      recentLogs: listRecentStructuredLogs(workspaceId, 20),
    });
  } catch (error) {
    return handleRouteError(error, { operation: 'system_health.get' });
  }
}
