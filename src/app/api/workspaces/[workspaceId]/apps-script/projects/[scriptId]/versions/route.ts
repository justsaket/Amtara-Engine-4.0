import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  createWorkspaceProjectVersionRelease,
  listAndSyncProjectVersions,
} from '@/lib/server/phase2-repositories';
import { resolveRequestOrigin } from '@/lib/server/platform-oauth';
import { appsScriptVersionCreateSchema } from '@/lib/validation';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; scriptId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, scriptId } = await context.params;
    const origin = resolveRequestOrigin(req);
    const versions = await listAndSyncProjectVersions(user.uid, workspaceId, scriptId, {
      idToken: user.idToken,
      origin,
    });
    return jsonOk({ versions });
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
    const parsed = appsScriptVersionCreateSchema.parse(body);
    const origin = resolveRequestOrigin(req);
    const version = await createWorkspaceProjectVersionRelease(
      user.uid,
      user.email,
      workspaceId,
      scriptId,
      {
        description: parsed.description,
        changeSummary: parsed.changeSummary,
      },
      { idToken: user.idToken, origin },
    );
    return jsonOk({ version }, 201);
  } catch (err) {
    return jsonError(err);
  }
}
