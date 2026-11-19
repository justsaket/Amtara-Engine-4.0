import { NextRequest } from 'next/server';
import { listAllAgents } from '@/lib/agents/agent-registry';
import { createDefaultModelProviderManager } from '@/lib/ai/provider-manager';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  listAgentConfigs,
  listOrchestratorRuns,
} from '@/lib/server/phase3-repositories';
import { getStore, requireWorkspaceAccess } from '@/lib/server/repositories';
import type { AgentTaskRecord } from '@/types/domain';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    await requireWorkspaceAccess(user.uid, workspaceId, 'ai:read', {
      idToken: user.idToken,
    });

    const store = getStore({ idToken: user.idToken });
    const [configs, runs, tasksRaw] = await Promise.all([
      listAgentConfigs(workspaceId, { idToken: user.idToken, store }),
      listOrchestratorRuns(workspaceId, { idToken: user.idToken, store }),
      store.listWorkspaceSubcollection(workspaceId, 'agentTasks'),
    ]);

    const tasks = tasksRaw as unknown as AgentTaskRecord[];
    const configMap = new Map(configs.map((c) => [c.agentId, c]));
    const aiReady = createDefaultModelProviderManager().hasConfiguredProvider();

    const agents = listAllAgents().map((def) => {
      const cfg = configMap.get(def.id) || null;
      const agentTasks = tasks.filter((t) => t.agentId === def.id);
      const completedCount = agentTasks.filter((t) => t.status === 'completed').length;
      return {
        definition: def,
        config: cfg,
        enabled: cfg ? cfg.enabled : true,
        availability: !aiReady
          ? 'provider_not_configured'
          : cfg && !cfg.enabled
            ? 'disabled_by_admin'
            : 'ready',
        stats: {
          totalTasks: agentTasks.length,
          completedTasks: completedCount,
          failedTasks: agentTasks.filter((t) => t.status === 'failed').length,
        },
      };
    });

    return jsonOk({
      aiReady,
      agents,
      recentRuns: runs.slice(0, 15),
    });
  } catch (err) {
    return jsonError(err);
  }
}
