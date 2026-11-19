import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  executeAllowlistedScriptFunction,
  listExecutionRegistryAndHistory,
  registerApprovedExecutionTarget,
} from '@/lib/server/phase2-repositories';
import { resolveRequestOrigin } from '@/lib/server/platform-oauth';
import {
  appsScriptExecuteSchema,
  executionTargetRegisterSchema,
} from '@/lib/validation';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; scriptId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, scriptId } = await context.params;
    const origin = resolveRequestOrigin(req);
    const data = await listExecutionRegistryAndHistory(user.uid, workspaceId, scriptId, {
      idToken: user.idToken,
      origin,
    });
    return jsonOk(data);
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
    const body = (await req.json()) as Record<string, unknown>;
    const origin = resolveRequestOrigin(req);

    if (body.action === 'register_target' || req.nextUrl.searchParams.get('action') === 'register') {
      const parsed = executionTargetRegisterSchema.parse(body);
      const target = await registerApprovedExecutionTarget(
        user.uid,
        user.email,
        workspaceId,
        scriptId,
        parsed,
        { idToken: user.idToken, origin },
      );
      return jsonOk({ target }, 201);
    }

    const parsed = appsScriptExecuteSchema.parse(body);
    const execution = await executeAllowlistedScriptFunction(
      user.uid,
      user.email,
      workspaceId,
      scriptId,
      parsed,
      { idToken: user.idToken, origin },
    );
    return jsonOk({ execution });
  } catch (err) {
    return jsonError(err);
  }
}
