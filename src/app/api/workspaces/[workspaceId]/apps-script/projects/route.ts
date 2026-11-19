import type { NextRequest } from 'next/server';
import { APPS_SCRIPT_TEMPLATES } from '@/lib/google/templates';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  createOrImportWorkspaceAppsScriptProject,
  listWorkspaceAppsScriptProjects,
} from '@/lib/server/phase2-repositories';
import { resolveRequestOrigin } from '@/lib/server/platform-oauth';
import {
  appsScriptProjectCreateSchema,
  appsScriptProjectImportSchema,
} from '@/lib/validation';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const projects = await listWorkspaceAppsScriptProjects(user.uid, workspaceId, {
      idToken: user.idToken,
    });
    const templates = APPS_SCRIPT_TEMPLATES.map((t) => ({
      key: t.key,
      name: t.name,
      category: t.category,
      description: t.purpose,
      recommendedScopes: t.requiredScopes,
    }));
    return jsonOk({ projects, templates });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;
    const origin = resolveRequestOrigin(req);

    if (body.mode === 'import' || typeof body.scriptId === 'string') {
      const parsed = appsScriptProjectImportSchema.parse(body);
      const res = await createOrImportWorkspaceAppsScriptProject(
        user.uid,
        user.email,
        workspaceId,
        {
          mode: 'import',
          scriptId: parsed.scriptId,
          title: parsed.title,
          ownershipKind: parsed.ownershipKind,
          connectionId: parsed.connectionId,
        },
        { idToken: user.idToken, origin },
      );
      return jsonOk(res, 201);
    }

    const parsed = appsScriptProjectCreateSchema.parse(body);
    const res = await createOrImportWorkspaceAppsScriptProject(
      user.uid,
      user.email,
      workspaceId,
      {
        mode: 'create',
        title: parsed.title,
        parentId: parsed.parentId,
        templateKey: parsed.templateKey,
        connectionId: parsed.connectionId,
        idempotencyKey: parsed.idempotencyKey,
      },
      { idToken: user.idToken, origin },
    );
    return jsonOk(res, 201);
  } catch (err) {
    return jsonError(err);
  }
}
