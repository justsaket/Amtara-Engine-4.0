import { NextRequest } from 'next/server';
import {
  autonomyPolicyUpsertSchema,
  emergencyStopUpdateSchema,
  idSchema,
} from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import { requireWorkspaceAccess } from '@/lib/server/repositories';
import {
  getWorkspaceEmergencyStop,
  listBrandAutonomyPolicies,
  updateWorkspaceEmergencyStop,
  upsertBrandAutonomyPolicy,
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
    const ctx = { idToken: user.idToken };
    const { store } = await requireWorkspaceAccess(user.uid, workspaceId, 'marketing:read', ctx);
    const [policies, emergencyStop] = await Promise.all([
      listBrandAutonomyPolicies(user.uid, workspaceId, ctx),
      getWorkspaceEmergencyStop(store, workspaceId),
    ]);
    return okResponse({ policies, emergencyStop });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const body = autonomyPolicyUpsertSchema.parse(await request.json());
    const policy = await upsertBrandAutonomyPolicy(
      user.uid,
      user.email,
      workspaceId,
      body,
      { idToken: user.idToken },
    );
    return okResponse({ policy });
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
    const body = emergencyStopUpdateSchema.parse(await request.json());
    const emergencyStop = await updateWorkspaceEmergencyStop(
      user.uid,
      user.email,
      workspaceId,
      body,
      { idToken: user.idToken },
    );
    return okResponse({ emergencyStop });
  } catch (error) {
    return handleRouteError(error);
  }
}
