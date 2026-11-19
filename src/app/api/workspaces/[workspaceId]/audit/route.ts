import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { listAuditLogs } from '@/lib/server/repositories';
import { idSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const logs = await listAuditLogs(authUser.uid, validWorkspaceId, {
      idToken: authUser.idToken,
    });
    return jsonOk({ logs });
  } catch (err) {
    return jsonError(err);
  }
}
