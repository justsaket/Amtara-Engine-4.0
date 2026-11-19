import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildStructuredLog,
  classifyOperationalError,
  listRecentStructuredLogs,
  logStructuredEvent,
  redactSensitiveObject,
  redactSensitiveString,
} from '../src/lib/server/observability';
import {
  assertRequestPayloadSize,
  checkRateLimit,
  enforceRateLimit,
  resetRateLimitBucketsForTests,
  sanitizeInternalRedirect,
} from '../src/lib/server/rate-limit';
import {
  SCHEMA_MIGRATION_REGISTRY,
  runWorkspaceIntegrityAudit,
} from '../src/lib/server/migrations';
import { evaluateOnboardingProgress } from '../src/lib/onboarding/progress';
import { createDevelopmentTestStore } from '../src/lib/server/repositories';
import { STARTER_BRAND_PRESETS } from '../src/lib/starter-brands';
import {
  buildPlatformVariants,
  computeContentPayloadHash,
  doesEditInvalidateApproval,
  evaluateContentQualityGate,
} from '../src/lib/marketing/content-factory';
import {
  createDefaultAutonomyPolicy,
  createDefaultEmergencyStopState,
  evaluateActionGateway,
} from '../src/lib/marketing/autonomy-gateway';
import {
  cancelScheduledPostsForDisconnectedAccount,
  claimScheduledPostLease,
  computeRetryOrDeadLetterTransition,
  selectDueScheduledPosts,
} from '../src/lib/marketing/scheduler';
import {
  classifyReviewFeedback,
  computeWebhookDedupeKey,
  detectSensitiveTopic,
} from '../src/lib/marketing/inbox-reviews-leads';
import {
  aggregateAnalyticsSnapshots,
  evaluateExperimentAndBuildCandidateMemory,
} from '../src/lib/marketing/analytics-optimizer';
import { createTestOnlyMockPublishingAdapter } from '../src/lib/marketing/providers/registry';
import type {
  AnalyticsSnapshotRecord,
  ApprovalRequestRecord,
  BrandProfile,
  ConnectedSocialAccount,
  PerformanceExperimentRecord,
  ScheduledPostRecord,
  WorkspaceMember,
} from '../src/types/domain';

test('Phase 5 Observability: structured logging, deep secret redaction, and 7-way failure classification', () => {
  const raw =
    'Authorization: Bearer abc.def.ghi token=ya29.a0AfH6SMExampleToken12345 key=AIzaSyA123456789012345678901234 sk-secretkey1234567890123456';
  const redacted = redactSensitiveString(raw);
  assert.equal(redacted.includes('ya29.'), false);
  assert.equal(redacted.includes('AIzaSy'), false);
  assert.equal(redacted.includes('sk-secretkey'), false);
  assert.equal(redacted.includes('abc.def.ghi'), false);

  const nested = redactSensitiveObject({
    workspaceId: 'ws_1',
    accessToken: 'raw-access-token',
    nested: {
      refresh_token: 'raw-refresh',
      clientSecret: 'raw-secret',
      safeLabel: 'greenweld-india',
    },
  }) as Record<string, unknown>;

  assert.equal(nested.workspaceId, 'ws_1');
  assert.equal(nested.accessToken, '[REDACTED]');
  assert.equal((nested.nested as Record<string, unknown>).refresh_token, '[REDACTED]');
  assert.equal((nested.nested as Record<string, unknown>).clientSecret, '[REDACTED]');
  assert.equal((nested.nested as Record<string, unknown>).safeLabel, 'greenweld-india');

  assert.equal(classifyOperationalError({ statusCode: 429, code: 'RATE_LIMITED' }), 'RATE_LIMIT');
  assert.equal(classifyOperationalError({ code: 'PROVIDER_NOT_CONFIGURED' }), 'CONFIGURATION');
  assert.equal(classifyOperationalError({ statusCode: 403, code: 'FORBIDDEN' }), 'AUTHORIZATION');
  assert.equal(classifyOperationalError({ statusCode: 400, code: 'VALIDATION_ERROR' }), 'VALIDATION');
  assert.equal(classifyOperationalError({ statusCode: 503, message: 'upstream timeout' }), 'TRANSIENT');
  assert.equal(classifyOperationalError({ statusCode: 404, code: 'NOT_FOUND' }), 'PERMANENT');
  assert.equal(classifyOperationalError(null), 'UNKNOWN');

  const logEntry = logStructuredEvent({
    workspaceId: 'ws_obs_1',
    userId: 'uid_owner',
    operation: 'phase5.test.log',
    status: 'ok',
    metadata: { authorization: 'Bearer topsecret123', brand: 'GreenWeld' },
  });
  assert.ok(logEntry.eventId.startsWith('evt_'));
  assert.ok(logEntry.correlationId.startsWith('corr_'));
  assert.equal(logEntry.metadata?.authorization, '[REDACTED]');
  assert.equal(logEntry.metadata?.brand, 'GreenWeld');

  const fetched = listRecentStructuredLogs('ws_obs_1', 5);
  assert.ok(fetched.some((e) => e.eventId === logEntry.eventId));

  const built = buildStructuredLog({ operation: 'unit.build', status: 'warning' });
  assert.equal(built.status, 'warning');
});

