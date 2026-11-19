import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface PersistedGooglePlatformOAuth {
  clientId: string;
  encryptedClientSecret: string;
  keyVersion: string;
  redirectUri?: string;
  updatedBy: string;
  updatedAt: string;
}

export interface PersistedInternalSecrets {
  sessionSecret?: string;
  internalSigningSecret?: string;
  encryptionKey?: string;
  encryptionKeyVersion?: string;
  previousEncryptionKey?: string;
  previousEncryptionKeyVersion?: string;
  googlePlatformOAuth?: PersistedGooglePlatformOAuth;
  rotatedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

const DEFAULT_SECRETS_FILE = path.resolve(
  process.cwd(),
  '.antara',
  'internal-secrets.json',
);

export function resolveInternalSecretsPath(overridePath?: string): string {
  return overridePath || process.env.ANTARA_SECRETS_FILE || DEFAULT_SECRETS_FILE;
}

export function generateSecureSecretHex(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

export function readPersistedInternalSecrets(
  overridePath?: string,
): PersistedInternalSecrets | null {
  const target = resolveInternalSecretsPath(overridePath);
  if (!fs.existsSync(target)) return null;
  try {
    const raw = fs.readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw) as PersistedInternalSecrets;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedSecretsAtomic(
  secrets: PersistedInternalSecrets,
  overridePath?: string,
): boolean {
  const target = resolveInternalSecretsPath(overridePath);
  try {
    const dir = path.dirname(target);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(secrets, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tmp, target);
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // Ignore chmod restrictions on platforms that disallow it
    }
    return true;
  } catch {
    return false;
  }
}

export function bumpKeyVersion(currentVersion: string): string {
  const match = /^v(\d+)$/i.exec(currentVersion.trim());
  if (match) {
    return `v${Number(match[1]) + 1}`;
  }
  return `${currentVersion.trim() || 'v1'}_next`;
}

export interface SecretInitializationResult {
  persistedLocally: boolean;
  isVercelRuntime: boolean;
  sessionSecretReady: boolean;
  encryptionKeyReady: boolean;
  encryptionKeyVersion: string;
  rotationPerformed: boolean;
  previousKeyVersion?: string;
  /**
   * Non-persisted instructions only emitted once during an authorized admin setup action
   * on stateless hosts (Vercel) when local filesystem persistence is unavailable.
   */
  envInstructions?: Record<string, string>;
}

/**
 * Ensures stable internal security secrets exist without regenerating keys per request/deployment.
 * Locally, persists securely with 0600 permissions inside git-ignored `.antara/internal-secrets.json`.
 * Never writes master encryption keys inside the same Firestore database they protect.
 */
export function ensureInternalSecrets(options?: {
  overridePath?: string;
  autoPersistLocal?: boolean;
}): SecretInitializationResult {
  const isVercelRuntime = process.env.VERCEL === '1';
  const existing = readPersistedInternalSecrets(options?.overridePath) || {};
  const now = new Date().toISOString();

  const envSessionSecret = (process.env.SESSION_SECRET || '').trim();
  const envSigningSecret = (process.env.INTERNAL_SIGNING_SECRET || '').trim();
  const envEncryptionKey = (process.env.ENCRYPTION_KEY || '').trim();
  const envKeyVersion = (process.env.ENCRYPTION_KEY_VERSION || '').trim();

  const needSessionSecret = envSessionSecret.length < 16 && !existing.sessionSecret;
  const needSigningSecret = envSigningSecret.length < 16 && !existing.internalSigningSecret;
  const needEncryptionKey = envEncryptionKey.length < 32 && !existing.encryptionKey;

  const nextSessionSecret = needSessionSecret ? generateSecureSecretHex(32) : undefined;
  const nextSigningSecret = needSigningSecret ? generateSecureSecretHex(32) : undefined;
  const nextEncryptionKey = needEncryptionKey ? generateSecureSecretHex(32) : undefined;

  const activeVersion = envKeyVersion || existing.encryptionKeyVersion || 'v1';

  const shouldPersist =
    !isVercelRuntime &&
    options?.autoPersistLocal !== false &&
    Boolean(nextSessionSecret || nextSigningSecret || nextEncryptionKey);

  let persistedLocally = false;
  if (shouldPersist) {
    const nextRecord: PersistedInternalSecrets = {
      ...existing,
      ...(nextSessionSecret ? { sessionSecret: nextSessionSecret } : {}),
      ...(nextSigningSecret ? { internalSigningSecret: nextSigningSecret } : {}),
      ...(nextEncryptionKey
        ? { encryptionKey: nextEncryptionKey, encryptionKeyVersion: activeVersion }
        : {}),
      createdAt: existing.createdAt || now,
      updatedAt: now,
    };
    persistedLocally = writePersistedSecretsAtomic(nextRecord, options?.overridePath);
  }

  const after = readPersistedInternalSecrets(options?.overridePath);

  const sessionSecretReady = Boolean(
    envSessionSecret.length >= 16 || (after?.sessionSecret && after.sessionSecret.length >= 16),
  );
  const encryptionKeyReady = Boolean(
    envEncryptionKey.length >= 32 || (after?.encryptionKey && after.encryptionKey.length >= 32),
  );

  const instructions: Record<string, string> = {};
  if (isVercelRuntime) {
    if (!sessionSecretReady && nextSessionSecret) {
      instructions.SESSION_SECRET = nextSessionSecret;
    }
    if (!encryptionKeyReady && nextEncryptionKey) {
      instructions.ENCRYPTION_KEY = nextEncryptionKey;
      instructions.ENCRYPTION_KEY_VERSION = activeVersion;
    }
  }

  return {
    persistedLocally,
    isVercelRuntime,
    sessionSecretReady,
    encryptionKeyReady,
    encryptionKeyVersion: activeVersion,
    rotationPerformed: false,
    ...(Object.keys(instructions).length > 0 ? { envInstructions: instructions } : {}),
  };
}

export function rotateInternalEncryptionKey(options?: {
  overridePath?: string;
}): SecretInitializationResult {
  const isVercelRuntime = process.env.VERCEL === '1';
  const existing = readPersistedInternalSecrets(options?.overridePath) || {};
  const activeKey = (process.env.ENCRYPTION_KEY || existing.encryptionKey || '').trim();
  const activeVersion = (
    process.env.ENCRYPTION_KEY_VERSION ||
    existing.encryptionKeyVersion ||
    'v1'
  ).trim();

  const newKey = generateSecureSecretHex(32);
  const newVersion = bumpKeyVersion(activeVersion);
  const now = new Date().toISOString();

  const canWriteLocal = !process.env.ENCRYPTION_KEY && !isVercelRuntime;
  let persistedLocally = false;

  if (canWriteLocal) {
    const nextRecord: PersistedInternalSecrets = {
      ...existing,
      encryptionKey: newKey,
      encryptionKeyVersion: newVersion,
      ...(activeKey
        ? {
            previousEncryptionKey: activeKey,
            previousEncryptionKeyVersion: activeVersion,
          }
        : {}),
      rotatedAt: now,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    };
    persistedLocally = writePersistedSecretsAtomic(nextRecord, options?.overridePath);
  }

  return {
    persistedLocally,
    isVercelRuntime,
    sessionSecretReady: true,
    encryptionKeyReady: true,
    encryptionKeyVersion: newVersion,
    rotationPerformed: true,
    previousKeyVersion: activeKey ? activeVersion : undefined,
    ...(!persistedLocally
      ? {
          envInstructions: {
            ENCRYPTION_KEY: newKey,
            ENCRYPTION_KEY_VERSION: newVersion,
            ...(activeKey
              ? {
                  ENCRYPTION_KEY_PREVIOUS: activeKey,
                  ENCRYPTION_KEY_PREVIOUS_VERSION: activeVersion,
                }
              : {}),
          },
        }
      : {}),
  };
}

export function savePersistedGooglePlatformOAuth(
  record: PersistedGooglePlatformOAuth,
  overridePath?: string,
): boolean {
  if (process.env.VERCEL === '1') return false;
  const existing = readPersistedInternalSecrets(overridePath) || {};
  const now = new Date().toISOString();
  const next: PersistedInternalSecrets = {
    ...existing,
    googlePlatformOAuth: record,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
  return writePersistedSecretsAtomic(next, overridePath);
}

export function clearPersistedGooglePlatformOAuth(overridePath?: string): boolean {
  if (process.env.VERCEL === '1') return false;
  const existing = readPersistedInternalSecrets(overridePath);
  if (!existing) return true;
  const next: PersistedInternalSecrets = {
    ...existing,
    updatedAt: new Date().toISOString(),
  };
  delete next.googlePlatformOAuth;
  return writePersistedSecretsAtomic(next, overridePath);
}
