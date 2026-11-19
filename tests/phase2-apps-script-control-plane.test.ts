import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildDefaultManifest,
  serializeManifest,
} from '../src/lib/google/manifest';
import { GOOGLE_SCOPE } from '../src/lib/google/permissions';
import {
  createOrImportWorkspaceAppsScriptProject,
  createWorkspaceProjectDeployment,
  createWorkspaceProjectVersionRelease,
  discoverWorkspaceDriveAppsScripts,
  executeAllowlistedScriptFunction,
  installOrSyncScriptTrigger,
  registerApprovedExecutionTarget,
  removeScriptTrigger,
  restoreWorkspaceProjectSnapshot,
  runWorkspaceGoogleDoctor,
  updateWorkspaceDeploymentVersion,
  updateWorkspaceProjectContentProtected,
  type Phase2ExecutionContext,
} from '../src/lib/server/phase2-repositories';
import { saveEncryptedGoogleTokens, type VaultStorageOptions } from '../src/lib/server/google-vault';
import { createDevelopmentTestStore } from '../src/lib/server/repositories';
import { ensureInternalSecrets } from '../src/lib/server/secret-manager';
import type { AppsScriptFile, GoogleConnectionRecord } from '../src/types/domain';

class MockGoogleServer {
  public projects = new Map<
    string,
    {
      title: string;
      parentId?: string;
      files: AppsScriptFile[];
      versions: Array<{ versionNumber: number; description: string; createTime: string }>;
      deployments: Array<{
        deploymentId: string;
        versionNumber: number;
        description: string;
        type: 'WEB_APP' | 'API_EXECUTABLE';
        accessLevel?: string;
        executeAs?: string;
      }>;
      installedTriggers: Array<{ id: string; handler: string }>;
      cloudProjectMismatch?: boolean;
      userToggleDisabled?: boolean;
      missingDriveScope?: boolean;
    }
  >();

  public counter = 0;

  constructor() {
    this.projects.set('existing_script_abc123', {
      title: 'Existing Marketing Sync',
      files: [
        {
          name: 'appsscript',
          type: 'JSON',
          source: serializeManifest(
            buildDefaultManifest({
              includeExecutionApi: true,
              oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'],
            }),
          ),
        },
        {
          name: 'Code',
          type: 'SERVER_JS',
          source: 'function runSync(arg) { return { synced: true, arg: arg || null }; }',
        },
        {
          name: 'LegacyHelper',
          type: 'SERVER_JS',
          source: 'function legacyPing() { return "pong"; }',
        },
      ],
      versions: [],
      deployments: [],
      installedTriggers: [{ id: 'unrelated_trig_99', handler: 'userCustomHandler' }],
    });
  }

  public fetch: typeof fetch = async (input, init) => {
    const urlStr = String(input);
    const url = new URL(urlStr);
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/tokeninfo') {
      return new Response(
        JSON.stringify({
          scope: `${GOOGLE_SCOPE.OPENID} ${GOOGLE_SCOPE.EMAIL} ${GOOGLE_SCOPE.SCRIPT_PROJECTS} ${GOOGLE_SCOPE.SCRIPT_DEPLOYMENTS} ${GOOGLE_SCOPE.DRIVE_METADATA_READONLY}`,
          expires_in: 3500,
          email: 'owner@antara.in',
        }),
        { status: 200 },
      );
    }

    if (url.hostname === 'www.googleapis.com' && url.pathname === '/drive/v3/files') {
      const q = url.searchParams.get('q') || '';
      const pageToken = url.searchParams.get('pageToken');
      const allFiles = Array.from(this.projects.entries()).map(([id, p]) => ({
        id,
        name: p.title,
        mimeType: 'application/vnd.google-apps.script',
        modifiedTime: new Date().toISOString(),
        owners: [{ displayName: 'Owner', emailAddress: 'owner@antara.in' }],
        webViewLink: `https://script.google.com/d/${id}/edit`,
        capabilities: { canEdit: true },
      }));

      const filtered = q.includes("name contains 'Marketing'")
        ? allFiles.filter((f) => f.name.includes('Marketing'))
        : allFiles;

      if (!pageToken && url.searchParams.get('pageSize') === '1' && filtered.length > 1) {
        return new Response(
          JSON.stringify({ files: [filtered[0]], nextPageToken: 'page_2' }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          files: pageToken === 'page_2' ? filtered.slice(1) : filtered,
        }),
        { status: 200 },
      );
    }