test('Phase 5 Security Controls: sliding-window rate limiter, payload guard, and open-redirect blocker', () => {
  resetRateLimitBucketsForTests();
  const baseNow = 1_700_000_000_000;

  const r1 = checkRateLimit({ key: 'export:ws_1', maxRequests: 2, windowMs: 60_000, nowMs: baseNow });
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 1);

  const r2 = checkRateLimit({ key: 'export:ws_1', maxRequests: 2, windowMs: 60_000, nowMs: baseNow + 1000 });
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 0);

  assert.throws(
    () => enforceRateLimit({ key: 'export:ws_1', maxRequests: 2, windowMs: 60_000, nowMs: baseNow + 2000 }),
    /Rate limit exceeded/,
  );

  // Allowed again after sliding window expires
  const r4 = checkRateLimit({ key: 'export:ws_1', maxRequests: 2, windowMs: 60_000, nowMs: baseNow + 65_000 });
  assert.equal(r4.allowed, true);

  // Payload size guard
  assert.doesNotThrow(() => assertRequestPayloadSize('1024', 10_000));
  assert.throws(() => assertRequestPayloadSize('204800', 10_000), /exceeds maximum permitted size/);

  // Open redirect sanitization
  assert.equal(sanitizeInternalRedirect('/dashboard/system-health'), '/dashboard/system-health');
  assert.equal(sanitizeInternalRedirect('https://evil.example/phish'), '/dashboard');
  assert.equal(sanitizeInternalRedirect('//evil.example/phish'), '/dashboard');
  assert.equal(sanitizeInternalRedirect('/\\evil.example'), '/dashboard');
  assert.equal(sanitizeInternalRedirect('/dashboard\r\nSet-Cookie: bad=1'), '/dashboard');
  assert.equal(sanitizeInternalRedirect(undefined, '/login'), '/login');
});

test('Phase 5 Migrations & Integrity Audit: schema v1.0.0->v5.0.0 registry and non-destructive drift detection', async () => {
  assert.equal(SCHEMA_MIGRATION_REGISTRY.length, 5);
  assert.equal(SCHEMA_MIGRATION_REGISTRY[0].version, '1.0.0');
  assert.equal(SCHEMA_MIGRATION_REGISTRY[4].version, '5.0.0');

  const store = createDevelopmentTestStore();
  await store.commit([
    { path: 'workspaces/ws_mig/brands/brand_1', data: { id: 'brand_1', name: 'GreenWeld' } },
    { path: 'workspaces/ws_mig/socialAccounts/sacc_1', data: { id: 'sacc_1', provider: 'instagram' } },
    // Orphan brand reference + missing schemaVersion
    { path: 'workspaces/ws_mig/contentItems/cnt_orphan', data: { id: 'cnt_orphan', brandId: 'brand_deleted' } },
    // Duplicate idempotency key + stale lease + orphan account
    {
      path: 'workspaces/ws_mig/scheduledPosts/sch_a',
      data: {
        id: 'sch_a',
        idempotencyKey: 'dup_key_1',
        accountId: 'sacc_1',
        status: 'claimed',
        leaseExpiresAt: '2026-01-01T00:00:00.000Z',
      },
    },
    {
      path: 'workspaces/ws_mig/scheduledPosts/sch_b',
      data: {
        id: 'sch_b',
        idempotencyKey: 'dup_key_1',
        accountId: 'sacc_missing',
        status: 'scheduled',
      },
    },
  ]);

  const beforeSize = store.docs.size;
  const audit = await runWorkspaceIntegrityAudit(store, 'ws_mig', '2026-05-01T00:00:00.000Z');
  assert.equal(store.docs.size, beforeSize, 'Integrity audit must be strictly non-destructive');
  assert.equal(audit.targetSchemaVersion, '5.0.0');
  assert.equal(audit.healthy, false, 'Duplicate idempotency key must flag healthy=false');
  assert.ok(audit.findings.some((f) => f.category === 'orphan_reference' && f.documentId === 'cnt_orphan'));
  assert.ok(audit.findings.some((f) => f.category === 'duplicate_job' && f.documentId === 'sch_b'));
  assert.ok(audit.findings.some((f) => f.category === 'stale_lease' && f.documentId === 'sch_a'));
  assert.equal(audit.backupReadiness.managedAutomaticBackupsConfirmed, false);
});

