import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  GoogleConnectionRecord,
  GoogleOAuthTransactionRecord,
} from '@/types/domain';
import {
  decryptCredentialPayload,
  encryptCredentialPayload,
  type SecretPayload,
} from '@/lib/server/crypto';
import { AppError } from '@/lib/server/error-handler';
import { getFirebaseAdmin } from '@/lib/server/firebase-admin';

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function defaultVaultDir(overrideDir?: string): string {
  return overrideDir || process.env.ANTARA_VAULT_DIR || path.resolve(process.cwd(), '.antara', 'vault');
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJsonFileAtomic(filePath: string, payload: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore chmod failures on restricted filesystems
  }
}

export function buildConnectionAad(workspaceId: string, connectionId: string): string {
  return `workspace:${workspaceId}:connection:${connectionId}`;
}

export interface VaultStorageOptions {
  vaultDirOverride?: string;
  secretsFileOverride?: string;
  disableFirestoreAdmin?: boolean;
}

/**
 * Server-only OAuth transaction storage (`oauthStates`).
 * Uses Firestore Admin SDK when configured, or local 0o600 `.antara/vault/oauth-states/` when Admin SDK is unavailable locally.
 */
export async function saveOAuthTransaction(
  tx: GoogleOAuthTransactionRecord,
  options?: VaultStorageOptions,
): Promise<void> {
  const { db, hasExplicitServiceAccount } = getFirebaseAdmin();
  if (!options?.disableFirestoreAdmin && hasExplicitServiceAccount && db) {
    await db.doc(`oauthStates/${tx.id}`).set(tx);
    return;
  }

  if (process.env.VERCEL === '1') {
    throw new AppError(
      503,
      'VAULT_PERSISTENCE_UNAVAILABLE',
      'Serverless OAuth transaction persistence requires Firebase Admin credentials (FIREBASE_SERVICE_ACCOUNT_JSON).',
    );
  }

  const filePath = path.join(
    defaultVaultDir(options?.vaultDirOverride),
    'oauth-states',
    `${sanitizeId(tx.stateHash)}.json`,
  );
  writeJsonFileAtomic(filePath, tx);
}

export async function consumeOAuthTransactionByStateHash(
  stateHash: string,
  options?: VaultStorageOptions,
): Promise<GoogleOAuthTransactionRecord | null> {
  const { db, hasExplicitServiceAccount } = getFirebaseAdmin();
  if (!options?.disableFirestoreAdmin && hasExplicitServiceAccount && db) {
    const snap = await db
      .collection('oauthStates')
      .where('stateHash', '==', stateHash)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const docSnap = snap.docs[0]!;
    const data = docSnap.data() as GoogleOAuthTransactionRecord;
    return data;
  }

  const filePath = path.join(
    defaultVaultDir(options?.vaultDirOverride),
    'oauth-states',
    `${sanitizeId(stateHash)}.json`,
  );
  return readJsonFile<GoogleOAuthTransactionRecord>(filePath);
}

export async function markOAuthTransactionConsumed(
  tx: GoogleOAuthTransactionRecord,
  consumedAt: string,
  options?: VaultStorageOptions,
): Promise<void> {
  const updated: GoogleOAuthTransactionRecord = {
    ...tx,
    status: 'completed',
    consumedAt,
  };
  const { db, hasExplicitServiceAccount } = getFirebaseAdmin();
  if (!options?.disableFirestoreAdmin && hasExplicitServiceAccount && db) {
    await db.doc(`oauthStates/${tx.id}`).set(updated, { merge: true });
    return;
  }
  const filePath = path.join(
    defaultVaultDir(options?.vaultDirOverride),
    'oauth-states',
    `${sanitizeId(tx.stateHash)}.json`,
  );
  writeJsonFileAtomic(filePath, updated);
}

export async function markOAuthTransactionFailed(
  tx: GoogleOAuthTransactionRecord,
  status: 'denied' | 'expired' | 'failed',
  options?: VaultStorageOptions,
): Promise<void> {
  const updated: GoogleOAuthTransactionRecord = {
    ...tx,
    status,
    consumedAt: new Date().toISOString(),
  };
  const { db, hasExplicitServiceAccount } = getFirebaseAdmin();
  if (!options?.disableFirestoreAdmin && hasExplicitServiceAccount && db) {
    await db.doc(`oauthStates/${tx.id}`).set(updated, { merge: true });
    return;
  }
  const filePath = path.join(
    defaultVaultDir(options?.vaultDirOverride),
    'oauth-states',
    `${sanitizeId(tx.stateHash)}.json`,
  );
  writeJsonFileAtomic(filePath, updated);
}

export interface StoredEncryptedSecretEnvelope {
  id: string;
  workspaceId: string;
  connectionId: string;
  provider: 'google';
  keyVersion: string;
  encryptedPayload: string;
  createdAt: string;
  updatedAt: string;
}

