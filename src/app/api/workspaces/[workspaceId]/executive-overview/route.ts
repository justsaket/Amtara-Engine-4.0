import { NextRequest } from 'next/server';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { evaluateOnboardingProgress } from '@/lib/onboarding/progress';
import { idSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  listWorkspaceAppsScriptProjects,
  listWorkspaceGoogleConnections,
} from '@/lib/server/phase2-repositories';
import { listOrchestratorRuns, listUsageLedger } from '@/lib/server/phase3-repositories';
import {
  getWorkspaceEmergencyStop,
  getWorkspaceMarketingOverviewData,
  listBrandAutonomyPolicies,
  listMarketingActivities,
  listMediaAssets,
} from '@/lib/server/phase4-repositories';
import {
  listBrands,
  listNotifications,
  requireWorkspaceAccess,
} from '@/lib/server/repositories';

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
    const brandIdFilter = request.nextUrl.searchParams.get('brandId') || '';
    const ctx = { idToken: user.idToken };

    const { store, workspace, member } = await requireWorkspaceAccess(
      user.uid,
      workspaceId,
      'workspace:read',
      ctx,
    );

    const cfg = resolveAutonomousConfiguration();

    const [
      brands,
      marketing,
      emergencyStop,
      recentActivities,
      googleResult,
      appsScriptProjects,
      orchestratorRuns,
      usageRecords,
      mediaAssets,
      autonomyPolicies,
      notifications,
    ] = await Promise.all([
      listBrands(user.uid, workspaceId, ctx).catch(() => []),
      getWorkspaceMarketingOverviewData(user.uid, workspaceId, ctx),
      getWorkspaceEmergencyStop(store, workspaceId).catch(() => null),
      listMarketingActivities(user.uid, workspaceId, ctx).catch(() => []),
      listWorkspaceGoogleConnections(user.uid, workspaceId, ctx).catch(() => ({
        connections: [],
        activeConnection: null,
        capabilities: [],
        platformOAuthConfigured: false,
      })),
      listWorkspaceAppsScriptProjects(user.uid, workspaceId, ctx).catch(() => []),
      listOrchestratorRuns(workspaceId, ctx).catch(() => []),
      listUsageLedger(workspaceId, ctx).catch(() => []),
      listMediaAssets(user.uid, workspaceId, ctx).catch(() => []),
      listBrandAutonomyPolicies(user.uid, workspaceId, ctx).catch(() => []),
      listNotifications(user.uid, workspaceId, ctx).catch(() => []),
    ]);

    const connectedGoogleCount = googleResult.connections.filter(
      (c) => c.status === 'connected',
    ).length;

    const aiConfigured = Boolean(cfg.snapshot.capabilities.aiConfigured);
    const activeAiProviders = cfg.snapshot.capabilities.activeAiProviders || [];

    const onboarding = evaluateOnboardingProgress({
      hasAccount: true,
      hasWorkspace: Boolean(workspace),
      brandsCount: brands.length,
      aiConfigured,
      activeAiProviders,
      googleConnectedCount: connectedGoogleCount,
      socialConnectedCount: marketing.overview.totals.connectedAccounts,
      mediaAssetsCount: mediaAssets.length,
      autonomyPoliciesCount: autonomyPolicies.length,
    });

    const filteredBrandSummaries = brandIdFilter
      ? marketing.overview.brandSummaries.filter((b) => b.brandId === brandIdFilter)
      : marketing.overview.brandSummaries;

    const totalAiTokens = usageRecords.reduce(
      (acc, r) => acc + Number(r.inputTokens || 0) + Number(r.outputTokens || 0),
      0,
    );
    const totalEstimatedAiCostUsd = usageRecords.reduce(
      (acc, r) => acc + Number(r.estimatedCostUsd || 0),
      0,
    );

    const recentRuns = orchestratorRuns.slice(0, 6).map((r) => ({
      id: r.id,
      brandId: r.brandId,
      prompt: r.prompt,
      status: r.status,
      executionMode: r.complexity,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    }));

    return okResponse({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        timezone: workspace.timezone,
        role: member.role,
      },
      selectedBrandId: brandIdFilter || null,
      brands: brands.map((b) => ({
        id: b.id,
        name: b.name,
        primaryColor: b.primaryColor,
        industry: b.industry,
        status: b.status,
      })),
      onboarding,
      emergencyStop,
      totals: {
        ...marketing.overview.totals,
        appsScriptProjects: appsScriptProjects.length,
        googleConnections: connectedGoogleCount,
        aiRunsTotal: orchestratorRuns.length,
        aiTokensTotal: totalAiTokens,
        aiEstimatedCostUsd: Number(totalEstimatedAiCostUsd.toFixed(6)),
        mediaAssets: mediaAssets.length,
        unreadNotifications: notifications.filter((n) => !n.read).length,
      },
      brandSummaries: filteredBrandSummaries,
      recentRuns,
      recentActivities: recentActivities.slice(0, 8),
      unreadAlerts: notifications.filter((n) => !n.read).slice(0, 5),
      capabilities: {
        aiConfigured,
        activeAiProviders,
        googleOAuthConfigured: cfg.snapshot.capabilities.googleOAuthConfigured,
        databaseReady: cfg.snapshot.capabilities.databaseReady,
        encryptedVaultReady: cfg.snapshot.capabilities.encryptedVaultReady,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleRouteError(error, { operation: 'executive_overview.get' });
  }
}
