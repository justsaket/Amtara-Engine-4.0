import { NextRequest } from 'next/server';
import { validateMessagingWindow } from '@/lib/marketing/inbox-reviews-leads';
import { idSchema, inboxActionSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  handleSocialInboxAction,
  listSocialConversations,
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
    const conversations = await listSocialConversations(user.uid, workspaceId, {
      idToken: user.idToken,
    });
    const nowIso = new Date().toISOString();
    const enriched = conversations.map((c) => ({
      ...c,
      messagingWindowStatus: validateMessagingWindow(c, nowIso),
    }));
    return okResponse({ conversations: enriched });
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
    const body = inboxActionSchema.parse(await request.json());
    const result = await handleSocialInboxAction(
      user.uid,
      user.email,
      workspaceId,
      body,
      { idToken: user.idToken },
    );
    return okResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
