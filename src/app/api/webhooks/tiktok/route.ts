import { NextRequest, NextResponse } from 'next/server';
import {
  computeWebhookDedupeKey,
  verifyTikTokWebhookSignature,
} from '@/lib/marketing/inbox-reviews-leads';
import { persistWebhookEvent } from '@/lib/server/phase4-repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('tiktok-signature');
  const clientSecret = (process.env.TIKTOK_CLIENT_SECRET || '').trim();

  const verification = verifyTikTokWebhookSignature(rawBody, signatureHeader, clientSecret);
  if (!verification.valid) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'WEBHOOK_SIGNATURE_INVALID',
          message: verification.reason || 'TikTok webhook signature verification failed.',
        },
      },
      { status: 401 },
    );
  }

  let eventType = 'tiktok_event';
  let eventId: string | undefined;
  let workspaceId: string | undefined;
  let payloadSummary = 'Verified TikTok webhook payload.';

  try {
    const parsed = JSON.parse(rawBody) as {
      event?: string;
      event_id?: string;
      create_time?: number;
      workspaceId?: string;
    };
    eventType = parsed.event || 'tiktok_event';
    eventId = parsed.event_id || (parsed.create_time ? `${eventType}:${parsed.create_time}` : undefined);
    workspaceId = typeof parsed.workspaceId === 'string' ? parsed.workspaceId : undefined;
    payloadSummary = `TikTok ${eventType} webhook event.`;
  } catch {
    payloadSummary = 'Verified TikTok webhook (non-JSON body).';
  }

  const dedupeKey = computeWebhookDedupeKey('tiktok', rawBody, eventId);
  const { createHash } = await import('node:crypto');
  const payloadHash = createHash('sha256').update(rawBody).digest('hex');
  const { duplicateIgnored, record } = await persistWebhookEvent({
    workspaceId,
    provider: 'tiktok',
    eventType,
    dedupeKey,
    signatureVerified: true,
    payloadHash,
    status: 'received',
    payloadSummary,
  });

  return NextResponse.json(
    {
      ok: true,
      data: {
        accepted: true,
        duplicateIgnored,
        eventId: record.id,
        dedupeKey,
      },
    },
    { status: 200 },
  );
}
