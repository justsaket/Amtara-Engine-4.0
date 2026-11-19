import type { NextRequest } from 'next/server';
import { startGoogleOAuthTransaction } from '@/lib/google/oauth';
import { resolveScopesForCapabilities } from '@/lib/google/permissions';
import { authenticateRequest } from '@/lib/server/auth';
import { AppError, jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  getPlatformGoogleOAuthCredentials,
  resolveRequestOrigin,
} from '@/lib/server/platform-oauth';
import { requireWorkspaceAccess } from '@/lib/server/repositories';
import { googleAuthorizeStartSchema } from '@/lib/validation';

const BINDING_COOKIE_NAME = 'antara_google_oauth_bind';

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req);
    const body = await req.json();
    const parsed = googleAuthorizeStartSchema.parse(body);

    await requireWorkspaceAccess(
      user.uid,
      parsed.workspaceId,
      'google:connect',
      { idToken: user.idToken },
    );

    const origin = resolveRequestOrigin(req);
    const platformCreds = await getPlatformGoogleOAuthCredentials({ origin });

    if (!platformCreds.configured) {
      throw new AppError(
        400,
        'PLATFORM_OAUTH_NOT_CONFIGURED',
        'Google OAuth Web Client ID and Client Secret are not configured yet. Configure them in Integrations -> Configure Google OAuth App.',
      );
    }

    const scopes = resolveScopesForCapabilities(
      parsed.capabilityIds,
      parsed.extraScopes,
    );

    const started = await startGoogleOAuthTransaction({
      userId: user.uid,
      workspaceId: parsed.workspaceId,
      clientId: platformCreds.clientId,
      redirectUri: platformCreds.redirectUri,
      scopes,
      intent: parsed.intent,
      returnPath: parsed.returnPath,
      loginHint: user.email,
      forceConsent: parsed.intent === 'connect' || parsed.intent === 'reauthorize',
    });

    const response = jsonOk({
      authorizeUrl: started.authorizeUrl,
      redirectUri: platformCreds.redirectUri,
      scopes,
      expiresAt: started.transaction.expiresAt,
    });

    response.cookies.set(BINDING_COOKIE_NAME, started.sessionBindingNonce, {
      httpOnly: true,
      sameSite: 'lax',
      secure: origin.startsWith('https://'),
      path: '/',
      maxAge: 600,
    });

    return response;
  } catch (err) {
    return jsonError(err);
  }
}
