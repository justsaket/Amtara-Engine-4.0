import { NextRequest } from 'next/server';
import {
  idSchema,
  schedulePostCreateSchema,
  schedulePostUpdateSchema,
} from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { AppError, handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  listScheduledPosts,
  scheduleContentPost,
  updateOrReconcileScheduledPost,
} from '@/lib/server/phase4-repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const posts = await listScheduledPosts(user.uid, workspaceId, { idToken: user.idToken });
    return okResponse({ posts });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const body = schedulePostCreateSchema.parse(await request.json());
    const post = await scheduleContentPost(user.uid, user.email, workspaceId, body, {
      idToken: user.idToken,
    });
    return okResponse({ post }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const raw = (await request.json()) as Record<string, unknown>;
    const scheduledPostId = idSchema.parse(raw.scheduledPostId);
    const input = schedulePostUpdateSchema.parse(raw);
    if (!scheduledPostId) {
      throw new AppError(400, 'INVALID_INPUT', 'scheduledPostId is required.');
    }
    const result = await updateOrReconcileScheduledPost(
      user.uid,
      user.email,
      workspaceId,
      scheduledPostId,
      input,
      { idToken: user.idToken },
    );
    return okResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
