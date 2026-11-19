import { NextRequest } from 'next/server';
import { idSchema, publishExecuteSchema } from '@/lib/validation';
import { buildPhase4CapabilityMatrix } from '@/lib/marketing/providers/registry';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { AppError, handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  disconnectSocialAccount,
  executeContentPublish,
  listConnectedSocialAccounts,
  listPublishingAttempts,
  listScheduledPosts,
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
    const ctx = { idToken: user.idToken };
    const [accounts, attempts, scheduledPosts] = await Promise.all([
      listConnectedSocialAccounts(user.uid, workspaceId, ctx),
      listPublishingAttempts(user.uid, workspaceId, ctx),
      listScheduledPosts(user.uid, workspaceId, ctx),
    ]);
    const capabilityMatrix = buildPhase4CapabilityMatrix(accounts);
    const recoveryQueue = scheduledPosts.filter(
      (p) =>
        p.status === 'failed' ||
        p.status === 'dead_letter' ||
        p.status === 'publish_status_unknown',
    );
    return okResponse({
      accounts,
      capabilityMatrix,
      attempts,
      scheduledPosts,
      recoveryQueue,
    });
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
    const body = publishExecuteSchema.parse(await request.json());
    const result = await executeContentPublish(
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

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const accountId = request.nextUrl.searchParams.get('accountId') || '';
    if (!accountId) {
      throw new AppError(400, 'ACCOUNT_ID_REQUIRED', 'Query parameter accountId is required.');
    }
    idSchema.parse(accountId);
    const result = await disconnectSocialAccount(
      user.uid,
      user.email,
      workspaceId,
      accountId,
      { idToken: user.idToken },
    );
    return okResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
