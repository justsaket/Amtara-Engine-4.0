import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import {
  decryptStringWithAad,
  encryptStringWithAad,
} from '@/lib/server/crypto';
import { AppError } from '@/lib/server/error-handler';
import { getFirebaseAdmin } from '@/lib/server/firebase-admin';
import {
  clearPersistedGooglePlatformOAuth,
  ensureInternalSecrets,
  readPersistedInternalSecrets,
  savePersistedGooglePlatformOAuth,
} from '@/lib/server/secret-manager';

const PLATFORM_OAUTH_AAD = 'antara:platform:google_oauth:v1';
const SERVER_VAULT_DOC_PATH = '_serverVault/google_oauth';

export interface PlatformOAuthPublicStatus {
  configured: boolean;
  source: 'env' | 'server_vault' | 'local_file' | 'unset';
  maskedClientId?: string;
  redirectUri: string;
  redirectUriOrigin: string;
  canSaveFromUi: boolean;
  persistenceMode: string;
  updatedAt?: string;
}

export interface ResolvedPlatformOAuthCredentials {
  configured: boolean;
  source: PlatformOAuthPublicStatus['source'];
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  maskedClientId?: string;
}

export function maskClientId(clientId: string): string {
  const trimmed = clientId.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 14) return `${trimmed.slice(0, 4)}…`;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-16)}`;
}

export function resolveRequestOrigin(req?: {
  headers?: { get(name: string): string | null };
  url?: string;
}): string {
  const config = resolveAutonomousConfiguration();
  const fallbackOrigin = config.snapshot.environment.appUrl;

  if (!req) return fallbackOrigin;

  const forwardedHost = req.headers?.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || req.headers?.get('host')?.split(',')[0]?.trim();
  const forwardedProto = req.headers?.get('x-forwarded-proto')?.split(',')[0]?.trim();

  if (host) {
    const isLocal =
      host.startsWith('localhost') ||
      host.startsWith('127.0.0.1') ||
      host.startsWith('[::1]');
    const proto = forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : isLocal
        ? 'http'
        : 'https';
    return `${proto}://${host}`.replace(/\/+$/, '');
  }

  if (req.url) {
    try {
      const parsed = new URL(req.url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin.replace(/\/+$/, '');
      }
    } catch {
      // ignore invalid URL
    }
  }

  return fallbackOrigin;
}

export function computeGoogleRedirectUri(origin: string): string {
  const explicitEnv = (process.env.GOOGLE_INTEGRATION_REDIRECT_URI || '').trim();
  if (explicitEnv) {
    try {
      const parsed = new URL(explicitEnv);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return explicitEnv;
      }
    } catch {
      // Fallback to dynamic origin if explicit env URL is malformed
    }
  }
  return `${origin.replace(/\/+$/, '')}/api/integrations/google/callback`;
}

export async function getPlatformGoogleOAuthCredentials(options?: {
  origin?: string;
  secretsFileOverride?: string;
}): Promise<ResolvedPlatformOAuthCredentials> {
  const config = resolveAutonomousConfiguration({
    secretsFileOverride: options?.secretsFileOverride,
  });
  const origin = options?.origin || config.snapshot.environment.appUrl;
  const redirectUri = computeGoogleRedirectUri(origin);

  const envClientId = (
    process.env.GOOGLE_INTEGRATION_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID ||
    ''
  ).trim();
  const envClientSecret = (
    process.env.GOOGLE_INTEGRATION_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    ''
  ).trim();

  if (envClientId && envClientSecret) {
    return {
      configured: true,
      source: 'env',
      clientId: envClientId,
      clientSecret: envClientSecret,
      redirectUri,
      maskedClientId: maskClientId(envClientId),
    };
  }

  // Try Firebase Admin server vault first if explicit service account is configured
  const { db, hasExplicitServiceAccount } = getFirebaseAdmin();
  if (hasExplicitServiceAccount && db) {
    try {
      const snap = await db.doc(SERVER_VAULT_DOC_PATH).get();
      if (snap.exists) {
        const data = snap.data() as {
          clientId?: string;
          encryptedClientSecret?: string;
          redirectUri?: string;
        };
        if (data.clientId && data.encryptedClientSecret) {
          const decrypted = decryptStringWithAad(
            data.encryptedClientSecret,
            PLATFORM_OAUTH_AAD,
            { secretsFile: options?.secretsFileOverride },
          );
          return {
            configured: true,
            source: 'server_vault',
            clientId: data.clientId,
            clientSecret: decrypted.plaintext,
            redirectUri: data.redirectUri || redirectUri,
            maskedClientId: maskClientId(data.clientId),
          };
        }
      }
    } catch {
      // Fall through cleanly if vault read/decrypt fails
    }
  }

  // Try git-ignored local encrypted file (.antara/internal-secrets.json)
  const local = readPersistedInternalSecrets(options?.secretsFileOverride);
  if (local?.googlePlatformOAuth?.clientId && local.googlePlatformOAuth.encryptedClientSecret) {
    const decrypted = decryptStringWithAad(
      local.googlePlatformOAuth.encryptedClientSecret,
      PLATFORM_OAUTH_AAD,
      { secretsFile: options?.secretsFileOverride },
    );
    return {
      configured: true,
      source: 'local_file',
      clientId: local.googlePlatformOAuth.clientId,
      clientSecret: decrypted.plaintext,
      redirectUri: local.googlePlatformOAuth.redirectUri || redirectUri,
      maskedClientId: maskClientId(local.googlePlatformOAuth.clientId),
    };
  }

  return {
    configured: false,
    source: 'unset',
    clientId: '',
    clientSecret: '',
    redirectUri,
  };
}

