import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { AppError, jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  installOrSyncScriptTrigger,
  listScriptTriggers,
  removeScriptTrigger,
} from '@/lib/server/phase2-repositories';
import { resolveRequestOrigin } from '@/lib/server/platform-oauth';
import { scriptTriggerInstallSchema } from '@/lib/validation';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; scriptId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, scriptId } = await context.params;
    const triggers = await listScriptTriggers(user.uid, workspaceId, scriptId, {
      idToken: user.idToken,
    });
    return jsonOk({ triggers });
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
    const parsed = scriptTriggerInstallSchema.parse(body);
    const origin = resolveRequestOrigin(req);

    const trigger = await installOrSyncScriptTrigger(
      user.uid,
      user.email,
      workspaceId,
      scriptId,
      parsed,
      { idToken: user.idToken, origin },
    );
    return jsonOk({ trigger }, 201);
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
    const triggerId = req.nextUrl.searchParams.get('triggerId') || '';
    if (!triggerId) {
      throw new AppError(400, 'TRIGGER_ID_REQUIRED', 'triggerId query parameter is required.');
    }
    const origin = resolveRequestOrigin(req);
    await removeScriptTrigger(user.uid, user.email, workspaceId, scriptId, triggerId, {
      idToken: user.idToken,
      origin,
    });
    return jsonOk({ removed: true, triggerId });
  } catch (err) {
    return jsonError(err);
  }
}
