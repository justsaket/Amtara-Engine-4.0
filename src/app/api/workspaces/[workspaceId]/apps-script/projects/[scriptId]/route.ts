import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  detachWorkspaceAppsScriptProject,
  getProjectDetailsAndContent,
} from '@/lib/server/phase2-repositories';
import { resolveRequestOrigin } from '@/lib/server/platform-oauth';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; scriptId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, scriptId } = await context.params;
    const origin = resolveRequestOrigin(req);
    const details = await getProjectDetailsAndContent(user.uid, workspaceId, scriptId, {
      idToken: user.idToken,
      origin,
    });
    return jsonOk(details);
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; scriptId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, scriptId } = await context.params;
    await detachWorkspaceAppsScriptProject(
      user.uid,
      user.email,
      workspaceId,
      scriptId,
      { idToken: user.idToken },
    );
    return jsonOk({ detached: true, scriptId });
  } catch (err) {
    return jsonError(err);
  }
}
