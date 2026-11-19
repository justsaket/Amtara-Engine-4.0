import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  bootstrapUserProfile,
  createWorkspace,
} from '@/lib/server/repositories';
import { onboardingCompleteSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const authUser = await authenticateRequest(req);
    const body = onboardingCompleteSchema.parse(await req.json());

    await bootstrapUserProfile(
      { ...authUser, displayName: body.displayName },
      { idToken: authUser.idToken },
    );

    const workspace = await createWorkspace(
      { ...authUser, displayName: body.displayName },
      {
        name: body.workspaceName,
        slug: body.workspaceSlug,
        timezone: body.timezone,
        starterBrands: body.starterBrands,
      },
      { idToken: authUser.idToken },
    );

    return jsonOk({ workspace }, 201);
  } catch (err) {
    return jsonError(err);
  }
}
