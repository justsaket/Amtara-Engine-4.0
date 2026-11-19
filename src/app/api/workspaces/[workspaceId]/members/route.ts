import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  createInvitation,
  listMembersAndInvitations,
} from '@/lib/server/repositories';
import { idSchema, memberInviteSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const data = await listMembersAndInvitations(authUser.uid, validWorkspaceId, {
      idToken: authUser.idToken,
    });
    return jsonOk(data);
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const body = memberInviteSchema.parse(await req.json());
    const invitation = await createInvitation(
      authUser.uid,
      authUser.email,
      validWorkspaceId,
      body,
      { idToken: authUser.idToken },
    );
    return jsonOk({ invitation }, 201);
  } catch (err) {
    return jsonError(err);
  }
}
