import type { NextRequest } from 'next/server';
import { computeProjectDiff } from '@/lib/google/diff';
import { validateAppsScriptProject } from '@/lib/google/validator';
import { authenticateRequest } from '@/lib/server/auth';
import { AppError, jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  getProjectDetailsAndContent,
  restoreWorkspaceProjectSnapshot,
  updateWorkspaceProjectContentProtected,
} from '@/lib/server/phase2-repositories';
import { resolveRequestOrigin } from '@/lib/server/platform-oauth';
import { appsScriptUpdateContentSchema } from '@/lib/validation';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; scriptId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId, scriptId } = await context.params;
    const origin = resolveRequestOrigin(req);
    const data = await getProjectDetailsAndContent(user.uid, workspaceId, scriptId, {
      idToken: user.idToken,
      origin,
    });
    return jsonOk(data);
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
    const body = await req.json();
    const parsed = appsScriptUpdateContentSchema.parse(body);
    const origin = resolveRequestOrigin(req);

    // Support validate/diff preview dry-run mode without mutating Google Apps Script remotely
    if (req.nextUrl.searchParams.get('preview') === 'true') {
      const current = await getProjectDetailsAndContent(user.uid, workspaceId, scriptId, {
        idToken: user.idToken,
        origin,
      });
      const diff = computeProjectDiff(current.files, parsed.files);
      const validation = validateAppsScriptProject({ scriptId, files: parsed.files });
      return jsonOk({ preview: true, diff, validation });
    }

    const result = await updateWorkspaceProjectContentProtected(
      user.uid,
      user.email,
      workspaceId,
      scriptId,
      {
        files: parsed.files,
        changeSummary: parsed.changeSummary,
        confirmFileDeletions: parsed.confirmDestructiveChanges,
      },
      { idToken: user.idToken, origin },
    );

    return jsonOk(result);
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
    const body = (await req.json()) as { snapshotId?: string };
    if (!body.snapshotId) {
      throw new AppError(400, 'SNAPSHOT_ID_REQUIRED', 'snapshotId is required to restore.');
    }
    const origin = resolveRequestOrigin(req);
    const result = await restoreWorkspaceProjectSnapshot(
      user.uid,
      user.email,
      workspaceId,
      scriptId,
      body.snapshotId,
      { idToken: user.idToken, origin },
    );
    return jsonOk(result);
  } catch (err) {
    return jsonError(err);
  }
}
