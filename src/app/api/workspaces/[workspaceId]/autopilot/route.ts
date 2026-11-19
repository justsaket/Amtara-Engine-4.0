import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { resolveRequestOrigin } from '@/lib/server/platform-oauth';
import {
  createAutopilotPolicy,
  getAutopilotDashboardSnapshot,
} from '@/lib/server/autopilot-repositories';
import { autopilotPolicyCreateSchema, idSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);

    const snapshot = await getAutopilotDashboardSnapshot(authUser.uid, validWorkspaceId, {
      idToken: authUser.idToken,
      origin: resolveRequestOrigin(req),
    });

    return jsonOk(snapshot);
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
    const raw = await req.json();
    const parsed = autopilotPolicyCreateSchema.parse(raw);

    const policy = await createAutopilotPolicy(authUser.uid, validWorkspaceId, parsed, {
      idToken: authUser.idToken,
      origin: resolveRequestOrigin(req),
    });

    return jsonOk({ policy }, 201);
  } catch (err) {
    return jsonError(err);
  }
}
