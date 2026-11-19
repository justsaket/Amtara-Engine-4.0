import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { listGoogleIntegrationAuditLogs } from '@/lib/server/phase2-repositories';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const logs = await listGoogleIntegrationAuditLogs(user.uid, workspaceId, {
      idToken: user.idToken,
    });
    return jsonOk({ logs });
  } catch (err) {
    return jsonError(err);
  }
}
