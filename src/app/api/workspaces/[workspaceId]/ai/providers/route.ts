import { NextRequest } from 'next/server';
import { createDefaultModelProviderManager } from '@/lib/ai/provider-manager';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { listUsageLedger } from '@/lib/server/phase3-repositories';
import { requireWorkspaceAccess } from '@/lib/server/repositories';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const { workspace } = await requireWorkspaceAccess(user.uid, workspaceId, 'ai:read', {
      idToken: user.idToken,
    });

    const manager = createDefaultModelProviderManager();
    const providers = manager.getProviderStatuses();
    const { snapshot } = resolveAutonomousConfiguration();
    const ledger = await listUsageLedger(workspaceId, { idToken: user.idToken });

    const totalInputTokens = ledger.reduce((acc, r) => acc + r.inputTokens, 0);
    const totalOutputTokens = ledger.reduce((acc, r) => acc + r.outputTokens, 0);
    const knownCostItems = ledger.filter((r) => r.pricingKnown && r.estimatedCostUsd !== null);
    const totalEstimatedCostUsd =
      knownCostItems.length > 0
        ? Number(
            knownCostItems.reduce((acc, r) => acc + (r.estimatedCostUsd || 0), 0).toFixed(6),
          )
        : null;

    return jsonOk({
      workspaceId: workspace.id,
      timezone: workspace.timezone,
      aiReady: manager.hasConfiguredProvider(),
      searchConfigured: Boolean(snapshot.capabilities.searchConfigured),
      providers,
      usageSummary: {
        totalRecords: ledger.length,
        totalInputTokens,
        totalOutputTokens,
        totalEstimatedCostUsd,
      },
    });
  } catch (err) {
    return jsonError(err);
  }
}
