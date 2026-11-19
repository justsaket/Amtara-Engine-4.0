import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  disconnectAndRevokeWorkspaceGoogleConnection,
  toggleGoogleConnectionSharing,
  verifyGoogleConnectionStatus,
} from '@/lib/server/phase2-repositories';
import { resolveRequestOrigin } from '@/lib/server/platform-oauth';
import { googleConnectionShareSchema } from '@/lib/validation';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; connectionId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, connectionId } = await context.params;
    const body = await req.json();
    const parsed = googleConnectionShareSchema.parse(body);

    const updated = await toggleGoogleConnectionSharing(
      user.uid,
      user.email,
      workspaceId,
      connectionId,
      parsed.sharedWithWorkspace,
      { idToken: user.idToken },
    );
    return jsonOk({ connection: updated });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; connectionId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, connectionId } = await context.params;
    const origin = resolveRequestOrigin(req);
    const result = await verifyGoogleConnectionStatus(
      user.uid,
      user.email,
      workspaceId,
      connectionId,
      { idToken: user.idToken, origin },
    );
    return jsonOk(result);
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; connectionId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, connectionId } = await context.params;
    const res = await disconnectAndRevokeWorkspaceGoogleConnection(
      user.uid,
      user.email,
      workspaceId,
      connectionId,
      { idToken: user.idToken },
    );
    return jsonOk(res);
  } catch (err) {
    return jsonError(err);
  }
}
