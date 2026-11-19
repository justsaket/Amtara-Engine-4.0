import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { updateMemberRole } from '@/lib/server/repositories';
import { idSchema, memberRoleUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; memberId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId, memberId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const validMemberId = idSchema.parse(memberId);
    const body = memberRoleUpdateSchema.parse(await req.json());
    const member = await updateMemberRole(
      authUser.uid,
      authUser.email,
      validWorkspaceId,
      validMemberId,
      body,
      { idToken: authUser.idToken },
    );
    return jsonOk({ member });
  } catch (err) {
    return jsonError(err);
  }
}
