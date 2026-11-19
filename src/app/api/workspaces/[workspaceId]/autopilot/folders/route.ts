import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { resolveRequestOrigin } from '@/lib/server/platform-oauth';
import { listAuthorizedDriveFoldersForPicker } from '@/lib/server/autopilot-repositories';
import { idSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);

    const connectionId = req.nextUrl.searchParams.get('connectionId') || undefined;
    const query = req.nextUrl.searchParams.get('q') || undefined;
    const parentFolderId = req.nextUrl.searchParams.get('parentFolderId') || undefined;

    const result = await listAuthorizedDriveFoldersForPicker(
      authUser.uid,
      validWorkspaceId,
      { connectionId, query, parentFolderId },
      { idToken: authUser.idToken, origin: resolveRequestOrigin(req) },
    );

    return jsonOk(result);
  } catch (err) {
    return jsonError(err);
  }
}
