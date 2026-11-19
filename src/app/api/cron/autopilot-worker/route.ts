import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { AppError, handleRouteError, okResponse } from '@/lib/server/error-handler';
import { getFirebaseAdmin } from '@/lib/server/firebase-admin';
import {
  getAutopilotBackgroundStore,
  runAutopilotCycleForWorkspace,
} from '@/lib/server/autopilot-repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyCronAuthorization(request: NextRequest): boolean {
  const cfg = resolveAutonomousConfiguration();
  const authHeader = request.headers.get('authorization') || '';
  const expected = `Bearer ${cfg.cronSecret}`;
  const providedBuf = Buffer.from(authHeader);
  const expectedBuf = Buffer.from(expected);
  if (
    providedBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return true;
  }
  return false;
}

async function handleAutopilotWorker(request: NextRequest) {
  try {
    if (!verifyCronAuthorization(request)) {
      throw new AppError(
        401,
        'CRON_UNAUTHORIZED',
        'Valid Bearer CRON_SECRET authorization header is required for Drive Autopilot worker.',
      );
    }

    const workspaceIdParam = request.nextUrl.searchParams.get('workspaceId') || '';
    const policyIdParam = request.nextUrl.searchParams.get('policyId') || undefined;
    const workerId = `autopilot_worker_${crypto.randomBytes(6).toString('hex')}`;
    const nowIso = new Date().toISOString();

    const store = getAutopilotBackgroundStore();
    if (!store) {
      return okResponse({
        workerId,
        ranAt: nowIso,
        workspacesProcessed: 0,
        results: [],
        note: 'Firebase Admin store is not initialized in this runtime; background worker deferred.',
      });
    }

    let targetWorkspaceIds: string[] = [];
    if (workspaceIdParam) {
      targetWorkspaceIds = [workspaceIdParam];
    } else {
      const { db, hasExplicitServiceAccount } = getFirebaseAdmin();
      if (hasExplicitServiceAccount && db) {
        const snap = await db.collection('workspaces').limit(25).get();
        targetWorkspaceIds = snap.docs.map((d) => d.id);
      }
    }

    const cfg = resolveAutonomousConfiguration();
    const webhookUrl = cfg.snapshot.environment.appUrl.startsWith('https://')
      ? `${cfg.snapshot.environment.appUrl}/api/webhooks/google-drive`
      : undefined;

    const results = [];
    for (const wsId of targetWorkspaceIds.slice(0, 25)) {
      const summary = await runAutopilotCycleForWorkspace(store, wsId, {
        workerId,
        onlyPolicyId: policyIdParam,
        nowIso,
        registerWatchWebhookUrl: webhookUrl,
      });
      results.push(summary);
    }

    return okResponse({
      workerId,
      ranAt: nowIso,
      workspacesProcessed: results.length,
      results,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function GET(request: NextRequest) {
  return handleAutopilotWorker(request);
}

export async function POST(request: NextRequest) {
  return handleAutopilotWorker(request);
}
