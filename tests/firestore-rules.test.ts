import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const rootDir = process.cwd();

test('DRAFT_firestore.rules and firestore.rules stay strictly synchronized and enforce Phase 1 security invariants', () => {
  const draft = fs.readFileSync(path.join(rootDir, 'DRAFT_firestore.rules'), 'utf8');
  const deployed = fs.readFileSync(path.join(rootDir, 'firestore.rules'), 'utf8');

  assert.equal(draft, deployed, 'DRAFT_firestore.rules and firestore.rules must be identical.');

  // Default deny safety net
  assert.ok(deployed.includes('match /{document=**}'));
  assert.ok(deployed.includes('allow read, write: if false;'));

  // Encrypted credentials and OAuth CSRF states strictly locked server-only
  assert.match(
    deployed,
    /match \/encryptedCredentials\/\{credentialId\}\s*\{\s*allow read, write: if false;/,
  );
  assert.match(
    deployed,
    /match \/oauthStates\/\{stateId\}\s*\{\s*allow read, write: if false;/,
  );

  // Audit logs immutable
  assert.match(deployed, /allow update, delete: if false;/);

  // Separation of login vs external OAuth enforced at schema rule layer
  assert.ok(deployed.includes('incoming().consentSeparatedFromLogin == true'));
});

test('firebase-blueprint.json aligns with Phase 1 collections and future placeholders', () => {
  const blueprint = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'firebase-blueprint.json'), 'utf8'),
  ) as { firestore?: Record<string, unknown> };

  const paths = Object.keys(blueprint.firestore || {});
  assert.ok(paths.includes('/users/{userId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/brands/{brandId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/integrations/{integrationId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/encryptedCredentials/{credentialId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/settings/{settingId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/auditLogs/{logId}'));
  // Phase 2 Apps Script Control Plane
  assert.ok(paths.includes('/workspaces/{workspaceId}/appsScriptProjects/{projectRecordId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/appsScriptDeployments/{deploymentId}'));
  // Phase 3 Intelligence Engine Collections
  assert.ok(paths.includes('/workspaces/{workspaceId}/aiRuns/{runId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/agentTasks/{taskId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/agentConfigs/{agentId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/brandKnowledge/{factId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/brandMemory/{memoryId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/researchSources/{sourceId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/researchClaims/{claimId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/strategyRecords/{strategyId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/contentDrafts/{draftId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/playbookRuns/{playbookRunId}'));
  assert.ok(paths.includes('/workspaces/{workspaceId}/aiUsageLedger/{ledgerId}'));

  const deployed = fs.readFileSync(path.join(rootDir, 'firestore.rules'), 'utf8');
  for (const col of [
    'aiRuns',
    'agentTasks',
    'agentConfigs',
    'brandKnowledge',
    'brandMemory',
    'researchSources',
    'researchClaims',
    'strategyRecords',
    'contentDrafts',
    'playbookRuns',
    'aiUsageLedger',
  ]) {
    assert.ok(deployed.includes(`/${col}/`), `Expected firestore.rules to cover ${col}`);
  }
});
