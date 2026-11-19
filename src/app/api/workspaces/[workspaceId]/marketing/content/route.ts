import { NextRequest } from 'next/server';
import { idSchema, marketingContentCreateSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  createMarketingContent,
  listMarketingContent,
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
    const brandId = request.nextUrl.searchParams.get('brandId') || undefined;
    const status = request.nextUrl.searchParams.get('status') || undefined;
    let items = await listMarketingContent(user.uid, workspaceId, { idToken: user.idToken });
    if (brandId) items = items.filter((i) => i.brandId === brandId);
    if (status) items = items.filter((i) => i.status === status);
    return okResponse({ items });
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
    const body = marketingContentCreateSchema.parse(await request.json());
    const item = await createMarketingContent(user.uid, user.email, workspaceId, body, {
      idToken: user.idToken,
    });
    return okResponse({ item }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
