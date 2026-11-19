import assert from 'node:assert/strict';
import test from 'node:test';
import { MockTestModelAdapter } from '@/lib/ai/adapters/mock-adapter';
import { ModelProviderManager } from '@/lib/ai/provider-manager';
import { getAgentDefinition, listAllAgents } from '@/lib/agents/agent-registry';
import {
  cancelOrchestratorRun,
  classifyPromptAndPlanDag,
  startAndExecuteOrchestratorRun,
} from '@/lib/agents/orchestrator';
import { executeRegisteredTool } from '@/lib/agents/tool-registry';
import {
  ALL_PLAYBOOK_IDS,
  createTestPlaybookFixture,
  getLocalHourInTimezone,
  isQuietHoursInTimezone,
  triggerPlaybookEvent,
} from '@/lib/playbooks/engine';
import {
  getRunWithDetails,
  listOrchestratorRuns,
  listUsageLedger,
  upsertAgentConfig,
} from '@/lib/server/phase3-repositories';
import {
  bootstrapUserProfile,
  createDevelopmentTestStore,
  createWorkspace,
  listBrands,
} from '@/lib/server/repositories';
import type { AuthenticatedUser } from '@/lib/server/auth';

const ownerUser: AuthenticatedUser = {
  uid: 'uid_orch_owner',
  email: 'saket@antara.local',
  displayName: 'Saket Owner',
  authProvider: 'password',
};

const viewerUser: AuthenticatedUser = {
  uid: 'uid_orch_viewer',
  email: 'viewer@antara.local',
  displayName: 'Read Only Viewer',
  authProvider: 'password',
};

const outsiderUser: AuthenticatedUser = {
  uid: 'uid_orch_outsider',
  email: 'outsider@other.local',
  displayName: 'Outsider',
  authProvider: 'google.com',
};

test('All 9 Specialist Agents + Tool Registry allowlists enforce strict permissions', async () => {
  const defs = listAllAgents();
  assert.equal(defs.length, 9);
  assert.equal(defs[0].id, '01_orchestrator');
  assert.equal(defs[8].id, '09_results_roi');

  const reviewDef = getAgentDefinition('07_reviews_reputation');
  // Reviews agent is NOT allowed to invoke web_search_adapter
  await assert.rejects(
    () =>
      executeRegisteredTool(
        {
          workspaceId: 'ws_1',
          actorUid: ownerUser.uid,
          agentId: '07_reviews_reputation',
          allowedTools: reviewDef.allowedTools,
          brand: null,
          brandFacts: [],
          memoryItems: [],
          allowedNamespaces: reviewDef.allowedMemoryNamespaces,
          runId: 'run_perm_test',
        },
        'web_search_adapter',
        { query: 'something' },
      ),
    (err: unknown) =>
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'TOOL_PERMISSION_DENIED',
  );
});

test('Orchestrator routes simple queries minimally vs deep multi-stage DAGs', () => {
  const reviewPlan = classifyPromptAndPlanDag('Draft a response for a 1-star review on Google');
  assert.equal(reviewPlan.intentCategory, 'review_reply');
  assert.equal(reviewPlan.stages.length, 1);
  assert.deepEqual(reviewPlan.stages[0].agentIds, ['07_reviews_reputation']);

  const leadPlan = classifyPromptAndPlanDag('Respond to an 11 PM DM lead inquiry');
  assert.equal(leadPlan.intentCategory, 'lead_response');
  assert.deepEqual(leadPlan.stages[0].agentIds, ['08_leads_conversations']);

  const fullCampaignPlan = classifyPromptAndPlanDag(
    'Prepare our Q1 launch full campaign with competitor research and creatives',
  );
  assert.equal(fullCampaignPlan.intentCategory, 'full_campaign');
  assert.equal(fullCampaignPlan.stages.length, 3);
  assert.ok(fullCampaignPlan.stages[0].agentIds.includes('02_market_radar'));
  assert.ok(fullCampaignPlan.stages[1].agentIds.includes('04_content_engine'));
});

