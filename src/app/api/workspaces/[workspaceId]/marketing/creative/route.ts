import { NextRequest } from 'next/server';
import { creativeBriefCreateSchema, idSchema } from '@/lib/validation';
import { CANVA_CAPABILITY_BOUNDARY } from '@/lib/marketing/providers/canva-adapter';
import { buildPhase4CapabilityMatrix } from '@/lib/marketing/providers/registry';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  createCreativeBrief,
  listConnectedSocialAccounts,
  listCreativeBriefs,
} from '@/lib/server/phase4-repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const [creative, accounts] = await Promise.all([
      listCreativeBriefs(user.uid, workspaceId, { idToken: user.idToken }),
      listConnectedSocialAccounts(user.uid, workspaceId, { idToken: user.idToken }),
    ]);
    const canvaStatus = buildPhase4CapabilityMatrix(accounts).find((m) => m.provider === 'canva');
    return okResponse({
      ...creative,
      canvaStatus,
      canvaCapabilityBoundary: CANVA_CAPABILITY_BOUNDARY,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const body = creativeBriefCreateSchema.parse(await request.json());
    const brief = await createCreativeBrief(user.uid, user.email, workspaceId, body, {
      idToken: user.idToken,
    });
    return okResponse({ brief }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
