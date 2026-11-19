import crypto from 'node:crypto';
import type {
  GoogleConnectionRecord,
  GoogleOAuthTransactionRecord,
} from '@/types/domain';
import { normalizeGrantedScopeList } from '@/lib/google/permissions';
import { AppError } from '@/lib/server/error-handler';
import {
  consumeOAuthTransactionByStateHash,
  deleteEncryptedGoogleTokens,
  loadDecryptedGoogleTokens,
  markOAuthTransactionConsumed,
  markOAuthTransactionFailed,
  saveEncryptedGoogleTokens,
  saveOAuthTransaction,
  type VaultStorageOptions,
} from '@/lib/server/google-vault';
import type { SecretPayload } from '@/lib/server/crypto';

export const GOOGLE_OAUTH_ENDPOINTS = {
  AUTHORIZE: 'https://accounts.google.com/o/oauth2/v2/auth',
  TOKEN: 'https://oauth2.googleapis.com/token',
  USERINFO: 'https://openidconnect.googleapis.com/v1/userinfo',
  TOKENINFO: 'https://oauth2.googleapis.com/tokeninfo',
  REVOKE: 'https://oauth2.googleapis.com/revoke',
} as const;

export type FetchLike = typeof fetch;

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function buildAuthorizeTransaction(params: {
  userId: string;
  workspaceId: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  intent: GoogleOAuthTransactionRecord['intent'];
  returnPath?: string;
  forceConsent?: boolean;
  loginHint?: string;
}): {
  authorizeUrl: string;
  transaction: GoogleOAuthTransactionRecord;
  rawState: string;
  sessionBindingNonce: string;
} {
  const rawState = crypto.randomBytes(32).toString('base64url');
  const sessionBindingNonce = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  const expiresAt = new Date(now + 10 * 60 * 1000).toISOString();
  const txId = `oauth_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;

  const transaction: GoogleOAuthTransactionRecord = {
    id: txId,
    stateHash: sha256Hex(rawState),
    userId: params.userId,
    workspaceId: params.workspaceId,
    intent: params.intent,
    requestedScopes: params.scopes,
    redirectUri: params.redirectUri,
    returnPath:
      params.returnPath && params.returnPath.startsWith('/dashboard')
        ? params.returnPath
        : '/dashboard/integrations',
    sessionBindingHash: sha256Hex(sessionBindingNonce),
    status: 'pending',
    expiresAt,
    createdAt: new Date(now).toISOString(),
  };

  const url = new URL(GOOGLE_OAUTH_ENDPOINTS.AUTHORIZE);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scopes.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  if (
    params.forceConsent ||
    params.intent === 'connect' ||
    params.intent === 'reauthorize'
  ) {
    url.searchParams.set('prompt', 'consent');
  }
  if (params.loginHint) {
    url.searchParams.set('login_hint', params.loginHint);
  }
  url.searchParams.set('state', rawState);

  return {
    authorizeUrl: url.toString(),
    transaction,
    rawState,
    sessionBindingNonce,
  };
}

export async function startGoogleOAuthTransaction(
  params: Parameters<typeof buildAuthorizeTransaction>[0] & {
    vaultOptions?: VaultStorageOptions;
  },
): Promise<{
  authorizeUrl: string;
  transaction: GoogleOAuthTransactionRecord;
  sessionBindingNonce: string;
}> {
  const built = buildAuthorizeTransaction(params);
  await saveOAuthTransaction(built.transaction, params.vaultOptions);
  return {
    authorizeUrl: built.authorizeUrl,
    transaction: built.transaction,
    sessionBindingNonce: built.sessionBindingNonce,
  };
}

export interface GoogleTokenExchangeResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export interface GoogleUserInfoResponse {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export async function exchangeCodeForGoogleTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: FetchLike;
}): Promise<GoogleTokenExchangeResponse> {
  const fetcher = params.fetchImpl || fetch;
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetcher(GOOGLE_OAUTH_ENDPOINTS.TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = (await res.json().catch(() => null)) as
    | (GoogleTokenExchangeResponse & { error?: string; error_description?: string })
    | null;

  if (!res.ok || !data?.access_token) {
    const code = data?.error || 'token_exchange_failed';
    const desc =
      data?.error_description || `Google OAuth token exchange failed (${res.status}).`;
    throw new AppError(400, 'GOOGLE_TOKEN_EXCHANGE_FAILED', `${code}: ${desc}`);
  }

  return data;
}

export async function fetchGoogleUserInfo(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleUserInfoResponse> {
  const res = await fetchImpl(GOOGLE_OAUTH_ENDPOINTS.USERINFO, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = (await res.json().catch(() => null)) as
    | (GoogleUserInfoResponse & { error?: string; error_description?: string })
    | null;

  if (!res.ok || !data?.sub || !data?.email) {
    throw new AppError(
      401,
      'GOOGLE_USERINFO_FAILED',
      data?.error_description || 'Unable to verify Google identity via OpenID Connect userinfo.',
    );
  }

  return {
    sub: String(data.sub),
    email: String(data.email).toLowerCase(),
    email_verified: data.email_verified,
    name: data.name,
    picture: data.picture,
  };
}

export async function refreshGoogleAccessToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchLike;
}): Promise<{
  accessToken: string;
  expiresIn: number;
  scope?: string;
  tokenType: string;
}> {
  const fetcher = params.fetchImpl || fetch;
  const body = new URLSearchParams({
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: 'refresh_token',
  });

  const res = await fetcher(GOOGLE_OAUTH_ENDPOINTS.TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = (await res.json().catch(() => null)) as
    | {
        access_token?: string;
        expires_in?: number;
        scope?: string;
        token_type?: string;
        error?: string;
        error_description?: string;
      }
    | null;

  if (!res.ok || !data?.access_token) {
    const errCode = data?.error || '';
    if (errCode === 'invalid_grant') {
      throw new AppError(
        401,
        'GOOGLE_REAUTH_REQUIRED',
        'Google refresh token expired or was revoked by the user. Reauthorize your Google connection.',
      );
    }
    throw new AppError(
      502,
      'GOOGLE_TOKEN_REFRESH_FAILED',
      data?.error_description || `Google token refresh failed (${res.status}).`,
    );
  }

  return {
    accessToken: data.access_token,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : 3600,
    scope: data.scope,
    tokenType: data.token_type || 'Bearer',
  };
}

export async function verifyGoogleTokenInfo(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<{
  valid: boolean;
  scopes: string[];
  expiresInSeconds?: number;
  email?: string;
  reason?: string;
}> {
  const url = new URL(GOOGLE_OAUTH_ENDPOINTS.TOKENINFO);
  url.searchParams.set('access_token', accessToken);

  const res = await fetchImpl(url.toString(), { method: 'GET' });
  const data = (await res.json().catch(() => null)) as
    | {
        scope?: string;
        expires_in?: string | number;
        email?: string;
        error?: string;
        error_description?: string;
      }
    | null;

  if (!res.ok || !data) {
    return {
      valid: false,
      scopes: [],
      reason: data?.error_description || `Token rejected by Google (${res.status}).`,
    };
  }

  return {
    valid: true,
    scopes: normalizeGrantedScopeList(data.scope),
    expiresInSeconds:
      data.expires_in !== undefined ? Number(data.expires_in) : undefined,
    email: data.email?.toLowerCase(),
  };
}

export async function revokeGoogleToken(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ revoked: boolean; detail?: string }> {
  const res = await fetchImpl(GOOGLE_OAUTH_ENDPOINTS.REVOKE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  });

  if (res.ok || res.status === 400) {
    // Google returns 400 invalid_token if already revoked — treat cleanly as disconnected locally
    return {
      revoked: true,
      ...(res.status === 400
        ? { detail: 'Google token was already inactive or revoked upstream.' }
        : {}),
    };
  }

  return {
    revoked: false,
    detail: `Google revocation endpoint returned HTTP ${res.status}.`,
  };
}

export async function validateAndConsumeOAuthCallback(params: {
  rawState: string;
  sessionBindingNonce?: string;
  currentUserId?: string;
  errorParam?: string;
  vaultOptions?: VaultStorageOptions;
}): Promise<GoogleOAuthTransactionRecord> {
  if (!params.rawState) {
    throw new AppError(400, 'OAUTH_STATE_MISSING', 'Missing OAuth state parameter.');
  }

  const stateHash = sha256Hex(params.rawState);
  const tx = await consumeOAuthTransactionByStateHash(stateHash, params.vaultOptions);
  if (!tx) {
    throw new AppError(
      400,
      'OAUTH_STATE_INVALID',
      'Invalid or unknown OAuth state token. Start Google authorization again from Antara.',
    );
  }

  if (tx.status !== 'pending' || tx.consumedAt) {
    throw new AppError(
      409,
      'OAUTH_STATE_REPLAYED',
      'This OAuth authorization callback has already been consumed or invalidated.',
    );
  }

  if (Date.now() > Date.parse(tx.expiresAt)) {
    await markOAuthTransactionFailed(tx, 'expired', params.vaultOptions);
    throw new AppError(
      400,
      'OAUTH_STATE_EXPIRED',
      'OAuth authorization window expired (10 minutes). Start authorization again.',
    );
  }

  if (params.currentUserId && params.currentUserId !== tx.userId) {
    await markOAuthTransactionFailed(tx, 'failed', params.vaultOptions);
    throw new AppError(
      403,
      'OAUTH_SESSION_MISMATCH',
      'Authenticated Antara user does not match the user who initiated Google OAuth.',
    );
  }

  if (params.sessionBindingNonce) {
    const providedHash = sha256Hex(params.sessionBindingNonce);
    if (providedHash !== tx.sessionBindingHash) {
      await markOAuthTransactionFailed(tx, 'failed', params.vaultOptions);
      throw new AppError(
        403,
        'OAUTH_BINDING_MISMATCH',
        'OAuth browser session binding check failed.',
      );
    }
  }

  if (params.errorParam) {
    await markOAuthTransactionFailed(tx, 'denied', params.vaultOptions);
    throw new AppError(
      400,
      'GOOGLE_OAUTH_DENIED',
      params.errorParam === 'access_denied'
        ? 'Google authorization was cancelled or denied by the user.'
        : `Google OAuth returned error: ${params.errorParam}`,
    );
  }

  await markOAuthTransactionConsumed(
    tx,
    new Date().toISOString(),
    params.vaultOptions,
  );
  return tx;
}

export async function persistExchangedGoogleConnection(params: {
  workspaceId: string;
  connectionId: string;
  existingConnection: GoogleConnectionRecord | null;
  tokenResponse: GoogleTokenExchangeResponse;
  userInfo: GoogleUserInfoResponse;
  requestedScopes: string[];
  vaultOptions?: VaultStorageOptions;
}): Promise<{
  scopes: string[];
  hasRefreshToken: boolean;
  accessTokenExpiresAt: string;
}> {
  let preservedRefreshToken = params.tokenResponse.refresh_token;
  let previousScopes: string[] = [];

  if (!preservedRefreshToken && params.existingConnection) {
    try {
      const existingTokens = await loadDecryptedGoogleTokens(
        params.workspaceId,
        params.connectionId,
        params.vaultOptions,
      );
      if (existingTokens?.payload.refreshToken) {
        preservedRefreshToken = existingTokens.payload.refreshToken;
      }
      if (existingTokens?.payload.scopes) {
        previousScopes = existingTokens.payload.scopes;
      }
    } catch {
      // Proceed cleanly even if prior vault payload could not be read
    }
  }

  const normalizedIncoming = normalizeGrantedScopeList(
    params.tokenResponse.scope || params.requestedScopes,
  );
  const combinedScopes = Array.from(
    new Set([
      ...(params.existingConnection?.grantedScopes || []),
      ...previousScopes,
      ...normalizedIncoming,
    ]),
  );

  const expiresInMs = Math.max(60, params.tokenResponse.expires_in || 3600) * 1000;
  const expiryDateMs = Date.now() + expiresInMs;
  const accessTokenExpiresAt = new Date(expiryDateMs).toISOString();

  const payload: SecretPayload = {
    accessToken: params.tokenResponse.access_token,
    ...(preservedRefreshToken ? { refreshToken: preservedRefreshToken } : {}),
    tokenType: params.tokenResponse.token_type || 'Bearer',
    expiryDateMs,
    scopes: combinedScopes,
    accountEmail: params.userInfo.email,
    rotatedAt: new Date().toISOString(),
  };

  await saveEncryptedGoogleTokens(
    params.workspaceId,
    params.connectionId,
    payload,
    params.vaultOptions,
  );

  return {
    scopes: combinedScopes,
    hasRefreshToken: Boolean(preservedRefreshToken),
    accessTokenExpiresAt,
  };
}

export async function getValidGoogleAccessToken(params: {
  workspaceId: string;
  connection: GoogleConnectionRecord;
  clientId: string;
  clientSecret: string;
  fetchImpl?: FetchLike;
  vaultOptions?: VaultStorageOptions;
  onStatusChange?: (nextStatus: {
    status: GoogleConnectionRecord['status'];
    accessTokenExpiresAt?: string;
    lastErrorCode?: string;
    lastErrorMessage?: string;
  }) => Promise<void>;
}): Promise<{ accessToken: string; scopes: string[]; refreshed: boolean }> {
  const { workspaceId, connection } = params;
  if (connection.status === 'disconnected' || connection.status === 'revoked') {
    throw new AppError(
      401,
      'GOOGLE_CONNECTION_INACTIVE',
      `Google connection is ${connection.status}. Authorize Google access again to continue.`,
    );
  }

  const decrypted = await loadDecryptedGoogleTokens(
    workspaceId,
    connection.id,
    params.vaultOptions,
  );
  if (!decrypted) {
    if (params.onStatusChange) {
      await params.onStatusChange({
        status: 'reauth_required',
        lastErrorCode: 'VAULT_TOKENS_MISSING',
        lastErrorMessage: 'Encrypted Google tokens are unavailable; reconnect Google.',
      });
    }
    throw new AppError(
      401,
      'GOOGLE_REAUTH_REQUIRED',
      'Google credential vault entry is unavailable. Reauthorize Google access.',
    );
  }

  const payload = decrypted.payload;
  const safetyMarginMs = 90_000;
  const isNearExpiry = Date.now() + safetyMarginMs >= payload.expiryDateMs;

  if (!isNearExpiry) {
    return {
      accessToken: payload.accessToken,
      scopes: payload.scopes,
      refreshed: false,
    };
  }

  if (!payload.refreshToken) {
    if (params.onStatusChange) {
      await params.onStatusChange({
        status: 'reauth_required',
        lastErrorCode: 'REFRESH_TOKEN_MISSING',
        lastErrorMessage: 'Access token expired and no offline refresh token is present.',
      });
    }
    throw new AppError(
      401,
      'GOOGLE_REAUTH_REQUIRED',
      'Google access token expired and offline refresh token is unavailable. Reauthorize with consent.',
    );
  }

  if (!params.clientId || !params.clientSecret) {
    throw new AppError(
      503,
      'PLATFORM_OAUTH_NOT_CONFIGURED',
      'Platform Google OAuth Client ID and Client Secret are required to refresh expired access tokens.',
    );
  }

  try {
    const refreshed = await refreshGoogleAccessToken({
      refreshToken: payload.refreshToken,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      fetchImpl: params.fetchImpl,
    });

    const nextExpiryMs = Date.now() + refreshed.expiresIn * 1000;
    const nextScopes = refreshed.scope
      ? Array.from(
          new Set([
            ...payload.scopes,
            ...normalizeGrantedScopeList(refreshed.scope),
          ]),
        )
      : payload.scopes;

    await saveEncryptedGoogleTokens(
      workspaceId,
      connection.id,
      {
        ...payload,
        accessToken: refreshed.accessToken,
        tokenType: refreshed.tokenType,
        expiryDateMs: nextExpiryMs,
        scopes: nextScopes,
        rotatedAt: new Date().toISOString(),
      },
      params.vaultOptions,
    );

    if (params.onStatusChange) {
      await params.onStatusChange({
        status: 'connected',
        accessTokenExpiresAt: new Date(nextExpiryMs).toISOString(),
      });
    }

    return {
      accessToken: refreshed.accessToken,
      scopes: nextScopes,
      refreshed: true,
    };
  } catch (err) {
    if (err instanceof AppError && err.code === 'GOOGLE_REAUTH_REQUIRED') {
      if (params.onStatusChange) {
        await params.onStatusChange({
          status: 'revoked',
          lastErrorCode: 'GOOGLE_REAUTH_REQUIRED',
          lastErrorMessage: err.message,
        });
      }
    }
    throw err;
  }
}

export async function disconnectAndRevokeConnection(params: {
  workspaceId: string;
  connectionId: string;
  fetchImpl?: FetchLike;
  vaultOptions?: VaultStorageOptions;
}): Promise<{ revokedUpstream: boolean; detail?: string }> {
  let tokenToRevoke: string | undefined;
  try {
    const existing = await loadDecryptedGoogleTokens(
      params.workspaceId,
      params.connectionId,
      params.vaultOptions,
    );
    tokenToRevoke = existing?.payload.refreshToken || existing?.payload.accessToken;
  } catch {
    tokenToRevoke = undefined;
  }

  let revokedUpstream = false;
  let detail: string | undefined;
  if (tokenToRevoke) {
    const res = await revokeGoogleToken(tokenToRevoke, params.fetchImpl);
    revokedUpstream = res.revoked;
    detail = res.detail;
  }

  await deleteEncryptedGoogleTokens(
    params.workspaceId,
    params.connectionId,
    params.vaultOptions,
  );

  return { revokedUpstream, detail };
}