test('Phase 5 Onboarding Readiness: 9 stages distinguish required core setup from optional providers', () => {
  const initial = evaluateOnboardingProgress({
    hasAccount: true,
    hasWorkspace: true,
    brandsCount: 0,
    aiConfigured: false,
    activeAiProviders: [],
    googleConnectedCount: 0,
    socialConnectedCount: 0,
    mediaAssetsCount: 0,
    autonomyPoliciesCount: 0,
  });
  assert.equal(initial.stages.length, 9);
  assert.equal(initial.overallReady, false, 'Brands are required before Ready to Operate');

  const coreReady = evaluateOnboardingProgress({
    hasAccount: true,
    hasWorkspace: true,
    brandsCount: 4,
    aiConfigured: false,
    activeAiProviders: [],
    googleConnectedCount: 0,
    socialConnectedCount: 0,
    mediaAssetsCount: 0,
    autonomyPoliciesCount: 0,
  });
  assert.equal(coreReady.overallReady, true, 'Missing optional third-party providers must never block core readiness');
  assert.equal(coreReady.completedRequiredCount, coreReady.totalRequiredCount);
});

test('Phase 5 End-to-End Integration Flows 01–12: full multi-brand pipeline, approvals, autonomy, scheduler, webhooks, analytics & recovery', async () => {
  // Flow 01 & 02: Workspace + 4 Starter Brands initialized cleanly
  assert.equal(STARTER_BRAND_PRESETS.length, 4);
  const starterKeys = STARTER_BRAND_PRESETS.map((b) => b.starterKey);
  assert.ok(starterKeys.includes('saket_personal'));
  assert.ok(starterKeys.includes('magnarc'));
  assert.ok(starterKeys.includes('greenweld'));
  assert.ok(starterKeys.includes('sapphire'));

  const owner: WorkspaceMember = {
    uid: 'uid_owner',
    workspaceId: 'ws_e2e',
    email: 'owner@antara.local',
    displayName: 'Antara Owner',
    role: 'owner',
    status: 'active',
    invitedBy: 'uid_owner',
    joinedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const brand: BrandProfile = {
    id: 'brand_greenweld',
    workspaceId: 'ws_e2e',
    starterKey: 'greenweld',
    name: 'GreenWeld',
    slug: 'greenweld',
    description: 'Practical welding machines for industrial workshops.',
    industry: 'Industrial Equipment',
    targetAudience: 'Fabrication workshops and distributors',
    brandVoice: 'Clear, technical, practical',
    contentPillars: ['Durability', 'Workshop Tips'],
    primaryColor: '#059669',
    accentColor: '#0f172a',
    restrictions: 'No unverified warranty claims.',
    status: 'active',
    createdBy: 'uid_owner',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  // Flow 04–06: Content creation -> QA -> Payload Hash -> Approval invalidation on edit
  const title = 'GreenWeld Monsoon Inverter Durability Guide';
  const body = 'Engineered for practical daily workshops across India with steady arc performance.';
  const hashtags = ['#GreenWeld', '#WeldingIndia'];
  const variants = buildPlatformVariants({
    title,
    body,
    cta: 'Request a workshop demo',
    hashtags,
    targetPlatforms: ['instagram'],
    mediaAssetIds: ['asset_1'],
  });
  const payloadHash = computeContentPayloadHash({
    title,
    body,
    cta: 'Request a workshop demo',
    hashtags,
    mediaAssetIds: ['asset_1'],
    targetPlatforms: ['instagram'],
  });

  const mediaAsset = {
    id: 'asset_1',
    schemaVersion: '4.0.0' as const,
    workspaceId: 'ws_e2e',
    brandId: brand.id,
    fileName: 'greenweld-workshop.jpg',
    mimeType: 'image/jpeg',
    mediaKind: 'image' as const,
    sizeBytes: 240_000,
    width: 1080,
    height: 1080,
    sha256: 'abc123def456',
    storagePath: 'workspaces/ws_e2e/brands/brand_greenweld/assets/asset_1.jpg',
    publicPreviewUrl: 'https://storage.example.test/asset_1.jpg',
    source: 'upload' as const,
    processingState: 'validated' as const,
    validationErrors: [] as string[],
    compatiblePlatforms: ['instagram' as const],
    createdBy: 'uid_owner',
    createdAt: '2026-05-01T07:00:00.000Z',
    updatedAt: '2026-05-01T07:00:00.000Z',
  };

  const qa = evaluateContentQualityGate({
    brand,
    brandFacts: [],
    title,
    body,
    cta: 'Request a workshop demo',
    hashtags,
    format: 'single_image',
    targetPlatforms: ['instagram'],
    variants,
    mediaAssets: [mediaAsset],
  });
  assert.equal(qa.passed, true);

  const approval: ApprovalRequestRecord = {
    id: 'apr_e2e_1',
    schemaVersion: '4.0.0',
    workspaceId: 'ws_e2e',
    brandId: brand.id,
    actionType: 'publish_post',
    targetResourceType: 'content_item',
    targetResourceId: 'cnt_e2e_1',
    platform: 'instagram',
    payloadHash,
    summary: title,
    riskLevel: 'low',
    status: 'approved',
    requestedByUid: 'uid_owner',
    requestedByType: 'human',
    decidedByUid: 'uid_owner',
    decidedByEmail: 'owner@antara.local',
    decidedAt: '2026-05-01T08:06:00.000Z',
    expiresAt: '2026-05-10T08:06:00.000Z',
    createdAt: '2026-05-01T08:05:00.000Z',
    updatedAt: '2026-05-01T08:06:00.000Z',
  };

  // Editing text changes payload hash and invalidates prior approval
  const mutatedHash = computeContentPayloadHash({
    title,
    body: 'Changed caption after human approval',
    cta: 'Request a workshop demo',
    hashtags,
    mediaAssetIds: ['asset_1'],
    targetPlatforms: ['instagram'],
  });
  assert.notEqual(mutatedHash, payloadHash);
  assert.equal(
    doesEditInvalidateApproval(
      { status: 'APPROVED', payloadHash, approvedPayloadHash: payloadHash },
      mutatedHash,
    ),
    true,
  );

  // Flow 07 & 08: Autonomy Mode B allows approved publish; Emergency Stop immediately blocks
  const account: ConnectedSocialAccount = {
    id: 'sacc_ig_e2e',
    schemaVersion: '4.0.0',
    workspaceId: 'ws_e2e',
    brandId: brand.id,
    provider: 'instagram',
    authMode: 'facebook_login',
    externalAccountId: '17841400999',
    displayName: 'GreenWeld Official',
    handle: '@greenweld',
    accountType: 'business',
    status: 'connected',
    readinessState: 'connected',
    grantedScopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'],
    capabilities: ['single_image', 'reel'],
    unsupportedCapabilities: ['text_post'],
    encryptedCredentialId: 'scred_e2e',
    tokenExpiresAt: '2026-06-01T00:00:00.000Z',
    hasRefreshToken: true,
    connectedBy: 'uid_owner',
    connectedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const policy = createDefaultAutonomyPolicy('ws_e2e', brand.id, 'uid_owner');
  assert.equal(policy.publishingMode, 'APPROVAL_REQUIRED');
  const normalStop = createDefaultEmergencyStopState('ws_e2e');

  const allowedDecision = evaluateActionGateway({
    workspaceId: 'ws_e2e',
    brandId: brand.id,
    actorUid: owner.uid,
    actorType: 'human',
    member: owner,
    actionType: 'publish_post',
    platform: 'instagram',
    contentFormat: 'single_image',
    payloadHash,
    idempotencyKey: 'idem_e2e_1',
    account,
    approval,
    autonomyPolicy: policy,
    emergencyStop: normalStop,
    qualityCheck: qa,
    nowIso: '2026-05-01T09:00:00.000Z',
  });
  assert.equal(allowedDecision.allowed, true);

  // Test-only mock adapter confirms no live social publish happens in tests
  const mockAdapter = createTestOnlyMockPublishingAdapter('instagram', { mode: 'success' });
  const publishRes = await mockAdapter.publish(account, 'test-token', {
    workspaceId: 'ws_e2e',
    brandId: brand.id,
    contentItemId: 'cnt_e2e_1',
    format: 'single_image',
    title,
    caption: body,
    hashtags,
    mediaAssets: [mediaAsset],
    idempotencyKey: 'idem_e2e_1',
  });
  assert.equal(publishRes.status, 'published');
  assert.equal(mockAdapter.callCount, 1);

  // Emergency Stop halts immediately
  const haltedDecision = evaluateActionGateway({
    workspaceId: 'ws_e2e',
    brandId: brand.id,
    actorUid: owner.uid,
    actorType: 'human',
    member: owner,
    actionType: 'publish_post',
    platform: 'instagram',
    contentFormat: 'single_image',
    payloadHash,
    idempotencyKey: 'idem_e2e_2',
    account,
    approval,
    autonomyPolicy: policy,
    emergencyStop: {
      ...normalStop,
      globalStopped: true,
      reason: 'Emergency review',
    },
    qualityCheck: qa,
    nowIso: '2026-05-01T09:00:00.000Z',
  });
  assert.equal(haltedDecision.allowed, false);
  assert.equal(haltedDecision.code, 'EMERGENCY_STOP_ACTIVE');

  // Flow 09 & 12: Scheduler lease, transient retry -> dead-letter, and disconnect cancellation
  const job: ScheduledPostRecord = {
    id: 'sch_e2e_1',
    schemaVersion: '4.0.0',
    workspaceId: 'ws_e2e',
    brandId: brand.id,
    contentItemId: 'cnt_e2e_1',
    platform: 'instagram',
    accountId: account.id,
    scheduledForUtc: '2026-05-01T09:00:00.000Z',
    timezone: 'Asia/Kolkata',
    status: 'scheduled',
    payloadHash,
    idempotencyKey: 'idem_e2e_1',
    attemptCount: 0,
    maxAttempts: 2,
    reconciliationRequired: false,
    createdBy: 'uid_owner',
    createdAt: '2026-05-01T08:00:00.000Z',
    updatedAt: '2026-05-01T08:00:00.000Z',
  };
  const due = selectDueScheduledPosts([job], '2026-05-01T09:05:00.000Z');
  assert.equal(due.dueForExecution.length, 1);

  const lease = claimScheduledPostLease(job, 'worker_1', '2026-05-01T09:05:00.000Z');
  assert.equal(lease.claimed, true);
  assert.ok(lease.updated);

  const retry1 = computeRetryOrDeadLetterTransition(
    lease.updated!,
    {
      errorCode: 'PROVIDER_TEMPORARY_ERROR',
      errorMessage: '503 upstream',
      retryable: true,
    },
    '2026-05-01T09:05:30.000Z',
  );
  assert.equal(retry1.status, 'scheduled');
  assert.ok(retry1.nextRetryAtUtc);

  const cancelled = cancelScheduledPostsForDisconnectedAccount([job], account.id, '2026-05-01T09:10:00.000Z');
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].status, 'cancelled');

  // Flow 10: Webhook dedupe, sensitive topic escalation, and review classification
  const dk1 = computeWebhookDedupeKey('meta', 'evt_999', '{"entry":[]}');
  const dk2 = computeWebhookDedupeKey('meta', 'evt_999', '{"entry":[]}');
  assert.equal(dk1, dk2);
  assert.equal(detectSensitiveTopic('I want a legal refund immediately for my order!').sensitive, true);
  assert.equal(classifyReviewFeedback(1, 'Machine arrived damaged, terrible support').sentiment, 'negative');

  // Flow 11: Null-preserving analytics aggregation + Experiment -> Phase 3 candidate memory
  const snapshots: AnalyticsSnapshotRecord[] = [
    {
      id: 'ana_ctrl',
      schemaVersion: '4.0.0',
      workspaceId: 'ws_e2e',
      brandId: brand.id,
      platform: 'instagram',
      accountId: account.id,
      contentItemId: 'cnt_control',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-07T00:00:00.000Z',
      timezone: 'Asia/Kolkata',
      sourceApi: 'instagram_insights_v21',
      attributionNote: 'Direct platform insights snapshot',
      dedupeKey: 'dk_ctrl',
      metrics: {
        impressions: 3200,
        reach: 2400,
        engagements: 180,
        clicks: null,
        videoViews: null,
        followersDelta: null,
        leadsAttributed: null,
        spendAmount: null,
        revenueAmount: null,
      },
      units: { engagementDefinition: 'likes+comments+saves+shares' },
      collectedAt: '2026-05-07T01:00:00.000Z',
    },
    {
      id: 'ana_var',
      schemaVersion: '4.0.0',
      workspaceId: 'ws_e2e',
      brandId: brand.id,
      platform: 'instagram',
      accountId: account.id,
      contentItemId: 'cnt_variant',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-07T00:00:00.000Z',
      timezone: 'Asia/Kolkata',
      sourceApi: 'instagram_insights_v21',
      attributionNote: 'Direct platform insights snapshot',
      dedupeKey: 'dk_var',
      metrics: {
        impressions: 4200,
        reach: 3100,
        engagements: 310,
        clicks: null,
        videoViews: null,
        followersDelta: null,
        leadsAttributed: null,
        spendAmount: null,
        revenueAmount: null,
      },
      units: { engagementDefinition: 'likes+comments+saves+shares' },
      collectedAt: '2026-05-07T01:00:00.000Z',
    },
  ];
  const agg = aggregateAnalyticsSnapshots(snapshots);
  assert.equal(agg.impressions, 7400);
  assert.equal(agg.clicks, null, 'Missing metrics must remain null, never fabricated as zero');

  const exp: PerformanceExperimentRecord = {
    id: 'exp_1',
    schemaVersion: '4.0.0',
    workspaceId: 'ws_e2e',
    brandId: brand.id,
    title: 'Workshop Reel vs Static Spec',
    hypothesis: 'Workshop demonstration reels outperform static specs for engagements',
    platform: 'instagram',
    primaryMetric: 'engagements',
    controlContentId: 'cnt_control',
    variantContentId: 'cnt_variant',
    status: 'running',
    minSampleSize: 200,
    observedControlValue: null,
    observedVariantValue: null,
    confidenceNote: '',
    createdBy: 'uid_owner',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
  };
  const evalRes = evaluateExperimentAndBuildCandidateMemory(exp, snapshots, 'uid_owner');
  assert.equal(evalRes.status, 'completed');
  assert.equal(evalRes.observedControlValue, 180);
  assert.equal(evalRes.observedVariantValue, 310);
  assert.ok(evalRes.candidateMemory);
  assert.equal(evalRes.candidateMemory?.namespace, 'performance_memory');
});

test('Phase 5 Security Hygiene: public /api/health never leaks internal secret sources or project/db identifiers', () => {
  const healthRoutePath = path.resolve(process.cwd(), 'src/app/api/health/route.ts');
  const src = fs.readFileSync(healthRoutePath, 'utf8');
  assert.equal(src.includes('firebaseProjectId'), false);
  assert.equal(src.includes('databaseId'), false);
  assert.equal(src.includes('internalSecrets'), false);
  assert.equal(src.includes('secretFile'), false);
  assert.ok(src.includes('phase_5_production_release'));
});
