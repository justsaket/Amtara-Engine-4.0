import { NextRequest } from 'next/server';
import { idSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import { listMarketingActivities } from '@/lib/server/phase4-repositories';

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
    const category = request.nextUrl.searchParams.get('category') || '';
    const brandId = request.nextUrl.searchParams.get('brandId') || '';
    const all = await listMarketingActivities(user.uid, workspaceId, {
      idToken: user.idToken,
    });
    const activities = all.filter((item) => {
      if (category && item.category !== category) return false;
      if (brandId && item.brandId !== brandId) return false;
      return true;
    });
    return okResponse({ activities });
  } catch (error) {
    return handleRouteError(error);
  }
}
