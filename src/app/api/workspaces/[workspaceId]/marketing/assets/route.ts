import { NextRequest } from 'next/server';
import { idSchema, mediaAssetRegisterSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  listMediaAssets,
  registerMediaAsset,
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
    const assets = await listMediaAssets(user.uid, workspaceId, { idToken: user.idToken });
    return okResponse({ assets });
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
    const body = mediaAssetRegisterSchema.parse(await request.json());
    const result = await registerMediaAsset(user.uid, user.email, workspaceId, body, {
      idToken: user.idToken,
    });
    return okResponse(result, result.deduplicated ? 200 : 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
