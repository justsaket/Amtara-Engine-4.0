import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  decryptCredentialPayload,
  encryptCredentialPayload,
  parseEncryptionKeyMaterial,
} from '@/lib/server/crypto';
import {
  ensureInternalSecrets,
  generateSecureSecretHex,
  readPersistedInternalSecrets,
  rotateInternalEncryptionKey,
} from '@/lib/server/secret-manager';

test('generateSecureSecretHex creates unique CSPRNG 64-char hex tokens', () => {
  const a = generateSecureSecretHex(32);
  const b = generateSecureSecretHex(32);
  assert.equal(a.length, 64);
  assert.equal(b.length, 64);
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('ensureInternalSecrets persists stable secrets without regenerating across calls', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antara-sec-'));
  const secretsFile = path.join(tempDir, 'internal-secrets.json');

  const prevEnv = {
    VERCEL: process.env.VERCEL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    INTERNAL_SIGNING_SECRET: process.env.INTERNAL_SIGNING_SECRET,
  };

  try {
    delete process.env.VERCEL;
    delete process.env.SESSION_SECRET;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.INTERNAL_SIGNING_SECRET;

    const first = ensureInternalSecrets({ overridePath: secretsFile, autoPersistLocal: true });
    assert.equal(first.persistedLocally, true);
    assert.equal(first.sessionSecretReady, true);
    assert.equal(first.encryptionKeyReady, true);
    assert.equal(first.encryptionKeyVersion, 'v1');

    const storedAfterFirst = readPersistedInternalSecrets(secretsFile);
    assert.ok(storedAfterFirst?.sessionSecret);
    assert.ok(storedAfterFirst?.encryptionKey);

    const second = ensureInternalSecrets({ overridePath: secretsFile, autoPersistLocal: true });
    assert.equal(second.persistedLocally, false);
    const storedAfterSecond = readPersistedInternalSecrets(secretsFile);
    assert.equal(storedAfterSecond?.sessionSecret, storedAfterFirst?.sessionSecret);
    assert.equal(storedAfterSecond?.encryptionKey, storedAfterFirst?.encryptionKey);
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('AES-256-GCM encrypt/decrypt enforces tenant AAD binding and supports zero-downtime key rotation', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antara-crypto-'));
  const secretsFile = path.join(tempDir, 'internal-secrets.json');

  const prevEnv = {
    VERCEL: process.env.VERCEL,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    ENCRYPTION_KEY_VERSION: process.env.ENCRYPTION_KEY_VERSION,
    ENCRYPTION_KEY_PREVIOUS: process.env.ENCRYPTION_KEY_PREVIOUS,
  };

  try {
    delete process.env.VERCEL;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_VERSION;
    delete process.env.ENCRYPTION_KEY_PREVIOUS;

    ensureInternalSecrets({ overridePath: secretsFile, autoPersistLocal: true });

    const aadWsA = 'ws_alpha:google_workspace:google';
    const aadWsB = 'ws_beta:google_workspace:google';
    const payload = {
      accessToken: 'ya29.sample-access-token',
      refreshToken: '1//sample-refresh-token',
      tokenType: 'Bearer',
      expiryDateMs: Date.now() + 3600_000,
      scopes: ['openid', 'email'],
      accountEmail: 'ops@example.com',
    };

    const encrypted = encryptCredentialPayload(payload, aadWsA, { secretsFile });
    assert.equal(encrypted.keyVersion, 'v1');
    assert.ok(!encrypted.encryptedPayload.includes('ya29.sample-access-token'));

    // Decrypt inside rightful workspace
    const decrypted = decryptCredentialPayload(encrypted.encryptedPayload, aadWsA, {
      secretsFile,
    });
    assert.equal(decrypted.payload.accessToken, payload.accessToken);
    assert.equal(decrypted.needsReEncryption, false);

    // Cross-tenant ciphertext transplant must fail AAD tag verification
    assert.throws(
      () => decryptCredentialPayload(encrypted.encryptedPayload, aadWsB, { secretsFile }),
      (err: unknown) =>
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === 'VAULT_DECRYPT_FAILED',
    );

    // Rotate key to v2 while preserving v1 decryption capability
    const rotated = rotateInternalEncryptionKey({ overridePath: secretsFile });
    assert.equal(rotated.rotationPerformed, true);
    assert.equal(rotated.encryptionKeyVersion, 'v2');
    assert.equal(rotated.previousKeyVersion, 'v1');

    const postRotationDecrypt = decryptCredentialPayload(encrypted.encryptedPayload, aadWsA, {
      secretsFile,
    });
    assert.equal(postRotationDecrypt.payload.refreshToken, payload.refreshToken);
    assert.equal(postRotationDecrypt.keyVersion, 'v1');
    assert.equal(postRotationDecrypt.needsReEncryption, true);

    assert.ok(parseEncryptionKeyMaterial(generateSecureSecretHex(32)) !== null);
    assert.equal(parseEncryptionKeyMaterial('too-short'), null);
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