export async function getPlatformGoogleOAuthPublicStatus(options?: {
  origin?: string;
  secretsFileOverride?: string;
}): Promise<PlatformOAuthPublicStatus> {
  const creds = await getPlatformGoogleOAuthCredentials(options);
  const { hasExplicitServiceAccount } = getFirebaseAdmin();
  const isVercel = process.env.VERCEL === '1';
  const canSaveFromUi = hasExplicitServiceAccount || !isVercel;
  const persistenceMode = hasExplicitServiceAccount
    ? 'Firestore server vault (_serverVault) + AES-256-GCM'
    : !isVercel
      ? 'Local server vault (.antara/internal-secrets.json 0600) + AES-256-GCM'
      : 'Environment variables (Vercel runtime without Firebase Service Account JSON)';

  const local = readPersistedInternalSecrets(options?.secretsFileOverride);

  return {
    configured: creds.configured,
    source: creds.source,
    ...(creds.maskedClientId ? { maskedClientId: creds.maskedClientId } : {}),
    redirectUri: creds.redirectUri,
    redirectUriOrigin: options?.origin || resolveAutonomousConfiguration().snapshot.environment.appUrl,
    canSaveFromUi,
    persistenceMode,
    ...(creds.source === 'local_file' && local?.googlePlatformOAuth?.updatedAt
      ? { updatedAt: local.googlePlatformOAuth.updatedAt }
      : {}),
  };
}

export async function savePlatformGoogleOAuthConfig(input: {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
  actorUid: string;
  secretsFileOverride?: string;
}): Promise<PlatformOAuthPublicStatus> {
  const isVercel = process.env.VERCEL === '1';
  if (!isVercel) {
    ensureInternalSecrets({
      overridePath: input.secretsFileOverride,
      autoPersistLocal: true,
    });
  }

  const encrypted = encryptStringWithAad(
    input.clientSecret.trim(),
    PLATFORM_OAUTH_AAD,
    { secretsFile: input.secretsFileOverride },
  );

  const now = new Date().toISOString();
  const clientId = input.clientId.trim();
  const redirectUri = input.redirectUri?.trim() || undefined;

  const { db, hasExplicitServiceAccount } = getFirebaseAdmin();
  let saved = false;

  if (hasExplicitServiceAccount && db) {
    await db.doc(SERVER_VAULT_DOC_PATH).set({
      clientId,
      encryptedClientSecret: encrypted.encryptedPayload,
      keyVersion: encrypted.keyVersion,
      ...(redirectUri ? { redirectUri } : {}),
      updatedBy: input.actorUid,
      updatedAt: now,
    });
    saved = true;
  }

  if (!isVercel) {
    const localSaved = savePersistedGooglePlatformOAuth(
      {
        clientId,
        encryptedClientSecret: encrypted.encryptedPayload,
        keyVersion: encrypted.keyVersion,
        ...(redirectUri ? { redirectUri } : {}),
        updatedBy: input.actorUid,
        updatedAt: now,
      },
      input.secretsFileOverride,
    );
    saved = saved || localSaved;
  }

  if (!saved) {
    throw new AppError(
      400,
      'SERVER_VAULT_UNAVAILABLE',
      'Cannot persist Platform OAuth secrets from the dashboard on Vercel without FIREBASE_SERVICE_ACCOUNT_JSON. Configure GOOGLE_INTEGRATION_CLIENT_ID and GOOGLE_INTEGRATION_CLIENT_SECRET in Vercel Project Settings instead.',
    );
  }

  return getPlatformGoogleOAuthPublicStatus({
    secretsFileOverride: input.secretsFileOverride,
  });
}

export async function clearPlatformGoogleOAuthConfig(options?: {
  secretsFileOverride?: string;
}): Promise<void> {
  const { db, hasExplicitServiceAccount } = getFirebaseAdmin();
  if (hasExplicitServiceAccount && db) {
    await db.doc(SERVER_VAULT_DOC_PATH).delete().catch(() => null);
  }
  clearPersistedGooglePlatformOAuth(options?.secretsFileOverride);
}
