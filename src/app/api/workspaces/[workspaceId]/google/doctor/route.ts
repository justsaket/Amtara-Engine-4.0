import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { runWorkspaceGoogleDoctor } from '@/lib/server/phase2-repositories';
import { resolveRequestOrigin } from '@/lib/server/platform-oauth';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const scriptId = req.nextUrl.searchParams.get('scriptId') || undefined;
    const origin = resolveRequestOrigin(req);
    const report = await runWorkspaceGoogleDoctor(user.uid, workspaceId, scriptId, {
      idToken: user.idToken,
      origin,
    });
    return jsonOk({ report });
  } catch (err) {
    return jsonError(err);
  }
}
