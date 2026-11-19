import { NextRequest } from 'next/server';
import { idSchema, leadCreateSchema, leadUpdateSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import { createLead, listLeads, updateLead } from '@/lib/server/phase4-repositories';

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
    const leads = await listLeads(user.uid, workspaceId, {
      idToken: user.idToken,
    });
    return okResponse({ leads });
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
    const body = leadCreateSchema.parse(await request.json());
    const lead = await createLead(user.uid, user.email, workspaceId, body, {
      idToken: user.idToken,
    });
    return okResponse({ lead }, 201);
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
    const body = leadUpdateSchema.parse(await request.json());
    const lead = await updateLead(user.uid, user.email, workspaceId, body, {
      idToken: user.idToken,
    });
    return okResponse({ lead });
  } catch (error) {
    return handleRouteError(error);
  }
}