test('Orchestrator executes end-to-end across all 4 starter brands, deduplicates idempotency, logs usage, and blocks RBAC/cross-tenant misuse', async () => {
  const store = createDevelopmentTestStore();
  await bootstrapUserProfile(ownerUser, { store });
  await bootstrapUserProfile(viewerUser, { store });

  const ws = await createWorkspace(
    ownerUser,
    {
      name: 'Antara Multi-Brand HQ',
      timezone: 'Asia/Kolkata',
      starterBrands: ['saket_personal', 'magnarc', 'greenweld', 'sapphire'],
    },
    { store },
  );

  // Add a viewer directly in test store to test RBAC enforcement
  await store.commit([
    {
      path: `workspaces/${ws.id}/members/${viewerUser.uid}`,
      data: {
        uid: viewerUser.uid,
        workspaceId: ws.id,
        email: viewerUser.email,
        displayName: viewerUser.displayName,
        role: 'viewer',
        status: 'active',
        invitedBy: ownerUser.uid,
        joinedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
  ]);

  const brands = await listBrands(ownerUser.uid, ws.id, { store });
  assert.equal(brands.length, 4);

  // Viewer cannot configure agents or execute AI commands
  await assert.rejects(
    () =>
      upsertAgentConfig(
        viewerUser.uid,
        ws.id,
        viewerUser.email,
        '04_content_engine',
        { enabled: false },
        { store },
      ),
    /lacks required permission/,
  );

  await assert.rejects(
    () =>
      startAndExecuteOrchestratorRun({
        uid: viewerUser.uid,
        actorEmail: viewerUser.email,
        workspaceId: ws.id,
        prompt: 'Write a LinkedIn post',
        ctx: { store },
      }),
    /lacks required permission/,
  );

  // Outsider blocked completely
  await assert.rejects(
    () =>
      startAndExecuteOrchestratorRun({
        uid: outsiderUser.uid,
        actorEmail: outsiderUser.email,
        workspaceId: ws.id,
        prompt: 'Write a LinkedIn post',
        ctx: { store },
      }),
    /not a member of this workspace/,
  );

  // Real unconfigured AI returns honest needs_configuration state without crashing
  const unconfiguredManager = new ModelProviderManager({ includeDefaultEnvAdapters: false });
  const unconfiguredBundle = await startAndExecuteOrchestratorRun({
    uid: ownerUser.uid,
    actorEmail: ownerUser.email,
    workspaceId: ws.id,
    brandId: brands[0].id,
    prompt: 'Draft a response to a 1-star review',
    modelManager: unconfiguredManager,
    ctx: { store },
  });
  assert.equal(unconfiguredBundle.run.status, 'needs_configuration');
  assert.equal(unconfiguredBundle.run.errorCode, 'AI_PROVIDER_NOT_CONFIGURED');

  // Inject deterministic TEST ONLY adapter for multi-brand evaluation
  const mockManager = new ModelProviderManager({
    includeDefaultEnvAdapters: false,
    customAdapters: [new MockTestModelAdapter()],
  });

  for (const brand of brands) {
    const evalBundle = await startAndExecuteOrchestratorRun({
      uid: ownerUser.uid,
      actorEmail: ownerUser.email,
      workspaceId: ws.id,
      brandId: brand.id,
      prompt: `Prepare a brand-safe LinkedIn strategic post draft for ${brand.name}`,
      idempotencyKey: `eval_${brand.id}`,
      modelManager: mockManager,
      ctx: { store },
    });

    assert.equal(evalBundle.run.status, 'completed');
    assert.equal(evalBundle.run.brandId, brand.id);
    assert.ok(evalBundle.artifacts.length >= 1);
    assert.ok(evalBundle.usage.every((u) => u.isMock === true));

    // Verify idempotency key deduplicates repeat submissions
    const duplicateBundle = await startAndExecuteOrchestratorRun({
      uid: ownerUser.uid,
      actorEmail: ownerUser.email,
      workspaceId: ws.id,
      brandId: brand.id,
      prompt: `Prepare a brand-safe LinkedIn strategic post draft for ${brand.name}`,
      idempotencyKey: `eval_${brand.id}`,
      modelManager: mockManager,
      ctx: { store },
    });
    assert.equal(duplicateBundle.run.id, evalBundle.run.id);
  }

  const runs = await listOrchestratorRuns(ws.id, { store });
  assert.equal(runs.length, 5); // 1 unconfigured + 4 brand evals

  const ledger = await listUsageLedger(ws.id, { store });
  assert.ok(ledger.length >= 4);

  const detail = await getRunWithDetails(ws.id, runs[0].id, { store });
  assert.equal(detail.run.id, runs[0].id);

  // Cancellation persists properly
  const cancelled = await cancelOrchestratorRun(
    ownerUser.uid,
    ws.id,
    ownerUser.email,
    runs[0].id,
    { store },
  );
  assert.equal(cancelled.status, 'cancelled');
});

test('Timezone quiet-hours + all 8 Event Playbooks execute cleanly with deduplication & Phase 3 boundaries', async () => {
  // Verify Asia/Kolkata quiet-hours detection (17:45 UTC = 23:15 IST)
  const istHour = getLocalHourInTimezone('2026-11-18T17:45:00.000Z', 'Asia/Kolkata');
  assert.equal(istHour, 23);
  assert.equal(isQuietHoursInTimezone('2026-11-18T17:45:00.000Z', 'Asia/Kolkata'), true);
  assert.equal(isQuietHoursInTimezone('2026-11-18T06:00:00.000Z', 'Asia/Kolkata'), false); // 11:30 IST

  const store = createDevelopmentTestStore();
  await bootstrapUserProfile(ownerUser, { store });
  const ws = await createWorkspace(
    ownerUser,
    {
      name: 'Playbook Automation Lab',
      timezone: 'Asia/Kolkata',
      starterBrands: ['magnarc'],
    },
    { store },
  );
  const [magnarc] = await listBrands(ownerUser.uid, ws.id, { store });

  const mockManager = new ModelProviderManager({
    includeDefaultEnvAdapters: false,
    customAdapters: [new MockTestModelAdapter()],
  });

  assert.equal(ALL_PLAYBOOK_IDS.length, 8);

  for (const playbookId of ALL_PLAYBOOK_IDS) {
    const fixture = createTestPlaybookFixture(playbookId, ws.timezone);
    const dedupeKey = `test_pb_${playbookId}`;

    const first = await triggerPlaybookEvent({
      uid: ownerUser.uid,
      actorEmail: ownerUser.email,
      workspaceId: ws.id,
      eventType: playbookId,
      brandId: magnarc.id,
      source: fixture.source,
      isTestFixture: fixture.isTestFixture,
      dedupeKey,
      occurredAt: fixture.occurredAt,
      payload: fixture.payload,
      modelManager: mockManager,
      ctx: { store },
    });

    assert.equal(first.deduplicated, false);
    assert.equal(first.event.isTestFixture, true);
    assert.equal(first.playbookRun.status, 'completed');
    assert.ok(first.orchestratorRunId);

    // Repeat identical event dedupeKey does not duplicate execution
    const second = await triggerPlaybookEvent({
      uid: ownerUser.uid,
      actorEmail: ownerUser.email,
      workspaceId: ws.id,
      eventType: playbookId,
      brandId: magnarc.id,
      source: fixture.source,
      isTestFixture: fixture.isTestFixture,
      dedupeKey,
      occurredAt: fixture.occurredAt,
      payload: fixture.payload,
      modelManager: mockManager,
      ctx: { store },
    });
    assert.equal(second.deduplicated, true);
    assert.equal(second.playbookRun.id, first.playbookRun.id);
  }
});
