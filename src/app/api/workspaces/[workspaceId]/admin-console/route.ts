import { NextRequest } from 'next/server';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { idSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { AppError, handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  runWorkspaceIntegrityAudit,
  SCHEMA_MIGRATION_REGISTRY,
} from '@/lib/server/migrations';
import { listWorkspaceGoogleConnections } from '@/lib/server/phase2-repositories';
import { listOrchestratorRuns, listUsageLedger } from '@/lib/server/phase3-repositories';
import {
  listConnectedSocialAccounts,
  listScheduledPosts,
} from '@/lib/server/phase4-repositories';
import { requireWorkspaceAccess } from '@/lib/server/repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Restricted Operational Administrator Console API.
 * Strictly limited to workspace `owner` and `admin` roles.
 * Never returns raw user OAuth tokens, refresh tokens, or encrypted envelopes.
 */
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
      'security:manage',
      ctx,
    );

    if (member.role !== 'owner' && member.role !== 'admin') {
      throw new AppError(
        403,
        'ADMIN_ROLE_REQUIRED',
        'Platform operational administration is restricted to Workspace Owners and Administrators.',
      );
    }

    const cfg = resolveAutonomousConfiguration();

    const [
      membersDocs,
      socialAccounts,
      googleResult,
      scheduledPosts,
      aiRuns,
      usageRecords,
      auditLogs,
      integrityAudit,
    ] = await Promise.all([
      store.listWorkspaceSubcollection(workspaceId, 'members').catch(() => []),
      listConnectedSocialAccounts(user.uid, workspaceId, ctx).catch(() => []),
      listWorkspaceGoogleConnections(user.uid, workspaceId, ctx).catch(() => ({
        connections: [],
        activeConnection: null,
        capabilities: [],
        platformOAuthConfigured: false,
      })),
      listScheduledPosts(user.uid, workspaceId, ctx).catch(() => []),
      listOrchestratorRuns(workspaceId, ctx).catch(() => []),
      listUsageLedger(workspaceId, ctx).catch(() => []),
      store.listWorkspaceSubcollection(workspaceId, 'auditLogs').catch(() => []),
      runWorkspaceIntegrityAudit(store, workspaceId),
    ]);

    const totalJobs = scheduledPosts.length;
    const failedJobs = scheduledPosts.filter(
      (j) =>
        j.status === 'failed' ||
        j.status === 'dead_letter' ||
        j.status === 'publish_status_unknown',
    ).length;

    const totalRuns = aiRuns.length;
    const failedRuns = aiRuns.filter((r) => r.status === 'failed').length;

    return okResponse({
      generatedAt: new Date().toISOString(),
      accessRole: member.role,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        timezone: workspace.timezone,
        status: 'active',
      },
      members: membersDocs.map((m) => ({
        uid: String(m.uid || m.id || ''),
        email: String(m.email || ''),
        displayName: String(m.displayName || ''),
        role: String(m.role || 'viewer'),
        status: String(m.status || 'active'),
      })),
      integrationsHealth: {
        googleConnections: googleResult.connections.map((c) => ({
          id: c.id,
          googleEmail: c.googleEmail,
          status: c.status,
          scopesCount: c.grantedScopes.length,
          hasRefreshToken: c.hasRefreshToken,
          lastVerifiedAt: c.lastVerifiedAt,
        })),
        socialAccounts: socialAccounts.map((a) => ({
          id: a.id,
          provider: a.provider,
          displayName: a.displayName,
          status: a.status,
          readinessState: a.readinessState,
          scopesCount: a.grantedScopes.length,
        })),
      },
      reliabilityMetrics: {
        scheduledJobsTotal: totalJobs,
        scheduledJobsFailedOrUnknown: failedJobs,
        jobFailureRatePercent:
          totalJobs > 0 ? Number(((failedJobs / totalJobs) * 100).toFixed(1)) : null,
        aiRunsTotal: totalRuns,
        aiRunsFailed: failedRuns,
        aiFailureRatePercent:
          totalRuns > 0 ? Number(((failedRuns / totalRuns) * 100).toFixed(1)) : null,
        aiEstimatedCostUsd: Number(
          usageRecords
            .reduce((sum, u) => sum + Number(u.estimatedCostUsd || 0), 0)
            .toFixed(6),
        ),
        auditEventsCount: auditLogs.length,
      },
      configurationClassification: cfg.snapshot.items.map((item) => ({
        id: item.id,
        label: item.label,
        classification: item.classification,
        source: item.source,
      })),
      migrations: SCHEMA_MIGRATION_REGISTRY,
      integrityAudit,
    });
  } catch (error) {
    return handleRouteError(error, { operation: 'admin_console.get' });
  }
}
