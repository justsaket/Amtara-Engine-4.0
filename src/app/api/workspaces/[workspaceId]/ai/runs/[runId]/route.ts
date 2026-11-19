import { NextRequest } from 'next/server';
import { z } from 'zod';
import { cancelOrchestratorRun } from '@/lib/agents/orchestrator';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { getRunWithDetails } from '@/lib/server/phase3-repositories';
import { requireWorkspaceAccess } from '@/lib/server/repositories';

const runActionSchema = z.object({
  action: z.enum(['cancel']),
});

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; runId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, runId } = await context.params;
    await requireWorkspaceAccess(user.uid, workspaceId, 'ai:read', {
      idToken: user.idToken,
    });
    const details = await getRunWithDetails(workspaceId, runId, {
      idToken: user.idToken,
    });
    return jsonOk(details);
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; runId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, runId } = await context.params;
    const body = runActionSchema.parse(await req.json());
    if (body.action === 'cancel') {
      const updated = await cancelOrchestratorRun(
        user.uid,
        workspaceId,
        user.email,
        runId,
        { idToken: user.idToken },
      );
      return jsonOk({ run: updated });
    }
    return jsonOk({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
