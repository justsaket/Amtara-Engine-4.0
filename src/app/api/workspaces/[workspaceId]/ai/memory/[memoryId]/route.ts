import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { updateMemoryPromotionStatus } from '@/lib/server/phase3-repositories';
import { memoryDecisionSchema } from '@/lib/validation';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; memoryId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, memoryId } = await context.params;
    const decision = memoryDecisionSchema.parse(await req.json());

    const updated = await updateMemoryPromotionStatus(
      user.uid,
      workspaceId,
      user.email,
      memoryId,
      decision,
      { idToken: user.idToken },
    );

    return jsonOk({ memoryItem: updated });
  } catch (err) {
    return jsonError(err);
  }
}
