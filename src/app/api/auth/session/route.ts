import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  attachSessionCookie,
  authenticateRequest,
  clearSessionCookie,
  verifyFirebaseIdTokenString,
} from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { bootstrapUserProfile } from '@/lib/server/repositories';

export const dynamic = 'force-dynamic';

const sessionCreateSchema = z.object({
  idToken: z.string().min(20),
});

export async function GET(req: NextRequest) {
  try {
    const authUser = await authenticateRequest(req);
    const profile = await bootstrapUserProfile(authUser, { idToken: authUser.idToken });
    return jsonOk({ user: profile });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { idToken } = sessionCreateSchema.parse(await req.json());
    const authUser = await verifyFirebaseIdTokenString(idToken);
    const profile = await bootstrapUserProfile(authUser, { idToken: authUser.idToken });
    const res = jsonOk({ user: profile });
    attachSessionCookie(res, authUser, req);
    return res;
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: NextRequest) {
  const res = jsonOk({ signedOut: true });
  clearSessionCookie(res, req);
  return res;
}
