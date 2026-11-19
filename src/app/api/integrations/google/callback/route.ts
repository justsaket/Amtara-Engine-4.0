import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import {
  exchangeCodeForGoogleTokens,
  fetchGoogleUserInfo,
  persistExchangedGoogleConnection,
  validateAndConsumeOAuthCallback,
} from '@/lib/google/oauth';
import { authenticateRequest } from '@/lib/server/auth';
import { listLocalConnectionMetadataMirrors } from '@/lib/server/google-vault';
import { persistGoogleConnectionMetadata } from '@/lib/server/phase2-repositories';
import {
  getPlatformGoogleOAuthCredentials,
  resolveRequestOrigin,
} from '@/lib/server/platform-oauth';
import { getFirebaseAdmin } from '@/lib/server/firebase-admin';
import type { GoogleConnectionRecord } from '@/types/domain';

const BINDING_COOKIE_NAME = 'antara_google_oauth_bind';

function redirectWithStatus(
  origin: string,
  returnPath: string,
  params: Record<string, string>,
): NextResponse {
  const safePath = returnPath.startsWith('/dashboard')
    ? returnPath
    : '/dashboard/integrations';
  const target = new URL(`${origin}${safePath}`);
  for (const [k, v] of Object.entries(params)) {
    target.searchParams.set(k, v);
  }
  const res = NextResponse.redirect(target);
  res.cookies.set(BINDING_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}

export async function GET(req: NextRequest) {
  const origin = resolveRequestOrigin(req);
  const rawState = req.nextUrl.searchParams.get('state') || '';
  const code = req.nextUrl.searchParams.get('code') || '';
  const errorParam = req.nextUrl.searchParams.get('error') || '';
  const bindingNonce = req.cookies.get(BINDING_COOKIE_NAME)?.value;

  let currentUser: { uid: string; email: string } | null = null;
  try {
    const authUser = await authenticateRequest(req);
    currentUser = { uid: authUser.uid, email: authUser.email };
  } catch {
    currentUser = null;
  }

  let returnPath = '/dashboard/integrations';
  try {
    const tx = await validateAndConsumeOAuthCallback({
      rawState,
      sessionBindingNonce: bindingNonce,
      currentUserId: currentUser?.uid,
      errorParam: errorParam || undefined,
    });

    returnPath = tx.returnPath || '/dashboard/integrations';
    if (!code) {
      return redirectWithStatus(origin, returnPath, {
        google_status: 'error',
        google_error: 'Authorization code was missing in Google OAuth callback.',
      });
    }

    const platformCreds = await getPlatformGoogleOAuthCredentials({ origin });
    if (!platformCreds.configured) {
      return redirectWithStatus(origin, returnPath, {
        google_status: 'error',
        google_error: 'Platform Google OAuth credentials are not configured.',
      });
    }

    const tokenRes = await exchangeCodeForGoogleTokens({
      code,
      clientId: platformCreds.clientId,
      clientSecret: platformCreds.clientSecret,
      redirectUri: tx.redirectUri,
    });

    const userInfo = await fetchGoogleUserInfo(tokenRes.access_token);
    const connectionId = `gconn_${crypto
      .createHash('sha256')
      .update(`${tx.workspaceId}:${tx.userId}:${userInfo.sub}`)
      .digest('hex')
      .slice(0, 16)}`;

    // Load any prior connection record to preserve refresh tokens and prior scopes cleanly
    let existingConnection: GoogleConnectionRecord | null = null;
    const { db, hasExplicitServiceAccount } = getFirebaseAdmin();
    if (hasExplicitServiceAccount && db) {
      const snap = await db
        .doc(`workspaces/${tx.workspaceId}/googleConnections/${connectionId}`)
        .get();
      if (snap.exists) {
        existingConnection = snap.data() as GoogleConnectionRecord;
      }
    }
    if (!existingConnection) {
      existingConnection =
        listLocalConnectionMetadataMirrors(tx.workspaceId).find(
          (c) => c.id === connectionId,
        ) || null;
    }

    const persistedTokens = await persistExchangedGoogleConnection({
      workspaceId: tx.workspaceId,
      connectionId,
      existingConnection,
      tokenResponse: tokenRes,
      userInfo,
      requestedScopes: tx.requestedScopes,
    });

    const now = new Date().toISOString();
    const record: GoogleConnectionRecord = {
      id: connectionId,
      workspaceId: tx.workspaceId,
      userId: tx.userId,
      userEmail: currentUser?.email || existingConnection?.userEmail || '',
      googleAccountId: userInfo.sub,
      googleEmail: userInfo.email,
      googleName: userInfo.name,
      googlePicture: userInfo.picture,
      status: 'connected',
      grantedScopes: persistedTokens.scopes,
      encryptedCredentialId: connectionId,
      accessTokenExpiresAt: persistedTokens.accessTokenExpiresAt,
      hasRefreshToken: persistedTokens.hasRefreshToken,
      sharedWithWorkspace: existingConnection?.sharedWithWorkspace ?? false,
      consentSeparatedFromLogin: true,
      lastVerifiedAt: now,
      connectedAt: existingConnection?.connectedAt || now,
      updatedAt: now,
    };

    await persistGoogleConnectionMetadata({ connection: record });

    return redirectWithStatus(origin, returnPath, {
      google_status: 'connected',
      google_email: userInfo.email,
      connection_id: connectionId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Google OAuth callback verification failed.';
    return redirectWithStatus(origin, returnPath, {
      google_status: 'error',
      google_error: message,
    });
  }
}
