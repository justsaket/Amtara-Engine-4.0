import assert from 'node:assert/strict';
import test from 'node:test';
import { computeProjectContentHash, computeProjectDiff } from '../src/lib/google/diff';
import {
  buildDefaultManifest,
  inferImpliedScopesFromSource,
  parseAndValidateManifest,
  serializeManifest,
} from '../src/lib/google/manifest';
import {
  GOOGLE_SCOPE,
  evaluateCapabilities,
  normalizeGrantedScopeList,
  resolveScopesForCapabilities,
} from '../src/lib/google/permissions';
import { APPS_SCRIPT_TEMPLATES, getAppsScriptTemplate } from '../src/lib/google/templates';
import { validateAppsScriptProject } from '../src/lib/google/validator';
import type { GoogleConnectionRecord } from '../src/types/domain';

test('capability evaluation handles unconfigured, disconnected, missing scopes, and Apps Script user toggle cleanly', () => {
  const unconfigured = evaluateCapabilities({
    platformOAuthConfigured: false,
    connection: null,
  });
  assert.ok(unconfigured.every((c) => c.availability === 'APP_CONFIG_REQUIRED'));

  const noConn = evaluateCapabilities({
    platformOAuthConfigured: true,
    connection: null,
  });
  assert.ok(noConn.every((c) => c.availability === 'USER_AUTHORIZATION_REQUIRED'));

  const partialConn: GoogleConnectionRecord = {
    id: 'gconn_1',
    workspaceId: 'ws_1',
    userId: 'uid_1',
    userEmail: 'owner@antara.local',
    googleAccountId: 'sub_1',
    googleEmail: 'owner@gmail.com',
    status: 'connected',
    grantedScopes: [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      GOOGLE_SCOPE.SCRIPT_PROJECTS,
    ],
    encryptedCredentialId: 'gconn_1',
    accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    hasRefreshToken: true,
    sharedWithWorkspace: false,
    consentSeparatedFromLogin: true,
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const partialEval = evaluateCapabilities({
    platformOAuthConfigured: true,
    connection: partialConn,
    appsScriptApiToggleConfirmed: true,
  });

  const byId = new Map(partialEval.map((c) => [c.id, c]));
  assert.equal(byId.get('google_identity')?.availability, 'AVAILABLE');
  assert.equal(byId.get('apps_script_projects')?.availability, 'AVAILABLE');
  assert.equal(byId.get('apps_script_deployments')?.availability, 'PERMISSION_REQUIRED');
  assert.equal(byId.get('drive_discovery')?.availability, 'PERMISSION_REQUIRED');

  // Even when scopes exist, if user toggle at script.google.com/home/usersettings is OFF, report USER_AUTHORIZATION_REQUIRED
  const toggleOff = evaluateCapabilities({
    platformOAuthConfigured: true,
    connection: partialConn,
    appsScriptApiToggleConfirmed: false,
  });
  const projCap = toggleOff.find((c) => c.id === 'apps_script_projects');
  assert.equal(projCap?.availability, 'USER_AUTHORIZATION_REQUIRED');
  assert.ok(projCap?.reason.includes('https://script.google.com/home/usersettings'));
});

test('scope resolver and normalizer include identity scopes and deduplicate cleanly', () => {
  const scopes = resolveScopesForCapabilities(
    ['apps_script_projects', 'drive_discovery'],
    ['https://www.googleapis.com/auth/spreadsheets.readonly', 'invalid-scope'],
  );
  assert.ok(scopes.includes('openid'));
  assert.ok(scopes.includes(GOOGLE_SCOPE.SCRIPT_PROJECTS));
  assert.ok(scopes.includes(GOOGLE_SCOPE.DRIVE_METADATA_READONLY));
  assert.ok(scopes.includes('https://www.googleapis.com/auth/spreadsheets.readonly'));
  assert.ok(!scopes.includes('invalid-scope'));

  const norm = normalizeGrantedScopeList(
    'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
  );
  assert.ok(norm.includes('email'));
  assert.ok(norm.includes('profile'));
});

test('manifest builder defaults to Asia/Kolkata, V8, STACKDRIVER, MYSELF and flags public access', () => {
  const def = buildDefaultManifest({ includeWebApp: true });
  assert.equal(def.timeZone, 'Asia/Kolkata');
  assert.equal(def.runtimeVersion, 'V8');
  assert.equal(def.exceptionLogging, 'STACKDRIVER');
  assert.equal(def.webapp?.access, 'MYSELF');
  assert.equal(def.webapp?.executeAs, 'USER_DEPLOYING');

  const parsedOk = parseAndValidateManifest(serializeManifest(def));
  assert.equal(parsedOk.valid, true);
  assert.equal(parsedOk.publicAccessWarning, false);

  const publicManifest = serializeManifest({
    ...def,
    webapp: { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_DEPLOYING' },
  });
  const parsedPub = parseAndValidateManifest(publicManifest);
  assert.equal(parsedPub.valid, true);
  assert.equal(parsedPub.publicAccessWarning, true);

  const badJson = parseAndValidateManifest('{ invalid json');
  assert.equal(badJson.valid, false);
});

test('static validator flags eval(), duplicate global functions, missing HTML templates, and undeclared implied scopes', () => {
  const manifest = serializeManifest(
    buildDefaultManifest({
      oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'],
    }),
  );

  const report = validateAppsScriptProject({
    scriptId: 'script_1234567890',
    files: [
      { name: 'appsscript', type: 'JSON', source: manifest },
      {
        name: 'Code',
        type: 'SERVER_JS',
        source: `
function doGet() {
  return HtmlService.createHtmlOutputFromFile('MissingPage');
}
function runTask() {
  UrlFetchApp.fetch('https://example.com');
  return eval('1+1');
}
`,
      },
      {
        name: 'Utils',
        type: 'SERVER_JS',
        source: `
function runTask() {
  DriveApp.getRootFolder().setTrashed(true);
}
`,
      },
    ],
  });

  assert.equal(report.valid, false);
  assert.equal(report.hasHighRiskPatterns, true);
  const codes = new Set(report.diagnostics.map((d) => d.code));
  assert.ok(codes.has('MISSING_HTML_TEMPLATE'));
  assert.ok(codes.has('UNSAFE_DYNAMIC_EVAL'));
  assert.ok(codes.has('DUPLICATE_FUNCTION_NAME'));
  assert.ok(codes.has('DESTRUCTIVE_WRITE_OPERATION'));
  assert.ok(codes.has('UNDECLARED_IMPLIED_SCOPE'));
  assert.ok(report.impliedScopes.includes('https://www.googleapis.com/auth/script.external_request'));

  const inferred = inferImpliedScopesFromSource([
    { type: 'SERVER_JS', source: 'GmailApp.sendEmail("a@b.com", "hi", "body");' },
  ]);
  assert.ok(inferred.includes('https://www.googleapis.com/auth/gmail.send'));
});

test('all 8 starter templates build valid Apps Script projects and manifest configs', () => {
  assert.equal(APPS_SCRIPT_TEMPLATES.length, 8);
  for (const tpl of APPS_SCRIPT_TEMPLATES) {
    const resolved = getAppsScriptTemplate(tpl.key);
    assert.ok(resolved);
    assert.equal(resolved.key, tpl.key);
    const files = tpl.buildFiles('Asia/Kolkata');
    const report = validateAppsScriptProject({
      scriptId: `tpl_${tpl.key}_12345`,
      files,
    });
    assert.equal(report.valid, true, `Template ${tpl.key} failed validation`);
  }
});

test('diff and content hash accurately classify added, modified, and deleted files', () => {
  const before = [
    { name: 'appsscript', type: 'JSON' as const, source: '{}' },
    { name: 'Code', type: 'SERVER_JS' as const, source: 'function a() {}' },
    { name: 'OldHelper', type: 'SERVER_JS' as const, source: 'function oldFn() {}' },
  ];
  const after = [
    { name: 'appsscript', type: 'JSON' as const, source: '{}' },
    { name: 'Code', type: 'SERVER_JS' as const, source: 'function a() { return 1; }' },
    { name: 'NewHelper', type: 'SERVER_JS' as const, source: 'function newFn() {}' },
  ];

  const diff = computeProjectDiff(before, after);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.hasDeletions, true);
  assert.deepEqual(diff.deletedFileNames, ['OldHelper']);
  assert.notEqual(
    computeProjectContentHash(before),
    computeProjectContentHash(after),
  );
});
