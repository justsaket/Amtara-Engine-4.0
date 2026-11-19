import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  listIntegrations,
  saveIntegrationBoundary,
} from '@/lib/server/repositories';
import { idSchema, integrationBoundarySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const integrations = await listIntegrations(authUser.uid, validWorkspaceId, {
      idToken: authUser.idToken,
    });
    return jsonOk({ integrations });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const body = integrationBoundarySchema.parse(await req.json());
    const integration = await saveIntegrationBoundary(
      authUser.uid,
      authUser.email,
      validWorkspaceId,
      body,
      { idToken: authUser.idToken },
    );
    return jsonOk({ integration });
  } catch (err) {
    return jsonError(err);
  }
}