    if (url.hostname === 'script.googleapis.com') {
      if (url.pathname === '/v1/processes') {
        return new Response(JSON.stringify({ processes: [] }), { status: 200 });
      }

      if (url.pathname === '/v1/projects' && method === 'POST') {
        this.counter += 1;
        const scriptId = `created_script_${this.counter}_${Date.now()}`;
        this.projects.set(scriptId, {
          title: body.title,
          parentId: body.parentId,
          files: [
            {
              name: 'appsscript',
              type: 'JSON',
              source: serializeManifest(buildDefaultManifest()),
            },
            {
              name: 'Code',
              type: 'SERVER_JS',
              source: 'function myFunction() {}',
            },
          ],
          versions: [],
          deployments: [],
          installedTriggers: [],
        });
        return new Response(
          JSON.stringify({ scriptId, title: body.title, parentId: body.parentId }),
          { status: 200 },
        );
      }

      const contentMatch = /^\/v1\/projects\/([^/]+)\/content$/.exec(url.pathname);
      if (contentMatch) {
        const scriptId = decodeURIComponent(contentMatch[1]!);
        const proj = this.projects.get(scriptId);
        if (!proj) {
          return new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 });
        }
        if (proj.userToggleDisabled) {
          return new Response(
            JSON.stringify({
              error: {
                message:
                  'User has not enabled the Apps Script API. Enable it in https://script.google.com/home/usersettings',
              },
            }),
            { status: 403 },
          );
        }
        if (method === 'GET') {
          return new Response(JSON.stringify({ scriptId, files: proj.files }), { status: 200 });
        }
        if (method === 'PUT') {
          proj.files = body.files;
          return new Response(JSON.stringify({ scriptId, files: proj.files }), { status: 200 });
        }
      }

      const projMatch = /^\/v1\/projects\/([^/]+)$/.exec(url.pathname);
      if (projMatch && method === 'GET') {
        const scriptId = decodeURIComponent(projMatch[1]!);
        const proj = this.projects.get(scriptId);
        if (!proj) return new Response('{}', { status: 404 });
        return new Response(
          JSON.stringify({ scriptId, title: proj.title, parentId: proj.parentId }),
          { status: 200 },
        );
      }

      const verMatch = /^\/v1\/projects\/([^/]+)\/versions$/.exec(url.pathname);
      if (verMatch) {
        const scriptId = decodeURIComponent(verMatch[1]!);
        const proj = this.projects.get(scriptId);
        if (!proj) return new Response('{}', { status: 404 });
        if (method === 'POST') {
          const nextNum = proj.versions.length + 1;
          const ver = {
            scriptId,
            versionNumber: nextNum,
            description: body.description || `v${nextNum}`,
            createTime: new Date().toISOString(),
          };
          proj.versions.push(ver);
          return new Response(JSON.stringify(ver), { status: 200 });
        }
        return new Response(JSON.stringify({ versions: proj.versions }), { status: 200 });
      }

      const depListMatch = /^\/v1\/projects\/([^/]+)\/deployments$/.exec(url.pathname);
      if (depListMatch) {
        const scriptId = decodeURIComponent(depListMatch[1]!);
        const proj = this.projects.get(scriptId);
        if (!proj) return new Response('{}', { status: 404 });
        if (method === 'POST') {
          this.counter += 1;
          const depId = `AKfycb_dep_${this.counter}`;
          const manifestFile = proj.files.find((f) => f.name === 'appsscript');
          const parsedMan = manifestFile ? JSON.parse(manifestFile.source) : {};
          const type: 'WEB_APP' | 'API_EXECUTABLE' = parsedMan.executionApi && !parsedMan.webapp
            ? 'API_EXECUTABLE'
            : parsedMan.webapp
              ? 'WEB_APP'
              : 'API_EXECUTABLE';

          const item = {
            deploymentId: depId,
            versionNumber: body.versionNumber,
            description: body.description,
            type,
            accessLevel: parsedMan.webapp?.access || parsedMan.executionApi?.access || 'MYSELF',
            executeAs: parsedMan.webapp?.executeAs || 'USER_DEPLOYING',
          };
          proj.deployments.push(item);
          return new Response(JSON.stringify(toGoogleDepResponse(scriptId, item)), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            deployments: proj.deployments.map((d) => toGoogleDepResponse(scriptId, d)),
          }),
          { status: 200 },
        );
      }

      const depItemMatch = /^\/v1\/projects\/([^/]+)\/deployments\/([^/]+)$/.exec(url.pathname);
      if (depItemMatch) {
        const scriptId = decodeURIComponent(depItemMatch[1]!);
        const depId = decodeURIComponent(depItemMatch[2]!);
        const proj = this.projects.get(scriptId);
        if (!proj) return new Response('{}', { status: 404 });
        const dep = proj.deployments.find((d) => d.deploymentId === depId);
        if (!dep) return new Response('{}', { status: 404 });
        if (method === 'PUT') {
          dep.versionNumber = body.deploymentConfig.versionNumber;
          dep.description = body.deploymentConfig.description;
          return new Response(JSON.stringify(toGoogleDepResponse(scriptId, dep)), { status: 200 });
        }
        if (method === 'DELETE') {
          proj.deployments = proj.deployments.filter((d) => d.deploymentId !== depId);
          return new Response('{}', { status: 200 });
        }
      }

      const runMatch = /^\/v1\/scripts\/([^/]+):run$/.exec(url.pathname);
      if (runMatch && method === 'POST') {
        const depId = decodeURIComponent(runMatch[1]!);
        for (const [, proj] of this.projects.entries()) {
          const dep = proj.deployments.find((d) => d.deploymentId === depId);
          if (dep) {
            if (proj.cloudProjectMismatch) {
              return new Response(
                JSON.stringify({ error: { message: 'Requested entity was not found.' } }),
                { status: 404 },
              );
            }
            if (body.function === 'antaraInstallOrSyncTrigger') {
              const cfg = body.parameters?.[0] || {};
              proj.installedTriggers = [
                ...proj.installedTriggers.filter((t) => t.handler !== cfg.handler),
                { id: `g_trig_${cfg.handler}`, handler: cfg.handler },
              ];
              return new Response(
                JSON.stringify({
                  done: true,
                  response: {
                    result: {
                      installed: true,
                      googleTriggerId: `g_trig_${cfg.handler}`,
                      preservedUnrelatedTriggers: 1,
                    },
                  },
                }),
                { status: 200 },
              );
            }
            if (body.function === 'antaraRemoveTrigger') {
              const cfg = body.parameters?.[0] || {};
              proj.installedTriggers = proj.installedTriggers.filter(
                (t) => t.handler !== cfg.handler,
              );
              return new Response(
                JSON.stringify({ done: true, response: { result: { removed: 1 } } }),
                { status: 200 },
              );
            }
            return new Response(
              JSON.stringify({
                done: true,
                response: {
                  result: {
                    executedFunction: body.function,
                    echoParams: body.parameters,
                  },
                },
              }),
              { status: 200 },
            );
          }
        }
        return new Response(
          JSON.stringify({ error: { message: 'Requested entity was not found.' } }),
          { status: 404 },
        );
      }
    }

    return new Response('{}', { status: 404 });
  };
}

