import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { AppError, jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  createWorkspaceProjectDeployment,
  listAndVerifyProjectDeployments,
  retireWorkspaceProjectDeployment,
  updateWorkspaceDeploymentVersion,
} from '@/lib/server/phase2-repositories';
import { resolveRequestOrigin } from '@/lib/server/platform-oauth';
import {
  appsScriptDeploymentCreateSchema,
  appsScriptDeploymentUpdateSchema,
} from '@/lib/validation';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; scriptId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, scriptId } = await context.params;
    const origin = resolveRequestOrigin(req);
    const deployments = await listAndVerifyProjectDeployments(
      user.uid,
      workspaceId,
      scriptId,
      { idToken: user.idToken, origin },
    );
    return jsonOk({ deployments });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; scriptId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, scriptId } = await context.params;
    const body = await req.json();
    const parsed = appsScriptDeploymentCreateSchema.parse(body);
    const origin = resolveRequestOrigin(req);

    const deployment = await createWorkspaceProjectDeployment(
      user.uid,
      user.email,
      workspaceId,
      scriptId,
      {
        deploymentType: parsed.deploymentType,
        versionNumber: parsed.versionNumber,
        description: parsed.description,
        accessLevel: parsed.accessLevel,
        executeAs: parsed.executeAs,
        confirmPublicAccess: parsed.confirmPublicAccess,
      },
      { idToken: user.idToken, origin },
    );
    return jsonOk({ deployment }, 201);
  } catch (err) {
    return jsonError(err);
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; scriptId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, scriptId } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;
    const deploymentId = String(body.deploymentId || '').trim();
    if (!deploymentId) {
      throw new AppError(400, 'DEPLOYMENT_ID_REQUIRED', 'deploymentId is required.');
    }
    const parsed = appsScriptDeploymentUpdateSchema.parse(body);
    const origin = resolveRequestOrigin(req);

    const deployment = await updateWorkspaceDeploymentVersion(
      user.uid,
      user.email,
      workspaceId,
      scriptId,
      {
        deploymentId,
        versionNumber: parsed.versionNumber,
        description: parsed.description,
        confirmProductionUpdate: parsed.confirmProductionReplacement,
      },
      { idToken: user.idToken, origin },
    );
    return jsonOk({ deployment });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; scriptId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, scriptId } = await context.params;
    const deploymentId = req.nextUrl.searchParams.get('deploymentId') || '';
    if (!deploymentId) {
      throw new AppError(400, 'DEPLOYMENT_ID_REQUIRED', 'deploymentId query parameter is required.');
    }
    const origin = resolveRequestOrigin(req);
    await retireWorkspaceProjectDeployment(
      user.uid,
      user.email,
      workspaceId,
      scriptId,
      deploymentId,
      { idToken: user.idToken, origin },
    );
    return jsonOk({ retired: true, deploymentId });
  } catch (err) {
    return jsonError(err);
  }
}
