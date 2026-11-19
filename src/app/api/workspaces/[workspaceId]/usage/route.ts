import { NextRequest } from 'next/server';
import { z } from 'zod';
import { idSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import { listUsageLedger } from '@/lib/server/phase3-repositories';
import {
  listCampaignsAndPolicies,
  listMediaAssets,
  listPublishingAttempts,
  listScheduledPosts,
} from '@/lib/server/phase4-repositories';
import {
  recordAuditLog,
  requireWorkspaceAccess,
} from '@/lib/server/repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const alertThresholdSchema = z.object({
  monthlyAiWarningUsd: z.number().min(1).max(100000),
  dailyAiRequestsWarning: z.number().int().min(5).max(100000),
  storageWarningMb: z.number().min(10).max(500000),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const ctx = { idToken: user.idToken };

    const { store } = await requireWorkspaceAccess(
      user.uid,
      workspaceId,
      'workspace:read',
      ctx,
    );

    const [
      aiUsage,
      mediaAssets,
      scheduledPosts,
      publishAttempts,
      campaignsData,
      thresholdDoc,
    ] = await Promise.all([
      listUsageLedger(workspaceId, ctx).catch(() => []),
      listMediaAssets(user.uid, workspaceId, ctx).catch(() => []),
      listScheduledPosts(user.uid, workspaceId, ctx).catch(() => []),
      listPublishingAttempts(user.uid, workspaceId, ctx).catch(() => []),
      listCampaignsAndPolicies(user.uid, workspaceId, ctx).catch(() => ({
        campaigns: [],
        budgetPolicies: [],
      })),
      store.getDoc(`workspaces/${workspaceId}/settings/usage_thresholds`).catch(() => null),
    ]);

    const promptTokens = aiUsage.reduce((s, r) => s + Number(r.inputTokens || 0), 0);
    const completionTokens = aiUsage.reduce((s, r) => s + Number(r.outputTokens || 0), 0);
    const totalTokens = promptTokens + completionTokens;
    const estimatedAiCostUsd = aiUsage.reduce(
      (s, r) => s + Number(r.estimatedCostUsd || 0),
      0,
    );

    const byModelMap = new Map<
      string,
      { provider: string; model: string; requests: number; totalTokens: number; estimatedCostUsd: number }
    >();
    for (const row of aiUsage) {
      const key = `${row.provider}:${row.model}`;
      const existing = byModelMap.get(key) || {
        provider: row.provider,
        model: row.model,
        requests: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
      existing.requests += 1;
      existing.totalTokens += Number(row.inputTokens || 0) + Number(row.outputTokens || 0);
      existing.estimatedCostUsd += Number(row.estimatedCostUsd || 0);
      byModelMap.set(key, existing);
    }

    const totalStorageBytes = mediaAssets.reduce((s, a) => s + Number(a.sizeBytes || 0), 0);
    const thresholds = {
      monthlyAiWarningUsd: Number(thresholdDoc?.monthlyAiWarningUsd || 25),
      dailyAiRequestsWarning: Number(thresholdDoc?.dailyAiRequestsWarning || 200),
      storageWarningMb: Number(thresholdDoc?.storageWarningMb || 500),
    };

    const todayPrefix = new Date().toISOString().slice(0, 10);
    const todayAiRequests = aiUsage.filter((r) =>
      String(r.createdAt || '').startsWith(todayPrefix),
    ).length;

    const warnings: string[] = [];
    if (estimatedAiCostUsd >= thresholds.monthlyAiWarningUsd * 0.8) {
      warnings.push(
        `Estimated AI spend ($${estimatedAiCostUsd.toFixed(4)}) is at or above 80% of your $${thresholds.monthlyAiWarningUsd} warning threshold.`,
      );
    }
    if (todayAiRequests >= thresholds.dailyAiRequestsWarning * 0.8) {
      warnings.push(
        `Today's AI requests (${todayAiRequests}) are approaching your ${thresholds.dailyAiRequestsWarning} daily warning threshold.`,
      );
    }
    const storageMb = totalStorageBytes / (1024 * 1024);
    if (storageMb >= thresholds.storageWarningMb * 0.8) {
      warnings.push(
        `Workspace media storage (${storageMb.toFixed(1)} MB) is approaching your ${thresholds.storageWarningMb} MB warning threshold.`,
      );
    }

    return okResponse({
      measuredAt: new Date().toISOString(),
      disclaimer:
        'Application thresholds issue operational warnings only and do not enforce hard billing caps on external cloud or AI providers unless configured directly inside each provider console.',
      aiUsage: {
        totalRequests: aiUsage.length,
        todayRequests: todayAiRequests,
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedApplicationCostUsd: Number(estimatedAiCostUsd.toFixed(6)),
        providerReportedCostUsd: null,
        byModel: Array.from(byModelMap.values()).map((m) => ({
          ...m,
          estimatedCostUsd: Number(m.estimatedCostUsd.toFixed(6)),
        })),
      },
      storage: {
        assetsCount: mediaAssets.length,
        totalBytes: totalStorageBytes,
        totalMb: Number(storageMb.toFixed(2)),
      },
      publishing: {
        scheduledJobsTotal: scheduledPosts.length,
        publishAttemptsTotal: publishAttempts.length,
      },
      advertising: {
        draftOrActiveCampaigns: campaignsData.campaigns.length,
        enabledBudgetPolicies: campaignsData.budgetPolicies.filter((p) => p.enabled).length,
        providerReportedAdSpend: null,
        note: 'Paid advertising spend remains governed strictly by Phase 4 numeric budget caps and owner authorization.',
      },
      infrastructureBilling: {
        firebaseReadWriteCost: null,
        vercelBandwidthCost: null,
        status: 'unavailable_from_app_runtime',
        note: 'Inspect actual Firebase/GCP and Vercel invoices directly in Google Cloud Billing and Vercel Usage dashboards.',
      },
      thresholds,
      warnings,
    });
  } catch (error) {
    return handleRouteError(error, { operation: 'usage.get' });
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const body = alertThresholdSchema.parse(await request.json());
    const ctx = { idToken: user.idToken };

    const { store } = await requireWorkspaceAccess(
      user.uid,
      workspaceId,
      'settings:update',
      ctx,
    );

    await store.commit([
      {
        path: `workspaces/${workspaceId}/settings/usage_thresholds`,
        data: {
          id: 'usage_thresholds',
          workspaceId,
          category: 'usage_thresholds',
          ...body,
          updatedBy: user.uid,
        },
        serverTimestampFields: ['updatedAt'],
      },
    ]);

    await recordAuditLog(
      store,
      workspaceId,
      user.uid,
      user.email,
      'usage.thresholds_updated',
      'settings',
      'usage_thresholds',
      `Updated usage alert thresholds (AI warning $${body.monthlyAiWarningUsd}, daily requests ${body.dailyAiRequestsWarning}, storage ${body.storageWarningMb} MB).`,
    );

    return okResponse({ saved: true, thresholds: body });
  } catch (error) {
    return handleRouteError(error, { operation: 'usage.update_thresholds' });
  }
}
