import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  listNotifications,
  markNotificationRead,
} from '@/lib/server/repositories';
import { idSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const markReadSchema = z.object({
  notificationId: idSchema,
  read: z.boolean(),
});

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const notifications = await listNotifications(authUser.uid, validWorkspaceId, {
      idToken: authUser.idToken,
    });
    return jsonOk({ notifications });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const body = markReadSchema.parse(await req.json());
    const notification = await markNotificationRead(
      authUser.uid,
      validWorkspaceId,
      body.notificationId,
      body.read,
      { idToken: authUser.idToken },
    );
    return jsonOk({ notification });
  } catch (err) {
    return jsonError(err);
  }
}
