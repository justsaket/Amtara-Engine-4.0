import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  getWorkspaceDetails,
  updateWorkspace,
} from '@/lib/server/repositories';
import { idSchema, workspaceUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const workspace = await getWorkspaceDetails(authUser.uid, validWorkspaceId, {
      idToken: authUser.idToken,
    });
    return jsonOk({ workspace });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const body = workspaceUpdateSchema.parse(await req.json());
    const workspace = await updateWorkspace(
      authUser.uid,
      authUser.email,
      validWorkspaceId,
      body,
      { idToken: authUser.idToken },
    );
    return jsonOk({ workspace });
  } catch (err) {
    return jsonError(err);
  }
}
