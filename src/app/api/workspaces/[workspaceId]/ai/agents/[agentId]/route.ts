import { NextRequest } from 'next/server';
import { AGENT_DEFINITIONS } from '@/lib/agents/agent-registry';
import { createDefaultModelProviderManager } from '@/lib/ai/provider-manager';
import { authenticateRequest } from '@/lib/server/auth';
import { AppError, jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  listAgentConfigs,
  upsertAgentConfig,
} from '@/lib/server/phase3-repositories';
import { getStore, requireWorkspaceAccess } from '@/lib/server/repositories';
import { agentConfigPatchSchema, agentIdSchema } from '@/lib/validation';
import type { AgentTaskRecord } from '@/types/domain';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; agentId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, agentId } = await context.params;
    const parsedId = agentIdSchema.parse(agentId);
    await requireWorkspaceAccess(user.uid, workspaceId, 'ai:read', {
      idToken: user.idToken,
    });

    const store = getStore({ idToken: user.idToken });
    const [configs, tasksRaw] = await Promise.all([
      listAgentConfigs(workspaceId, { idToken: user.idToken, store }),
      store.listWorkspaceSubcollection(workspaceId, 'agentTasks'),
    ]);

    const definition = AGENT_DEFINITIONS[parsedId];
    if (!definition) {
      throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent definition not found.');
    }

    const config = configs.find((c) => c.agentId === parsedId) || null;
    const history = (tasksRaw as unknown as AgentTaskRecord[])
      .filter((t) => t.agentId === parsedId && t.workspaceId === workspaceId)
      .slice(0, 25);

    return jsonOk({
      aiReady: createDefaultModelProviderManager().hasConfiguredProvider(),
      definition,
      config,
      history,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; agentId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, agentId } = await context.params;
    const parsedId = agentIdSchema.parse(agentId);
    const patch = agentConfigPatchSchema.parse(await req.json());

    const updated = await upsertAgentConfig(
      user.uid,
      workspaceId,
      user.email,
      parsedId,
      patch,
      { idToken: user.idToken },
    );
    return jsonOk({ config: updated });
  } catch (err) {
    return jsonError(err);
  }
}
