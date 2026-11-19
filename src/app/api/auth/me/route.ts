import type { NextRequest } from 'next/server';
import { authenticateRequest, clearSessionCookie } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  bootstrapUserProfile,
  requestAccountDeletion,
  updateUserProfile,
} from '@/lib/server/repositories';
import { profileUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const authUser = await authenticateRequest(req);
    const profile = await bootstrapUserProfile(authUser, { idToken: authUser.idToken });
    return jsonOk({ profile });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const authUser = await authenticateRequest(req);
    const input = profileUpdateSchema.parse(await req.json());
    const profile = await updateUserProfile(authUser, input, {
      idToken: authUser.idToken,
    });
    return jsonOk({ profile });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authUser = await authenticateRequest(req);
    const profile = await requestAccountDeletion(authUser, {
      idToken: authUser.idToken,
    });
    const res = jsonOk({
      deletionRequested: true,
      profile,
    });
    clearSessionCookie(res);
    return res;
  } catch (err) {
    return jsonError(err);
  }
}
