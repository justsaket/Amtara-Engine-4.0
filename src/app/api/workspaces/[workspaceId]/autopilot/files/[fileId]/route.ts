import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { performAutopilotFileAction } from '@/lib/server/autopilot-repositories';
import { autopilotFileActionSchema, idSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; fileId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId, fileId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const validFileId = idSchema.parse(fileId);
    const raw = await req.json();
    const parsed = autopilotFileActionSchema.parse(raw);

    const result = await performAutopilotFileAction(
      authUser.uid,
      authUser.email,
      validWorkspaceId,
      validFileId,
      parsed,
      { idToken: authUser.idToken },
    );

    return jsonOk(result);
  } catch (err) {
    return jsonError(err);
  }
}