export async function saveEncryptedGoogleTokens(
  workspaceId: string,
  connectionId: string,
  payload: SecretPayload,
  options?: VaultStorageOptions,
): Promise<{ keyVersion: string }> {
  const aad = buildConnectionAad(workspaceId, connectionId);
  const encrypted = encryptCredentialPayload(payload, aad, {
    secretsFile: options?.secretsFileOverride,
  });
  const now = new Date().toISOString();

  const record: StoredEncryptedSecretEnvelope = {
    id: connectionId,
    workspaceId,
    connectionId,
    provider: 'google',
    keyVersion: encrypted.keyVersion,
    encryptedPayload: encrypted.encryptedPayload,
    createdAt: now,
    updatedAt: now,
  };

  const { db, hasExplicitServiceAccount } = getFirebaseAdmin();
  if (!options?.disableFirestoreAdmin && hasExplicitServiceAccount && db) {
    await db
      .doc(`workspaces/${workspaceId}/encryptedCredentials/${connectionId}`)
      .set(record);
    return { keyVersion: encrypted.keyVersion };
  }

  if (process.env.VERCEL === '1') {
    throw new AppError(
      503,
      'VAULT_PERSISTENCE_UNAVAILABLE',
      'Encrypted OAuth token vault requires FIREBASE_SERVICE_ACCOUNT_JSON on Vercel.',
    );
  }

  const filePath = path.join(
    defaultVaultDir(options?.vaultDirOverride),
    'credentials',
    sanitizeId(workspaceId),
    `${sanitizeId(connectionId)}.enc.json`,
  );
  writeJsonFileAtomic(filePath, record);
  return { keyVersion: encrypted.keyVersion };
}

export async function loadDecryptedGoogleTokens(
  workspaceId: string,
  connectionId: string,
  options?: VaultStorageOptions,
): Promise<{ payload: SecretPayload; keyVersion: string; needsReEncryption: boolean } | null> {
  const aad = buildConnectionAad(workspaceId, connectionId);
  const { db, hasExplicitServiceAccount } = getFirebaseAdmin();

  let record: StoredEncryptedSecretEnvelope | null = null;
  if (!options?.disableFirestoreAdmin && hasExplicitServiceAccount && db) {
    const snap = await db
      .doc(`workspaces/${workspaceId}/encryptedCredentials/${connectionId}`)
      .get();
    if (snap.exists) {
      record = snap.data() as StoredEncryptedSecretEnvelope;
    }
  } else {
    const filePath = path.join(
      defaultVaultDir(options?.vaultDirOverride),
      'credentials',
      sanitizeId(workspaceId),
      `${sanitizeId(connectionId)}.enc.json`,
    );
    record = readJsonFile<StoredEncryptedSecretEnvelope>(filePath);
  }

  if (!record?.encryptedPayload) return null;

  return decryptCredentialPayload(record.encryptedPayload, aad, {
    secretsFile: options?.secretsFileOverride,
  });
}

export async function deleteEncryptedGoogleTokens(
  workspaceId: string,
  connectionId: string,
  options?: VaultStorageOptions,
): Promise<void> {
  const { db, hasExplicitServiceAccount } = getFirebaseAdmin();
  if (!options?.disableFirestoreAdmin && hasExplicitServiceAccount && db) {
    await db
      .doc(`workspaces/${workspaceId}/encryptedCredentials/${connectionId}`)
      .delete()
      .catch(() => null);
  }
  const filePath = path.join(
    defaultVaultDir(options?.vaultDirOverride),
    'credentials',
    sanitizeId(workspaceId),
    `${sanitizeId(connectionId)}.enc.json`,
  );
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Local fallback cache of non-secret GoogleConnectionRecord metadata for callback redirects
 * when Admin SDK service account is unavailable (subsequently synced into Firestore once
 * the user's authenticated dashboard session supplies a Firebase ID token).
 */
export function saveLocalConnectionMetadataMirror(
  connection: GoogleConnectionRecord,
  options?: VaultStorageOptions,
): void {
  if (process.env.VERCEL === '1') return;
  const filePath = path.join(
    defaultVaultDir(options?.vaultDirOverride),
    'connections',
    sanitizeId(connection.workspaceId),
    `${sanitizeId(connection.id)}.json`,
  );
  writeJsonFileAtomic(filePath, connection);
}

export function listLocalConnectionMetadataMirrors(
  workspaceId: string,
  options?: VaultStorageOptions,
): GoogleConnectionRecord[] {
  const dir = path.join(
    defaultVaultDir(options?.vaultDirOverride),
    'connections',
    sanitizeId(workspaceId),
  );
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const out: GoogleConnectionRecord[] = [];
  for (const file of entries) {
    const rec = readJsonFile<GoogleConnectionRecord>(path.join(dir, file));
    if (rec && rec.workspaceId === workspaceId) {
      out.push(rec);
    }
  }
  return out;
}

export function deleteLocalConnectionMetadataMirror(
  workspaceId: string,
  connectionId: string,
  options?: VaultStorageOptions,
): void {
  const filePath = path.join(
    defaultVaultDir(options?.vaultDirOverride),
    'connections',
    sanitizeId(workspaceId),
    `${sanitizeId(connectionId)}.json`,
  );
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
