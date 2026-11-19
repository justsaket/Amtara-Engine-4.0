import crypto from 'node:crypto';
import { AppError } from './error-handler';
import { readPersistedInternalSecrets } from './secret-manager';

export interface EncryptedCredentialEnvelope {
  v: string;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  ct: string;
  encryptedAt: string;
}

export interface SecretPayload {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiryDateMs: number;
  scopes: string[];
  accountEmail?: string;
  rotatedAt?: string;
}

export function parseEncryptionKeyMaterial(rawKey: string | undefined): Buffer | null {
  const trimmed = (rawKey || '').trim();
  if (!trimmed) return null;

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  try {
    const b64 = Buffer.from(trimmed, 'base64');
    if (b64.length === 32) {
      return b64;
    }
  } catch {
    // Fall through to passphrase SHA-256 derivation
  }

  if (trimmed.length >= 32) {
    return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
  }

  return null;
}

function getKeyring(override?: {
  currentKey?: string;
  currentVersion?: string;
  previousKey?: string;
  previousVersion?: string;
  secretsFile?: string;
}): {
  currentVersion: string;
  currentKey: Buffer;
  keysByVersion: Map<string, Buffer>;
} {
  const persisted =
    override?.currentKey !== undefined
      ? null
      : readPersistedInternalSecrets(override?.secretsFile);

  const rawCurrentKey =
    override?.currentKey !== undefined
      ? override.currentKey
      : process.env.ENCRYPTION_KEY || persisted?.encryptionKey;

  const currentVersion = (
    override?.currentVersion ||
    process.env.ENCRYPTION_KEY_VERSION ||
    persisted?.encryptionKeyVersion ||
    'v1'
  ).trim();

  const currentKey = parseEncryptionKeyMaterial(rawCurrentKey);
  if (!currentKey) {
    throw new AppError(
      503,
      'ENCRYPTION_KEY_UNCONFIGURED',
      'ENCRYPTION_KEY is not configured. Initialize internal secrets in Settings -> Encryption Status or configure ENCRYPTION_KEY in environment settings.',
    );
  }

  const keysByVersion = new Map<string, Buffer>();
  keysByVersion.set(currentVersion, currentKey);

  // Strictly optional rotation variables — omitted unless actively rotating keys
  const rawPreviousKey =
    override?.previousKey !== undefined
      ? override.previousKey
      : process.env.ENCRYPTION_KEY_PREVIOUS || persisted?.previousEncryptionKey;

  const previousKey = parseEncryptionKeyMaterial(rawPreviousKey);
  if (previousKey) {
    const prevVersion = (
      override?.previousVersion ||
      process.env.ENCRYPTION_KEY_PREVIOUS_VERSION ||
      persisted?.previousEncryptionKeyVersion ||
      'v0'
    ).trim();
    keysByVersion.set(prevVersion, previousKey);
  }

  return { currentVersion, currentKey, keysByVersion };
}

export function encryptCredentialPayload(
  payload: SecretPayload,
  aadContext: string,
  override?: {
    currentKey?: string;
    currentVersion?: string;
    secretsFile?: string;
  },
): { keyVersion: string; encryptedPayload: string } {
  const { currentVersion, currentKey } = getKeyring(override);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', currentKey, iv);
  cipher.setAAD(Buffer.from(aadContext, 'utf8'));

  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const envelope: EncryptedCredentialEnvelope = {
    v: currentVersion,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: authTag.toString('base64'),
    ct: ciphertext.toString('base64'),
    encryptedAt: new Date().toISOString(),
  };

  return {
    keyVersion: currentVersion,
    encryptedPayload: JSON.stringify(envelope),
  };
}

export function decryptCredentialPayload(
  encryptedPayload: string,
  aadContext: string,
  override?: {
    currentKey?: string;
    currentVersion?: string;
    previousKey?: string;
    previousVersion?: string;
    secretsFile?: string;
  },
): { payload: SecretPayload; keyVersion: string; needsReEncryption: boolean } {
  const { currentVersion, keysByVersion } = getKeyring(override);

  let envelope: EncryptedCredentialEnvelope;
  try {
    envelope = JSON.parse(encryptedPayload) as EncryptedCredentialEnvelope;
  } catch {
    throw new AppError(500, 'VAULT_CORRUPTED', 'Encrypted credential envelope is malformed.');
  }

  if (envelope.alg !== 'aes-256-gcm' || !envelope.iv || !envelope.tag || !envelope.ct) {
    throw new AppError(500, 'VAULT_CORRUPTED', 'Unsupported encrypted credential format.');
  }

  const key = keysByVersion.get(envelope.v);
  if (!key) {
    throw new AppError(
      500,
      'ENCRYPTION_KEY_VERSION_MISSING',
      `Decryption key for version "${envelope.v}" is unavailable.`,
    );
  }

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAAD(Buffer.from(aadContext, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.ct, 'base64')),
      decipher.final(),
    ]);
    return {
      payload: JSON.parse(decrypted.toString('utf8')) as SecretPayload,
      keyVersion: envelope.v,
      needsReEncryption: envelope.v !== currentVersion,
    };
  } catch {
    throw new AppError(
      500,
      'VAULT_DECRYPT_FAILED',
      'Failed to decrypt external credential payload. Check ENCRYPTION_KEY and AAD tenant binding.',
    );
  }
}

export function encryptStringWithAad(
  plaintext: string,
  aadContext: string,
  override?: {
    currentKey?: string;
    currentVersion?: string;
    secretsFile?: string;
  },
): { keyVersion: string; encryptedPayload: string } {
  const { currentVersion, currentKey } = getKeyring(override);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', currentKey, iv);
  cipher.setAAD(Buffer.from(aadContext, 'utf8'));

  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const envelope: EncryptedCredentialEnvelope = {
    v: currentVersion,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: authTag.toString('base64'),
    ct: ciphertext.toString('base64'),
    encryptedAt: new Date().toISOString(),
  };

  return {
    keyVersion: currentVersion,
    encryptedPayload: JSON.stringify(envelope),
  };
}

export function decryptStringWithAad(
  encryptedPayload: string,
  aadContext: string,
  override?: {
    currentKey?: string;
    currentVersion?: string;
    previousKey?: string;
    previousVersion?: string;
    secretsFile?: string;
  },
): { plaintext: string; keyVersion: string; needsReEncryption: boolean } {
  const { currentVersion, keysByVersion } = getKeyring(override);

  let envelope: EncryptedCredentialEnvelope;
  try {
    envelope = JSON.parse(encryptedPayload) as EncryptedCredentialEnvelope;
  } catch {
    throw new AppError(500, 'VAULT_CORRUPTED', 'Encrypted secret envelope is malformed.');
  }

  if (envelope.alg !== 'aes-256-gcm' || !envelope.iv || !envelope.tag || !envelope.ct) {
    throw new AppError(500, 'VAULT_CORRUPTED', 'Unsupported encrypted secret format.');
  }

  const key = keysByVersion.get(envelope.v);
  if (!key) {
    throw new AppError(
      500,
      'ENCRYPTION_KEY_VERSION_MISSING',
      `Decryption key for version "${envelope.v}" is unavailable.`,
    );
  }

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAAD(Buffer.from(aadContext, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.ct, 'base64')),
      decipher.final(),
    ]);
    return {
      plaintext: decrypted.toString('utf8'),
      keyVersion: envelope.v,
      needsReEncryption: envelope.v !== currentVersion,
    };
  } catch {
    throw new AppError(
      500,
      'VAULT_DECRYPT_FAILED',
      'Failed to decrypt server secret payload. Check ENCRYPTION_KEY and AAD context.',
    );
  }
}
