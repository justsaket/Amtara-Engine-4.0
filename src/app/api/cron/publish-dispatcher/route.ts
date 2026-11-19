import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { AppError, handleRouteError, okResponse } from '@/lib/server/error-handler';
import { getFirebaseAdmin } from '@/lib/server/firebase-admin';
import { getStore } from '@/lib/server/repositories';
import { runCronDispatchForWorkspace } from '@/lib/server/phase4-repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyCronAuthorization(request: NextRequest): boolean {
  const cfg = resolveAutonomousConfiguration();
  const authHeader = request.headers.get('authorization') || '';
  const expected = `Bearer ${cfg.cronSecret}`;
  const providedBuf = Buffer.from(authHeader);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return true;
  }
  return false;
}

async function handleCronDispatch(request: NextRequest) {
  try {
    if (!verifyCronAuthorization(request)) {
      throw new AppError(
        401,
        'CRON_UNAUTHORIZED',
        'Valid Bearer CRON_SECRET authorization header is required for scheduler dispatch.',
      );
    }

    const workspaceIdParam = request.nextUrl.searchParams.get('workspaceId') || '';
    const workerId = `vercel_cron_${crypto.randomBytes(6).toString('hex')}`;
    const nowIso = new Date().toISOString();

    let store;
    try {
      store = getStore({});
    } catch {
      return okResponse({
        workerId,
        dispatchedAt: nowIso,
        workspacesProcessed: 0,
        results: [],
        note: 'Firebase Admin store is not initialized in this runtime; no pending jobs claimed.',
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

    const results = [];
    // Bounded to 25 workspaces per cron invocation to stay well inside serverless limits
    for (const wsId of targetWorkspaceIds.slice(0, 25)) {
      const summary = await runCronDispatchForWorkspace(store, wsId, workerId, nowIso);
      results.push(summary);
    }

    return okResponse({
      workerId,
      dispatchedAt: nowIso,
      workspacesProcessed: results.length,
      results,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET(request: NextRequest) {
  return handleCronDispatch(request);
}

export async function POST(request: NextRequest) {
  return handleCronDispatch(request);
}
