import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { AppError, jsonError, jsonOk } from '@/lib/server/error-handler';
import { requireWorkspaceAccess } from '@/lib/server/repositories';
import {
  getAutopilotPolicy,
  listAutopilotEvents,
  listAutopilotFiles,
  listAutopilotJobs,
  removeAutopilotPolicy,
  updateAutopilotPolicy,
} from '@/lib/server/autopilot-repositories';
import { buildAutopilotDashboardCounts } from '@/lib/autopilot/engine';
import { autopilotPolicyUpdateSchema, idSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; policyId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId, policyId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const validPolicyId = idSchema.parse(policyId);

    const { store } = await requireWorkspaceAccess(authUser.uid, validWorkspaceId, 'workspace:read', {
      idToken: authUser.idToken,
    });
    const policy = await getAutopilotPolicy(store, validWorkspaceId, validPolicyId);
    if (!policy) {
      throw new AppError(404, 'AUTOPILOT_POLICY_NOT_FOUND', 'Autopilot policy not found.');
    }

    const [files, jobs, events] = await Promise.all([
      listAutopilotFiles(store, validWorkspaceId, validPolicyId),
      listAutopilotJobs(store, validWorkspaceId, validPolicyId),
      listAutopilotEvents(store, validWorkspaceId, validPolicyId),
    ]);

    return jsonOk({
      policy,
      counts: buildAutopilotDashboardCounts({ policy, files, jobs }),
      files,
      jobs,
      events,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; policyId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId, policyId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const validPolicyId = idSchema.parse(policyId);
    const raw = await req.json();
    const parsed = autopilotPolicyUpdateSchema.parse(raw);

    const policy = await updateAutopilotPolicy(
      authUser.uid,
      validWorkspaceId,
      validPolicyId,
      parsed,
      { idToken: authUser.idToken },
    );

    return jsonOk({ policy });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; policyId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId, policyId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const validPolicyId = idSchema.parse(policyId);

    const result = await removeAutopilotPolicy(
      authUser.uid,
      validWorkspaceId,
      validPolicyId,
      { idToken: authUser.idToken },
    );

    return jsonOk(result);
  } catch (err) {
    return jsonError(err);
  }
}
