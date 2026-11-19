import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { discoverWorkspaceDriveAppsScripts } from '@/lib/server/phase2-repositories';
import { resolveRequestOrigin } from '@/lib/server/platform-oauth';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const query = req.nextUrl.searchParams.get('q') || undefined;
    const pageToken = req.nextUrl.searchParams.get('pageToken') || undefined;
    const connectionId = req.nextUrl.searchParams.get('connectionId') || undefined;
    const pageSizeRaw = req.nextUrl.searchParams.get('pageSize');
    const pageSize = pageSizeRaw ? Number(pageSizeRaw) : 25;

    const origin = resolveRequestOrigin(req);
    const discovery = await discoverWorkspaceDriveAppsScripts(
      user.uid,
      workspaceId,
      { query, pageToken, pageSize, connectionId },
      { idToken: user.idToken, origin },
    );
    return jsonOk(discovery);
  } catch (err) {
    return jsonError(err);
  }
}
