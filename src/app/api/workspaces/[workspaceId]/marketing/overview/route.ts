import { NextRequest } from 'next/server';
import { growthObjectiveCreateSchema, idSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  createGrowthObjective,
  getWorkspaceMarketingOverviewData,
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
    const data = await getWorkspaceMarketingOverviewData(user.uid, workspaceId, {
      idToken: user.idToken,
    });
    return okResponse(data);
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
    const body = growthObjectiveCreateSchema.parse(await request.json());
    const objective = await createGrowthObjective(user.uid, user.email, workspaceId, body, {
      idToken: user.idToken,
    });
    return okResponse({ objective }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