function toGoogleDepResponse(
  scriptId: string,
  dep: {
    deploymentId: string;
    versionNumber: number;
    description: string;
    type: 'WEB_APP' | 'API_EXECUTABLE';
    accessLevel?: string;
    executeAs?: string;
  },
) {
  return {
    deploymentId: dep.deploymentId,
    deploymentConfig: {
      scriptId,
      versionNumber: dep.versionNumber,
      manifestFileName: 'appsscript',
      description: dep.description,
    },
    updateTime: new Date().toISOString(),
    entryPoints:
      dep.type === 'WEB_APP'
        ? [
            {
              entryPointType: 'WEB_APP',
              webApp: {
                url: `https://script.google.com/macros/s/${dep.deploymentId}/exec`,
                entryPointConfig: {
                  access: dep.accessLevel || 'MYSELF',
                  executeAs: dep.executeAs || 'USER_DEPLOYING',
                },
              },
            },
          ]
        : [
            {
              entryPointType: 'EXECUTION_API',
              executionApi: {
                entryPointConfig: { access: dep.accessLevel || 'MYSELF' },
              },
            },
          ],
  };
}

async function setupWorkspaceFixture(mockGoogle: MockGoogleServer) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antara-phase2-ctrl-'));
  const secretsFile = path.join(root, 'internal-secrets.json');
  const vaultDir = path.join(root, 'vault');
  ensureInternalSecrets({ overridePath: secretsFile, autoPersistLocal: true });

  const vaultOptions: VaultStorageOptions = {
    vaultDirOverride: vaultDir,
    secretsFileOverride: secretsFile,
    disableFirestoreAdmin: true,
  };

  const store = createDevelopmentTestStore();
  const wsId = 'ws_phase2_1';
  const ownerUid = 'uid_owner_1';
  const now = new Date().toISOString();

  await store.commit([
    {
      path: `workspaces/${wsId}`,
      data: {
        id: wsId,
        name: 'Antara Ops Workspace',
        slug: 'antara-ops',
        ownerId: ownerUid,
        timezone: 'Asia/Kolkata',
        planTier: 'foundation',
        createdAt: now,
        updatedAt: now,
      },
    },
    {
      path: `workspaces/${wsId}/members/${ownerUid}`,
      data: {
        uid: ownerUid,
        workspaceId: wsId,
        email: 'owner@antara.in',
        displayName: 'Owner',
        role: 'owner',
        status: 'active',
        invitedBy: ownerUid,
        joinedAt: now,
        updatedAt: now,
      },
    },
  ]);

  const connId = 'gconn_owner_1';
  const grantedScopes = [
    GOOGLE_SCOPE.OPENID,
    GOOGLE_SCOPE.EMAIL,
    GOOGLE_SCOPE.PROFILE,
    GOOGLE_SCOPE.SCRIPT_PROJECTS,
    GOOGLE_SCOPE.SCRIPT_DEPLOYMENTS,
    GOOGLE_SCOPE.DRIVE_METADATA_READONLY,
    GOOGLE_SCOPE.SCRIPT_PROCESSES,
    'https://www.googleapis.com/auth/spreadsheets',
  ];

  await saveEncryptedGoogleTokens(
    wsId,
    connId,
    {
      accessToken: 'ya29.valid_mock_token',
      refreshToken: '1//valid_refresh',
      tokenType: 'Bearer',
      expiryDateMs: Date.now() + 3600_000,
      scopes: grantedScopes,
      accountEmail: 'owner@antara.in',
    },
    vaultOptions,
  );

  const conn: GoogleConnectionRecord = {
    id: connId,
    workspaceId: wsId,
    userId: ownerUid,
    userEmail: 'owner@antara.in',
    googleAccountId: 'sub_owner_1',
    googleEmail: 'owner@antara.in',
    status: 'connected',
    grantedScopes,
    encryptedCredentialId: connId,
    accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    hasRefreshToken: true,
    sharedWithWorkspace: true,
    consentSeparatedFromLogin: true,
    connectedAt: now,
    updatedAt: now,
  };

  await store.commit([
    {
      path: `workspaces/${wsId}/googleConnections/${connId}`,
      data: { ...conn },
    },
  ]);

  const ctx: Phase2ExecutionContext = {
    store,
    fetchImpl: mockGoogle.fetch,
    vaultOptions,
  };

  return {
    wsId,
    ownerUid,
    ctx,
    store,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test('Phase 2 End-to-End Control Plane: Drive discovery, idempotent project create, protected update/restore, version/deploy/rollback, allowlisted run, triggers, and Doctor', async () => {
  const mockGoogle = new MockGoogleServer();
  const fixture = await setupWorkspaceFixture(mockGoogle);

  try {
    // 1. Drive Discovery filtering & search
    const allDisc = await discoverWorkspaceDriveAppsScripts(
      fixture.ownerUid,
      fixture.wsId,
      {},
      fixture.ctx,
    );
    assert.equal(allDisc.files.length, 1);
    assert.equal(allDisc.files[0]!.id, 'existing_script_abc123');

    // 2. Idempotent project creation with template
    const created1 = await createOrImportWorkspaceAppsScriptProject(
      fixture.ownerUid,
      'owner@antara.in',
      fixture.wsId,
      {
        mode: 'create',
        title: 'Antara Automation Starter',
        templateKey: 'antara_api_executable_starter',
        idempotencyKey: 'idem_create_1',
      },
      fixture.ctx,
    );
    assert.ok(created1.project.scriptId.startsWith('created_script_'));

    const createdReplay = await createOrImportWorkspaceAppsScriptProject(
      fixture.ownerUid,
      'owner@antara.in',
      fixture.wsId,
      {
        mode: 'create',
        title: 'Antara Automation Starter',
        templateKey: 'antara_api_executable_starter',
        idempotencyKey: 'idem_create_1',
      },
      fixture.ctx,
    );
    assert.equal(createdReplay.idempotentReplay, true);
    assert.equal(createdReplay.project.scriptId, created1.project.scriptId);

    // 3. Import existing project & test 10-step protected update (deletion guard + backup snapshot + restore)
    const imported = await createOrImportWorkspaceAppsScriptProject(
      fixture.ownerUid,
      'owner@antara.in',
      fixture.wsId,
      {
        mode: 'import',
        scriptId: 'existing_script_abc123',
      },
      fixture.ctx,
    );
    assert.equal(imported.project.scriptId, 'existing_script_abc123');

    // Removing LegacyHelper without confirmFileDeletions MUST reject BEFORE remote push
    const filesWithoutHelper = imported.files.filter((f) => f.name !== 'LegacyHelper');
    await assert.rejects(
      () =>
        updateWorkspaceProjectContentProtected(
          fixture.ownerUid,
          'owner@antara.in',
          fixture.wsId,
          'existing_script_abc123',
          {
            files: filesWithoutHelper,
            changeSummary: 'Remove legacy helper',
            confirmFileDeletions: false,
          },
          fixture.ctx,
        ),
      (err: Error & { code?: string }) => err.code === 'DELETION_CONFIRMATION_REQUIRED',
    );
    assert.equal(
      mockGoogle.projects.get('existing_script_abc123')!.files.length,
      3,
    );

    // Confirming file deletion creates pre-update backup snapshot AND pushes cleanly
    const pushed = await updateWorkspaceProjectContentProtected(
      fixture.ownerUid,
      'owner@antara.in',
      fixture.wsId,
      'existing_script_abc123',
      {
        files: filesWithoutHelper,
        changeSummary: 'Confirmed cleanup of legacy helper',
        confirmFileDeletions: true,
      },
      fixture.ctx,
    );
    assert.equal(pushed.verifiedFileParity, true);
    assert.equal(mockGoogle.projects.get('existing_script_abc123')!.files.length, 2);

    // Restoring pre-update snapshot brings back LegacyHelper cleanly
    const restored = await restoreWorkspaceProjectSnapshot(
      fixture.ownerUid,
      'owner@antara.in',
      fixture.wsId,
      'existing_script_abc123',
      pushed.preUpdateSnapshotId,
      fixture.ctx,
    );
    assert.equal(restored.verifiedFileParity, true);
    assert.equal(mockGoogle.projects.get('existing_script_abc123')!.files.length, 3);

    // 4. Immutable versions & deployments (API_EXECUTABLE + WEB_APP safety guard + rollback)
    const v1 = await createWorkspaceProjectVersionRelease(
      fixture.ownerUid,
      'owner@antara.in',
      fixture.wsId,
      'existing_script_abc123',
      { description: 'v1 initial release' },
      fixture.ctx,
    );
    assert.equal(v1.versionNumber, 1);

    const v2 = await createWorkspaceProjectVersionRelease(
      fixture.ownerUid,
      'owner@antara.in',
      fixture.wsId,
      'existing_script_abc123',
      { description: 'v2 hardened release' },
      fixture.ctx,
    );
    assert.equal(v2.versionNumber, 2);

    // Public ANYONE_ANONYMOUS deployment without confirmation must fail
    await assert.rejects(
      () =>
        createWorkspaceProjectDeployment(
          fixture.ownerUid,
          'owner@antara.in',
          fixture.wsId,
          'existing_script_abc123',
          {
            deploymentType: 'WEB_APP',
            versionNumber: 2,
            description: 'Public portal',
            accessLevel: 'ANYONE_ANONYMOUS',
            confirmPublicAccess: false,
          },
          fixture.ctx,
        ),
      (err: Error & { code?: string }) => err.code === 'PUBLIC_ACCESS_CONFIRMATION_REQUIRED',
    );

    const apiExecDep = await createWorkspaceProjectDeployment(
      fixture.ownerUid,
      'owner@antara.in',
      fixture.wsId,
      'existing_script_abc123',
      {
        deploymentType: 'API_EXECUTABLE',
        versionNumber: 2,
        description: 'Production Execution API',
        accessLevel: 'MYSELF',
      },
      fixture.ctx,
    );
    assert.equal(apiExecDep.deploymentType, 'API_EXECUTABLE');
    assert.equal(apiExecDep.versionNumber, 2);

    // Rollback to v1 with explicit confirmation
    const rolledBack = await updateWorkspaceDeploymentVersion(
      fixture.ownerUid,
      'owner@antara.in',
      fixture.wsId,
      'existing_script_abc123',
      {
        deploymentId: apiExecDep.deploymentId,
        versionNumber: 1,
        description: 'Rollback to v1',
        confirmProductionUpdate: true,
      },
      fixture.ctx,
    );
    assert.equal(rolledBack.versionNumber, 1);

    // 5. Execution Allowlist Enforcement
    await assert.rejects(
      () =>
        executeAllowlistedScriptFunction(
          fixture.ownerUid,
          'owner@antara.in',
          fixture.wsId,
          'existing_script_abc123',
          {
            deploymentId: apiExecDep.deploymentId,
            functionName: 'unapprovedArbitraryFn',
          },
          fixture.ctx,
        ),
      (err: Error & { code?: string }) => err.code === 'EXECUTION_NOT_ALLOWLISTED',
    );

    await registerApprovedExecutionTarget(
      fixture.ownerUid,
      'owner@antara.in',
      fixture.wsId,
      'existing_script_abc123',
      {
        deploymentId: apiExecDep.deploymentId,
        functionName: 'runSync',
        description: 'Execute marketing sync',
        requiredScopes: ['https://www.googleapis.com/auth/spreadsheets'],
        riskClassification: 'medium',
        requiresHumanApproval: true,
      },
      fixture.ctx,
    );

    // Medium risk target requires confirmation
    await assert.rejects(
      () =>
        executeAllowlistedScriptFunction(
          fixture.ownerUid,
          'owner@antara.in',
          fixture.wsId,
          'existing_script_abc123',
          {
            deploymentId: apiExecDep.deploymentId,
            functionName: 'runSync',
            approvalConfirmed: false,
          },
          fixture.ctx,
        ),
      (err: Error & { code?: string }) => err.code === 'EXECUTION_APPROVAL_REQUIRED',
    );

    const execResult = await executeAllowlistedScriptFunction(
      fixture.ownerUid,
      'owner@antara.in',
      fixture.wsId,
      'existing_script_abc123',
      {
        deploymentId: apiExecDep.deploymentId,
        functionName: 'runSync',
        parameters: [{ campaign: 'Q4' }],
        approvalConfirmed: true,
      },
      fixture.ctx,
    );
    assert.equal(execResult.status, 'completed');
    assert.ok(execResult.resultJson?.includes('Q4'));

    // 6. Idempotent Trigger Manager preserves unrelated user trigger
    const trig = await installOrSyncScriptTrigger(
      fixture.ownerUid,
      'owner@antara.in',
      fixture.wsId,
      'existing_script_abc123',
      {
        deploymentId: apiExecDep.deploymentId,
        handler: 'runSync',
        triggerType: 'time_hourly',
        intervalValue: 6,
        timezone: 'Asia/Kolkata',
      },
      fixture.ctx,
    );
    assert.equal(trig.state, 'active');
    const remoteTrigs = mockGoogle.projects.get('existing_script_abc123')!.installedTriggers;
    assert.ok(remoteTrigs.some((t) => t.id === 'unrelated_trig_99'));
    assert.ok(remoteTrigs.some((t) => t.handler === 'runSync'));

    await removeScriptTrigger(
      fixture.ownerUid,
      'owner@antara.in',
      fixture.wsId,
      'existing_script_abc123',
      trig.id,
      fixture.ctx,
    );
    const afterRm = mockGoogle.projects.get('existing_script_abc123')!.installedTriggers;
    assert.ok(afterRm.some((t) => t.id === 'unrelated_trig_99'));
    assert.ok(!afterRm.some((t) => t.handler === 'runSync'));

    // 7. 16-check Doctor detects user Apps Script toggle disabled cleanly
    mockGoogle.projects.get('existing_script_abc123')!.userToggleDisabled = true;
    const doctorReport = await runWorkspaceGoogleDoctor(
      fixture.ownerUid,
      fixture.wsId,
      'existing_script_abc123',
      fixture.ctx,
    );
    const toggleCheck = doctorReport.checks.find((c) => c.id === 'live_apps_script_api');
    assert.equal(toggleCheck?.code, 'SCRIPT_PROJECT_ACCESS_NOT_GRANTED');
    assert.equal(toggleCheck?.actionUrl, 'https://script.google.com/home/usersettings');
  } finally {
    fixture.cleanup();
  }
});
