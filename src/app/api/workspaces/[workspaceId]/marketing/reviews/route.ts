import { NextRequest } from 'next/server';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { resolveGbpReadinessState } from '@/lib/marketing/providers/social-adapters';
import { idSchema, reviewActionSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import { handleReviewAction, listReviews } from '@/lib/server/phase4-repositories';

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
    const reviews = await listReviews(user.uid, workspaceId, {
      idToken: user.idToken,
    });
    const cfg = resolveAutonomousConfiguration();
    const gbpReadiness = {
      state: resolveGbpReadinessState(cfg.gbpApiAccessStatus),
      googleOAuthConfigured: cfg.snapshot.capabilities.googleOAuthConfigured,
      note:
        'Google Business Profile API access requires an approved Google Cloud GBP API access request before live location reviews can be fetched or replied to.',
    };
    return okResponse({ reviews, gbpReadiness });
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
    const body = reviewActionSchema.parse(await request.json());
    const result = await handleReviewAction(
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
