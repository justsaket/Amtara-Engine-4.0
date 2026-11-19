import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  disconnectAndRevokeConnection,
  exchangeCodeForGoogleTokens,
  fetchGoogleUserInfo,
  getValidGoogleAccessToken,
  persistExchangedGoogleConnection,
  startGoogleOAuthTransaction,
  validateAndConsumeOAuthCallback,
} from '../src/lib/google/oauth';
import { canUserAccessGoogleConnection } from '../src/lib/server/phase2-repositories';
import {
  loadDecryptedGoogleTokens,
  saveOAuthTransaction,
  type VaultStorageOptions,
} from '../src/lib/server/google-vault';
import {
  getPlatformGoogleOAuthCredentials,
  getPlatformGoogleOAuthPublicStatus,
  savePlatformGoogleOAuthConfig,
} from '../src/lib/server/platform-oauth';
import { ensureInternalSecrets } from '../src/lib/server/secret-manager';
import type { GoogleConnectionRecord } from '../src/types/domain';

function createTempSandbox(): {
  root: string;
  secretsFile: string;
  vaultOptions: VaultStorageOptions;
  cleanup: () => void;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antara-phase2-vault-'));
  const secretsFile = path.join(root, 'internal-secrets.json');
  const vaultDir = path.join(root, 'vault');
  ensureInternalSecrets({ overridePath: secretsFile, autoPersistLocal: true });
  return {
    root,
    secretsFile,
    vaultOptions: {
      vaultDirOverride: vaultDir,
      secretsFileOverride: secretsFile,
      disableFirestoreAdmin: true,
    },
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('Platform Google OAuth config encrypts client secret and never leaks secret in public status', async () => {
  const sandbox = createTempSandbox();
  try {
    const saved = await savePlatformGoogleOAuthConfig({
      clientId: '1234567890-abcdefg.apps.googleusercontent.com',
      clientSecret: 'GOCSPX-super-secret-value-123',
      actorUid: 'owner_uid_1',
      secretsFileOverride: sandbox.secretsFile,
    });
    assert.equal(saved.configured, true);
    assert.ok(!JSON.stringify(saved).includes('GOCSPX-super-secret-value-123'));

    const status = await getPlatformGoogleOAuthPublicStatus({
      origin: 'https://antara-app.vercel.app',
      secretsFileOverride: sandbox.secretsFile,
    });
    assert.equal(
      status.redirectUri,
      'https://antara-app.vercel.app/api/integrations/google/callback',
    );
    assert.ok(!JSON.stringify(status).includes('GOCSPX-super-secret-value-123'));

    const internal = await getPlatformGoogleOAuthCredentials({
      origin: 'https://antara-app.vercel.app',
      secretsFileOverride: sandbox.secretsFile,
    });
    assert.equal(internal.clientSecret, 'GOCSPX-super-secret-value-123');
  } finally {
    sandbox.cleanup();
  }
});

test('Google OAuth flow enforces CSRF state, single-use replay protection, session binding, expiry, and denial handling', async () => {
  const sandbox = createTempSandbox();
  try {
    const started = await startGoogleOAuthTransaction({
      userId: 'uid_owner',
      workspaceId: 'ws_alpha',
      clientId: 'client_123',
      redirectUri: 'http://localhost:3000/api/integrations/google/callback',
      scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/script.projects'],
      intent: 'connect',
      vaultOptions: sandbox.vaultOptions,
    });

    const authUrl = new URL(started.authorizeUrl);
    const rawState = authUrl.searchParams.get('state')!;
    assert.equal(authUrl.searchParams.get('access_type'), 'offline');
    assert.equal(authUrl.searchParams.get('include_granted_scopes'), 'true');
    assert.equal(authUrl.searchParams.get('prompt'), 'consent');

    // Cross-user attempt fails before consuming state
    await assert.rejects(
      () =>
        validateAndConsumeOAuthCallback({
          rawState,
          sessionBindingNonce: started.sessionBindingNonce,
          currentUserId: 'uid_other_attacker',
          vaultOptions: sandbox.vaultOptions,
        }),
      (err: Error & { code?: string }) => err.code === 'OAUTH_SESSION_MISMATCH',
    );

    // Invalid state fails
    await assert.rejects(
      () =>
        validateAndConsumeOAuthCallback({
          rawState: 'tampered_invalid_state',
          vaultOptions: sandbox.vaultOptions,
        }),
      (err: Error & { code?: string }) => err.code === 'OAUTH_STATE_INVALID',
    );

    // Start fresh valid transaction & consume cleanly
    const validStart = await startGoogleOAuthTransaction({
      userId: 'uid_owner',
      workspaceId: 'ws_alpha',
      clientId: 'client_123',
      redirectUri: 'http://localhost:3000/api/integrations/google/callback',
      scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/script.projects'],
      intent: 'connect',
      vaultOptions: sandbox.vaultOptions,
    });
    const validRawState = new URL(validStart.authorizeUrl).searchParams.get('state')!;

    const consumedTx = await validateAndConsumeOAuthCallback({
      rawState: validRawState,
      sessionBindingNonce: validStart.sessionBindingNonce,
      currentUserId: 'uid_owner',
      vaultOptions: sandbox.vaultOptions,
    });
    assert.equal(consumedTx.workspaceId, 'ws_alpha');

    // Replaying the same state immediately fails cleanly
    await assert.rejects(
      () =>
        validateAndConsumeOAuthCallback({
          rawState: validRawState,
          sessionBindingNonce: validStart.sessionBindingNonce,
          currentUserId: 'uid_owner',
          vaultOptions: sandbox.vaultOptions,
        }),
      (err: Error & { code?: string }) => err.code === 'OAUTH_STATE_REPLAYED',
    );

    // Expired state rejected
    const expiredStart = await startGoogleOAuthTransaction({
      userId: 'uid_owner',
      workspaceId: 'ws_alpha',
      clientId: 'client_123',
      redirectUri: 'http://localhost:3000/api/integrations/google/callback',
      scopes: ['openid'],
      intent: 'connect',
      vaultOptions: sandbox.vaultOptions,
    });
    await saveOAuthTransaction(
      {
        ...expiredStart.transaction,
        expiresAt: new Date(Date.now() - 5000).toISOString(),
      },
      sandbox.vaultOptions,
    );
    await assert.rejects(
      () =>
        validateAndConsumeOAuthCallback({
          rawState: new URL(expiredStart.authorizeUrl).searchParams.get('state')!,
          vaultOptions: sandbox.vaultOptions,
        }),
      (err: Error & { code?: string }) => err.code === 'OAUTH_STATE_EXPIRED',
    );

    // Denied consent rejected cleanly
    const deniedStart = await startGoogleOAuthTransaction({
      userId: 'uid_owner',
      workspaceId: 'ws_alpha',
      clientId: 'client_123',
      redirectUri: 'http://localhost:3000/api/integrations/google/callback',
      scopes: ['openid'],
      intent: 'connect',
      vaultOptions: sandbox.vaultOptions,
    });
    await assert.rejects(
      () =>
        validateAndConsumeOAuthCallback({
          rawState: new URL(deniedStart.authorizeUrl).searchParams.get('state')!,
          errorParam: 'access_denied',
          vaultOptions: sandbox.vaultOptions,
        }),
      (err: Error & { code?: string }) => err.code === 'GOOGLE_OAUTH_DENIED',
    );
  } finally {
    sandbox.cleanup();
  }
});

test('Token exchange, refresh-token preservation, auto-refresh, revocation detection, and emergency wipe work cleanly', async () => {
  const sandbox = createTempSandbox();
  try {
    const mockedFetch: typeof fetch = async (url, init) => {
      const target = String(url);
      if (target.includes('oauth2.googleapis.com/token')) {
        const body = String(init?.body || '');
        if (body.includes('grant_type=authorization_code')) {
          return new Response(
            JSON.stringify({
              access_token: 'ya29.initial_token',
              expires_in: 3600,
              refresh_token: '1//0e_original_refresh_token',
              scope: 'openid email profile https://www.googleapis.com/auth/script.projects',
              token_type: 'Bearer',
            }),
            { status: 200 },
          );
        }
        if (body.includes('refresh_token=1%2F%2F0e_revoked')) {
          return new Response(
            JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been revoked.' }),
            { status: 400 },
          );
        }
        return new Response(
          JSON.stringify({
            access_token: 'ya29.refreshed_access_token',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200 },
        );
      }
      if (target.includes('openidconnect.googleapis.com/v1/userinfo')) {
        return new Response(
          JSON.stringify({
            sub: 'google_sub_777',
            email: 'founder@antara.in',
            name: 'Saket Founder',
          }),
          { status: 200 },
        );
      }
      if (target.includes('oauth2.googleapis.com/revoke')) {
        return new Response('', { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };

    const tokenRes = await exchangeCodeForGoogleTokens({
      code: 'auth_code_1',
      clientId: 'cid',
      clientSecret: 'csec',
      redirectUri: 'http://localhost:3000/api/integrations/google/callback',
      fetchImpl: mockedFetch,
    });
    const userInfo = await fetchGoogleUserInfo(tokenRes.access_token, mockedFetch);
    assert.equal(userInfo.email, 'founder@antara.in');

    const firstPersist = await persistExchangedGoogleConnection({
      workspaceId: 'ws_1',
      connectionId: 'gconn_1',
      existingConnection: null,
      tokenResponse: tokenRes,
      userInfo,
      requestedScopes: ['openid', 'email'],
      vaultOptions: sandbox.vaultOptions,
    });
    assert.equal(firstPersist.hasRefreshToken, true);

    const connRecord: GoogleConnectionRecord = {
      id: 'gconn_1',
      workspaceId: 'ws_1',
      userId: 'uid_founder',
      userEmail: 'founder@antara.in',
      googleAccountId: userInfo.sub,
      googleEmail: userInfo.email,
      status: 'connected',
      grantedScopes: firstPersist.scopes,
      encryptedCredentialId: 'gconn_1',
      accessTokenExpiresAt: firstPersist.accessTokenExpiresAt,
      hasRefreshToken: true,
      sharedWithWorkspace: false,
      consentSeparatedFromLogin: true,
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Incremental re-auth where Google omits refresh_token MUST preserve original refresh token!
    const incrementalPersist = await persistExchangedGoogleConnection({
      workspaceId: 'ws_1',
      connectionId: 'gconn_1',
      existingConnection: connRecord,
      tokenResponse: {
        access_token: 'ya29.incremental_token',
        expires_in: 5, // Simulate near-expiry (< 90s margin)
        scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
      },
      userInfo,
      requestedScopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'],
      vaultOptions: sandbox.vaultOptions,
    });
    assert.equal(incrementalPersist.hasRefreshToken, true);
    assert.ok(
      incrementalPersist.scopes.includes(
        'https://www.googleapis.com/auth/drive.metadata.readonly',
      ),
    );
    assert.ok(
      incrementalPersist.scopes.includes(
        'https://www.googleapis.com/auth/script.projects',
      ),
    );

    // Near-expiry triggers automatic refresh using preserved refresh token
    const refreshedToken = await getValidGoogleAccessToken({
      workspaceId: 'ws_1',
      connection: connRecord,
      clientId: 'cid',
      clientSecret: 'csec',
      fetchImpl: mockedFetch,
      vaultOptions: sandbox.vaultOptions,
    });
    assert.equal(refreshedToken.refreshed, true);
    assert.equal(refreshedToken.accessToken, 'ya29.refreshed_access_token');

    // Cross-user isolation guard: private connection cannot be accessed by another workspace editor
    assert.equal(canUserAccessGoogleConnection(connRecord, 'uid_founder', 'owner'), true);
    assert.equal(canUserAccessGoogleConnection(connRecord, 'uid_other_editor', 'editor'), false);
    assert.equal(
      canUserAccessGoogleConnection(
        { ...connRecord, sharedWithWorkspace: true },
        'uid_other_editor',
        'editor',
      ),
      true,
    );

    // Emergency disconnect revokes upstream and wipes ciphertext cleanly
    const revokeRes = await disconnectAndRevokeConnection({
      workspaceId: 'ws_1',
      connectionId: 'gconn_1',
      fetchImpl: mockedFetch,
      vaultOptions: sandbox.vaultOptions,
    });
    assert.equal(revokeRes.revokedUpstream, true);
    const afterWipe = await loadDecryptedGoogleTokens(
      'ws_1',
      'gconn_1',
      sandbox.vaultOptions,
    );
    assert.equal(afterWipe, null);
  } finally {
    sandbox.cleanup();
  }
});
