import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  analyticsSnapshotIngestSchema,
  experimentCreateSchema,
  idSchema,
} from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  createOrEvaluateExperiment,
  ingestAnalyticsSnapshot,
  listAnalyticsAndExperiments,
} from '@/lib/server/phase4-repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const analyticsPostSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('snapshot'),
    payload: analyticsSnapshotIngestSchema,
  }),
  z.object({
    kind: z.literal('experiment_create'),
    payload: experimentCreateSchema,
  }),
  z.object({
    kind: z.literal('experiment_evaluate'),
    experimentId: idSchema,
  }),
]);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const data = await listAnalyticsAndExperiments(user.uid, workspaceId, {
      idToken: user.idToken,
    });
    return okResponse(data);
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
    const parsed = analyticsPostSchema.parse(await request.json());
    const ctx = { idToken: user.idToken };

    if (parsed.kind === 'snapshot') {
      const result = await ingestAnalyticsSnapshot(user.uid, workspaceId, parsed.payload, ctx);
      return okResponse(result, result.duplicateIgnored ? 200 : 201);
    }

    if (parsed.kind === 'experiment_create') {
      const result = await createOrEvaluateExperiment(
        user.uid,
        workspaceId,
        { mode: 'create', ...parsed.payload },
        ctx,
      );
      return okResponse(result, 201);
    }

    const result = await createOrEvaluateExperiment(
      user.uid,
      workspaceId,
      { mode: 'evaluate', experimentId: parsed.experimentId },
      ctx,
    );
    return okResponse(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
