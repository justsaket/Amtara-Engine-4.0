import { NextRequest, NextResponse } from 'next/server';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import {
  computeWebhookDedupeKey,
  verifyMetaWebhookSignature,
} from '@/lib/marketing/inbox-reviews-leads';
import { persistWebhookEvent } from '@/lib/server/phase4-repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get('hub.mode');
  const token = request.nextUrl.searchParams.get('hub.verify_token');
  const challenge = request.nextUrl.searchParams.get('hub.challenge');
  const cfg = resolveAutonomousConfiguration();

  if (mode === 'subscribe' && token && challenge && token === cfg.metaWebhookVerifyToken) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return NextResponse.json(
    { ok: false, error: { code: 'WEBHOOK_VERIFY_FAILED', message: 'Invalid Meta webhook verification token.' } },
    { status: 403 },
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-hub-signature-256');
  const appSecret = (process.env.META_APP_SECRET || '').trim();

  const verification = verifyMetaWebhookSignature(rawBody, signatureHeader, appSecret);
  if (!verification.valid) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'WEBHOOK_SIGNATURE_INVALID',
          message: verification.reason || 'Meta webhook signature verification failed.',
        },
      },
      { status: 401 },
    );
  }

  let eventType = 'meta_event';
  let eventId: string | undefined;
  let workspaceId: string | undefined;
  let payloadSummary = 'Verified Meta webhook payload.';

  try {
    const parsed = JSON.parse(rawBody) as {
      object?: string;
      entry?: Array<{ id?: string; time?: number }>;
      workspaceId?: string;
    };
    eventType = parsed.object || 'meta_event';
    eventId = parsed.entry?.[0]?.id
      ? `${parsed.entry[0].id}:${parsed.entry[0].time || ''}`
      : undefined;
    workspaceId = typeof parsed.workspaceId === 'string' ? parsed.workspaceId : undefined;
    payloadSummary = `Meta ${eventType} webhook (${parsed.entry?.length || 0} entry item(s)).`;
  } catch {
    payloadSummary = 'Verified Meta webhook (non-JSON body).';
  }

  const dedupeKey = computeWebhookDedupeKey('meta', rawBody, eventId);
  const { createHash } = await import('node:crypto');
  const payloadHash = createHash('sha256').update(rawBody).digest('hex');
  const { duplicateIgnored, record } = await persistWebhookEvent({
    workspaceId,
    provider: 'meta',
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
