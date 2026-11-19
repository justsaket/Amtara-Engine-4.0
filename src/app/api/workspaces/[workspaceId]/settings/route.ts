import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  listApplicationSettings,
  upsertApplicationSetting,
} from '@/lib/server/repositories';
import { idSchema, settingUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const settings = await listApplicationSettings(authUser.uid, validWorkspaceId, {
      idToken: authUser.idToken,
    });
    return jsonOk({ settings });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const body = settingUpdateSchema.parse(await req.json());
    const setting = await upsertApplicationSetting(
      authUser.uid,
      authUser.email,
      validWorkspaceId,
      body,
      { idToken: authUser.idToken },
    );
    return jsonOk({ setting });
  } catch (err) {
    return jsonError(err);
  }
}
