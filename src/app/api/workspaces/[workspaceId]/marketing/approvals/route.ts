import { NextRequest } from 'next/server';
import { z } from 'zod';
import { approvalDecisionSchema, idSchema, phase4ProviderSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  createApprovalRequest,
  decideApprovalRequest,
  listApprovalRequests,
} from '@/lib/server/phase4-repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createManualApprovalSchema = z.object({
  brandId: idSchema,
  actionType: z.enum([
    'publish_post',
    'schedule_post',
    'reply_comment',
    'send_dm',
    'reply_review',
    'lead_outreach',
    'paid_campaign_mutate',
    'canva_export',
    'apps_script_deploy',
  ]),
  targetResourceType: z.enum([
    'content_item',
    'scheduled_post',
    'conversation',
    'review',
    'campaign',
    'lead',
  ]),
  targetResourceId: idSchema,
  platform: phase4ProviderSchema.optional(),
  accountId: idSchema.optional(),
  payloadHash: z.string().trim().min(8).max(128),
  summary: z.string().trim().min(4).max(500),
  riskLevel: z.enum(['low', 'medium', 'high']).default('medium'),
  estimatedSpendUsd: z.number().nonnegative().optional(),
  ttlHours: z.number().int().min(1).max(336).optional(),
});

const decideWithIdSchema = approvalDecisionSchema.extend({
  approvalId: idSchema,
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const approvals = await listApprovalRequests(user.uid, workspaceId, {
      idToken: user.idToken,
    });
    return okResponse({ approvals });
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
    const body = createManualApprovalSchema.parse(await request.json());
    const approval = await createApprovalRequest(
      user.uid,
      user.email,
      workspaceId,
      { ...body, requestedByType: 'human' },
      { idToken: user.idToken },
    );
    return okResponse({ approval }, 201);
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
    const { approvalId, action, note } = decideWithIdSchema.parse(await request.json());
    const approval = await decideApprovalRequest(
      user.uid,
      user.email,
      workspaceId,
      approvalId,
      { action, note },
      { idToken: user.idToken },
    );
    return okResponse({ approval });
  } catch (error) {
    return handleRouteError(error);
  }
}
