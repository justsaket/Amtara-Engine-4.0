import { NextRequest } from 'next/server';
import {
  createTestPlaybookFixture,
  listPlaybooks,
  triggerPlaybookEvent,
} from '@/lib/playbooks/engine';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { listPlaybookRuns } from '@/lib/server/phase3-repositories';
import { requireWorkspaceAccess } from '@/lib/server/repositories';
import { normalizedEventTriggerSchema, playbookIdSchema } from '@/lib/validation';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    await requireWorkspaceAccess(user.uid, workspaceId, 'ai:read', {
      idToken: user.idToken,
    });

    const history = await listPlaybookRuns(workspaceId, { idToken: user.idToken });
    return jsonOk({
      playbooks: listPlaybooks(),
      runs: history.runs.slice(0, 40),
      events: history.events.slice(0, 40),
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const { workspace } = await requireWorkspaceAccess(user.uid, workspaceId, 'playbooks:trigger', {
      idToken: user.idToken,
    });

    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.testFixturePlaybookId === 'string') {
      const pbId = playbookIdSchema.parse(body.testFixturePlaybookId);
      const fixture = createTestPlaybookFixture(pbId, workspace.timezone);
      const res = await triggerPlaybookEvent({
        uid: user.uid,
        actorEmail: user.email,
        workspaceId,
        eventType: pbId,
        brandId: typeof body.brandId === 'string' ? body.brandId : undefined,
        source: fixture.source,
        isTestFixture: true,
        occurredAt: fixture.occurredAt,
        payload: fixture.payload,
        ctx: { idToken: user.idToken },
      });
      return jsonOk(res, 201);
    }

    const input = normalizedEventTriggerSchema.parse(body);
    const res = await triggerPlaybookEvent({
      uid: user.uid,
      actorEmail: user.email,
      workspaceId,
      eventType: input.eventType,
      brandId: input.brandId,
      source: input.source,
      isTestFixture: input.isTestFixture,
      dedupeKey: input.dedupeKey,
      occurredAt: input.occurredAt,
      payload: input.payload,
      ctx: { idToken: user.idToken },
    });
    return jsonOk(res, 201);
  } catch (err) {
    return jsonError(err);
  }
}
