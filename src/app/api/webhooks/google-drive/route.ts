import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  getAutopilotBackgroundStore,
  getAutopilotPolicy,
  recordAutopilotEvent,
  runAutopilotCycleForWorkspace,
} from '@/lib/server/autopilot-repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Official Google Drive API v3 Changes push notification receiver.
 * Validates channel ID & channel token (`workspaceId:policyId`), records the notification,
 * and triggers incremental Drive reconciliation for the matching active Autopilot policy.
 */
export async function POST(request: NextRequest) {
  try {
    const channelId = (request.headers.get('x-goog-channel-id') || '').trim();
    const resourceState = (request.headers.get('x-goog-resource-state') || '').trim();
    const channelToken = (request.headers.get('x-goog-channel-token') || '').trim();
    const resourceId = (request.headers.get('x-goog-resource-id') || '').trim();

    if (!channelId || !channelToken.includes(':')) {
      return okResponse({ accepted: false, reason: 'Missing required Google Drive channel headers.' }, 400);
    }

    const [workspaceId, policyId] = channelToken.split(':');
    if (!workspaceId || !policyId) {
      return okResponse({ accepted: false, reason: 'Invalid channel token format.' }, 400);
    }

    // Google sends an initial "sync" handshake notification upon watch registration
    if (resourceState === 'sync') {
      return okResponse({ accepted: true, state: 'sync_acknowledged', channelId });
    }

    const store = getAutopilotBackgroundStore();
    if (!store) {
      return okResponse({
        accepted: true,
        deferred: true,
        reason: 'Background Admin store not active; scheduled reconciliation will pick up changes.',
      });
    }

    const policy = await getAutopilotPolicy(store, workspaceId, policyId);
    if (!policy) {
      return okResponse({ accepted: false, reason: 'Matching autopilot policy not found.' }, 404);
    }

    // Constant-time verification against stored watchChannelId when present
    if (policy.watchChannelId) {
      const provided = Buffer.from(channelId);
      const expected = Buffer.from(policy.watchChannelId);
      if (
        provided.length !== expected.length ||
        !crypto.timingSafeEqual(provided, expected)
      ) {
        return okResponse({ accepted: false, reason: 'Drive watch channel ID mismatch.' }, 403);
      }
    }

    await recordAutopilotEvent(store, {
      workspaceId,
      policyId,
      eventType: 'drive_webhook_received',
      status: 'ok',
      summary: `Received Google Drive push notification (state=${resourceState || 'change'}, resource=${resourceId || 'unknown'}).`,
      actorUid: 'google_drive_webhook',
    });

    if (policy.status !== 'active') {
      return okResponse({
        accepted: true,
        skippedExecution: true,
        reason: `Policy is currently ${policy.status}.`,
      });
    }

    const summary = await runAutopilotCycleForWorkspace(store, workspaceId, {
      workerId: `drive_webhook_${crypto.randomBytes(4).toString('hex')}`,
      actorUid: 'google_drive_webhook',
      onlyPolicyId: policyId,
    });

    return okResponse({ accepted: true, summary });
  } catch (err) {
    return handleRouteError(err);
  }
}
