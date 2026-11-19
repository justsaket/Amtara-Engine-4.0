import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  resolveAutonomousConfiguration,
  resolveFirestoreDatabaseId,
} from '@/lib/config/manager';

test('resolveFirestoreDatabaseId defaults to "(default)" when omitted or blank', () => {
  assert.equal(resolveFirestoreDatabaseId(undefined), '(default)');
  assert.equal(resolveFirestoreDatabaseId(null), '(default)');
  assert.equal(resolveFirestoreDatabaseId('   '), '(default)');
  assert.equal(resolveFirestoreDatabaseId('ai-studio-custom'), 'ai-studio-custom');
});

test('resolveAutonomousConfiguration classifies states cleanly without throwing on missing optional providers', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antara-cfg-'));
  const secretsFile = path.join(tempDir, 'internal-secrets.json');

  const prevVars: Record<string, string | undefined> = {
    VERCEL: process.env.VERCEL,
    ENABLE_REAL_GOOGLE_INTEGRATION_TESTS: process.env.ENABLE_REAL_GOOGLE_INTEGRATION_TESTS,
    GOOGLE_INTEGRATION_CLIENT_ID: process.env.GOOGLE_INTEGRATION_CLIENT_ID,
    GOOGLE_INTEGRATION_CLIENT_SECRET: process.env.GOOGLE_INTEGRATION_CLIENT_SECRET,
    META_APP_ID: process.env.META_APP_ID,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  };

  try {
    delete process.env.VERCEL;
    delete process.env.ENABLE_REAL_GOOGLE_INTEGRATION_TESTS;
    delete process.env.GOOGLE_INTEGRATION_CLIENT_ID;
    delete process.env.GOOGLE_INTEGRATION_CLIENT_SECRET;
    delete process.env.META_APP_ID;
    process.env.GEMINI_API_KEY = 'MY_GEMINI_API_KEY';

    const resolved = resolveAutonomousConfiguration({
      autoGenerateLocalSecrets: true,
      secretsFileOverride: secretsFile,
    });

    assert.equal(resolved.enableRealGoogleIntegrationTests, false);
    assert.equal(resolved.snapshot.capabilities.realGoogleTestsEnabled, false);
    assert.equal(resolved.snapshot.environment.defaultTimezone, 'Asia/Kolkata');

    // Placeholder Gemini key is never mistakenly reported as live
    assert.equal(resolved.snapshot.capabilities.geminiConfigured, false);

    // Every item uses one of the 7 canonical classifications
    const validClasses = new Set([
      'automatically_configured',
      'already_available',
      'generated_internally',
      'connected_via_oauth',
      'requires_external_authorization',
      'optional_unused',
      'disabled',
    ]);
    for (const item of resolved.snapshot.items) {
      assert.ok(validClasses.has(item.classification), `Unexpected classification: ${item.classification}`);
    }

    const googleItem = resolved.snapshot.items.find((i) => i.id === 'google_workspace_oauth');
    const metaItem = resolved.snapshot.items.find((i) => i.id === 'meta_social');
    const liveTestsItem = resolved.snapshot.items.find((i) => i.id === 'live_google_tests');

    assert.equal(googleItem?.classification, 'optional_unused');
    assert.equal(metaItem?.classification, 'optional_unused');
    assert.equal(liveTestsItem?.classification, 'disabled');

    // Ensure snapshot never leaks raw sessionSecret or encryption keys
    const serialized = JSON.stringify(resolved.snapshot);
    assert.ok(!serialized.includes(resolved.sessionSecret));
  } finally {
    for (const [k, v] of Object.entries(prevVars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resolveAutonomousConfiguration flags project conflicts between client and service-account configs', () => {
  const prevSA = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const prevPid = process.env.FIREBASE_PROJECT_ID;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antara-conflict-'));
  const secretsFile = path.join(tempDir, 'internal-secrets.json');

  try {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: 'completely-different-firebase-project',
    });
    const resolved = resolveAutonomousConfiguration({
      autoGenerateLocalSecrets: true,
      secretsFileOverride: secretsFile,
    });

    if (resolved.snapshot.firebase.clientConfigured) {
      assert.equal(resolved.snapshot.firebase.projectConflict, true);
      assert.ok(resolved.snapshot.firebase.projectConflictDetail?.includes('completely-different-firebase-project'));
    }
  } finally {
    if (prevSA === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = prevSA;
    if (prevPid === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = prevPid;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
