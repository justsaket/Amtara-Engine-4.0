import { NextRequest } from 'next/server';
import { idSchema, marketingContentUpdateSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  getMarketingContentById,
  updateMarketingContent,
} from '@/lib/server/phase4-repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string; contentId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId, contentId } = await context.params;
    idSchema.parse(workspaceId);
    idSchema.parse(contentId);
    const item = await getMarketingContentById(user.uid, workspaceId, contentId, {
      idToken: user.idToken,
    });
    return okResponse({ item });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string; contentId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId, contentId } = await context.params;
    idSchema.parse(workspaceId);
    idSchema.parse(contentId);
    const body = marketingContentUpdateSchema.parse(await request.json());
    const result = await updateMarketingContent(
      user.uid,
      user.email,
      workspaceId,
      contentId,
      body,
      { idToken: user.idToken },
    );
    return okResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
