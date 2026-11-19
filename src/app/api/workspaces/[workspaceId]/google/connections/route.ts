import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { listWorkspaceGoogleConnections } from '@/lib/server/phase2-repositories';
import { resolveRequestOrigin } from '@/lib/server/platform-oauth';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const origin = resolveRequestOrigin(req);
    const result = await listWorkspaceGoogleConnections(user.uid, workspaceId, {
      idToken: user.idToken,
      origin,
    });
    return jsonOk(result);
  } catch (err) {
    return jsonError(err);
  }
}
