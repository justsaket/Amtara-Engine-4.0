import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildSocialOAuthAuthorizationUrl } from '@/lib/marketing/providers/registry';
import { idSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { AppError, handleRouteError } from '@/lib/server/error-handler';
import { requireWorkspaceAccess } from '@/lib/server/repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const providerParamSchema = z.enum([
  'meta',
  'linkedin',
  'tiktok',
  'canva',
  'youtube',
  'gbp',
]);

const startBodySchema = z.object({
  workspaceId: idSchema,
  authMode: z.enum(['instagram_login', 'facebook_login']).optional(),
});

function buildPkceChallenge(verifier: string): string {
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { provider } = await context.params;
    const providerKey = providerParamSchema.parse(provider);
    const body = startBodySchema.parse(await request.json());

    await requireWorkspaceAccess(user.uid, body.workspaceId, 'integrations:configure', {
      idToken: user.idToken,
    });

    const stateNonce = crypto.randomBytes(24).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('hex');
    const codeChallenge =
      providerKey === 'canva' ? buildPkceChallenge(codeVerifier) : undefined;

    const config = buildSocialOAuthAuthorizationUrl({
      providerKey,
      state: stateNonce,
      authMode: body.authMode,
      codeChallenge,
    });

    const response = NextResponse.json({
      ok: true,
      data: {
        ...config,
        workspaceId: body.workspaceId,
      },
    });

    const cookiePayload = JSON.stringify({
      state: stateNonce,
      providerKey,
      workspaceId: body.workspaceId,
      uid: user.uid,
      codeVerifier: providerKey === 'canva' ? codeVerifier : undefined,
      issuedAt: Date.now(),
    });

    response.cookies.set(`antara_social_oauth_${providerKey}`, cookiePayload, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 600,
    });

    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleRouteError(
        new AppError(400, 'INVALID_PROVIDER_OR_WORKSPACE', 'Invalid OAuth provider or workspaceId.'),
      );
    }
    return handleRouteError(error);
  }
}
