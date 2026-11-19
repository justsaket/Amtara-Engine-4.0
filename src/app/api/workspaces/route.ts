import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  bootstrapUserProfile,
  createWorkspace,
  listUserWorkspaces,
} from '@/lib/server/repositories';
import { workspaceCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const authUser = await authenticateRequest(req);
    await bootstrapUserProfile(authUser, { idToken: authUser.idToken });
    const workspaces = await listUserWorkspaces(authUser.uid, {
      idToken: authUser.idToken,
    });
    return jsonOk({ workspaces });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await authenticateRequest(req);
    const body = workspaceCreateSchema.parse(await req.json());
    await bootstrapUserProfile(authUser, { idToken: authUser.idToken });
    const workspace = await createWorkspace(
      authUser,
      {
        name: body.name,
        slug: body.slug,
        description: body.description,
        timezone: body.timezone,
        starterBrands: body.includeStarterBrands
          ? ['saket_personal', 'magnarc', 'greenweld', 'sapphire']
          : [],
      },
      { idToken: authUser.idToken },
    );
    return jsonOk({ workspace }, 201);
  } catch (err) {
    return jsonError(err);
  }
}
