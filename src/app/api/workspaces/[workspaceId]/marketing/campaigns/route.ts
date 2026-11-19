import { NextRequest } from 'next/server';
import { buildPhase4CapabilityMatrix } from '@/lib/marketing/providers/registry';
import {
  adCampaignCreateSchema,
  campaignBudgetPolicySchema,
  idSchema,
} from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  createAdCampaignDraft,
  listCampaignsAndPolicies,
  listConnectedSocialAccounts,
  upsertCampaignBudgetPolicy,
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
    const [{ campaigns, budgetPolicies }, accounts] = await Promise.all([
      listCampaignsAndPolicies(user.uid, workspaceId, ctx),
      listConnectedSocialAccounts(user.uid, workspaceId, ctx),
    ]);
    const metaAdsReadiness = buildPhase4CapabilityMatrix(accounts).find(
      (c) => c.provider === 'meta_ads',
    );
    return okResponse({ campaigns, budgetPolicies, metaAdsReadiness });
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
    const body = adCampaignCreateSchema.parse(await request.json());
    const result = await createAdCampaignDraft(
      user.uid,
      user.email,
      workspaceId,
      body,
      { idToken: user.idToken },
    );
    return okResponse(result, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const body = campaignBudgetPolicySchema.parse(await request.json());
    const policy = await upsertCampaignBudgetPolicy(
      user.uid,
      user.email,
      workspaceId,
      body,
      { idToken: user.idToken },
    );
    return okResponse({ policy });
  } catch (error) {
    return handleRouteError(error);
  }
}
