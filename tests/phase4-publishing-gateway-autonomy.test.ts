import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ApprovalRequestRecord,
  BrandAutonomyPolicy,
  CampaignBudgetPolicy,
  ConnectedSocialAccount,
  ContentQualityCheckResult,
  WorkspaceMember,
} from '../src/types/domain';
import {
  createDefaultAutonomyPolicy,
  createDefaultEmergencyStopState,
  evaluateActionGateway,
} from '../src/lib/marketing/autonomy-gateway';
import {
  buildPhase4CapabilityMatrix,
  createTestOnlyMockPublishingAdapter,
  getSocialPublishingAdapter,
} from '../src/lib/marketing/providers/registry';
import {
  assertMetaAdsSpendNotBypassed,
  validateMetaAdCampaignDryRun,
} from '../src/lib/marketing/providers/meta-adapters';
import {
  GoogleBusinessProfileAdapter,
  LinkedInAdapter,
  TikTokAdapter,
  YouTubeAdapter,
} from '../src/lib/marketing/providers/social-adapters';

const ownerMember: WorkspaceMember = {
  uid: 'uid_owner',
  workspaceId: 'ws_1',
  email: 'owner@antara.test',
  displayName: 'Workspace Owner',
  role: 'owner',
  status: 'active',
  invitedBy: 'uid_owner',
  joinedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const connectedIgAccount: ConnectedSocialAccount = {
  id: 'sacc_ig_1',
  schemaVersion: '4.0.0',
  workspaceId: 'ws_1',
  brandId: 'brand_1',
  provider: 'instagram',
  authMode: 'facebook_login',
  externalAccountId: '17841400001',
  displayName: 'GreenWeld Official',
  handle: '@greenweld',
  accountType: 'business',
  status: 'connected',
  readinessState: 'connected',
  grantedScopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'],
  capabilities: ['single_image', 'reel'],
  unsupportedCapabilities: ['text_post'],
  encryptedCredentialId: 'scred_1',
  tokenExpiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
  hasRefreshToken: true,
  connectedBy: 'uid_owner',
  connectedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const passedQa: ContentQualityCheckResult = {
  passed: true,
  checkedAt: '2026-01-01T00:00:00.000Z',
  score: 96,
  warnings: [],
  brandFactsChecked: 3,
  prohibitedTermsMatched: [],
  platformLimitViolations: [],
  duplicateRisk: 'none',
};

const validHumanApproval: ApprovalRequestRecord = {
  id: 'apr_1',
  schemaVersion: '4.0.0',
  workspaceId: 'ws_1',
  brandId: 'brand_1',
  actionType: 'publish_post',
  targetResourceType: 'content_item',
  targetResourceId: 'cnt_1',
  platform: 'instagram',
  accountId: 'sacc_ig_1',
  payloadHash: 'hash_abc123456789',
  summary: 'Approve Instagram post',
  riskLevel: 'low',
  status: 'approved',
  requestedByUid: 'uid_editor',
  requestedByType: 'human',
  decidedByUid: 'uid_owner',
  decidedByEmail: 'owner@antara.test',
  decidedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

test('Central Action Gateway: enforces approval binding, blocks AI self-approval, edits, expired approval, wrong workspace, and Emergency Stop', () => {
  const modeB = createDefaultAutonomyPolicy('ws_1', 'brand_1', 'uid_owner');
  const emergencyOk = createDefaultEmergencyStopState('ws_1');

  // 1. Valid Mode B human approval passes
  const allowed = evaluateActionGateway({
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    actorUid: 'uid_owner',
    actorType: 'human',
    member: ownerMember,
    actionType: 'publish_post',
    platform: 'instagram',
    contentFormat: 'single_image',
    payloadHash: 'hash_abc123456789',
    idempotencyKey: 'idem_1',
    account: connectedIgAccount,
    approval: validHumanApproval,
    autonomyPolicy: modeB,
    emergencyStop: emergencyOk,
    qualityCheck: passedQa,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.executionMode, 'approved_human');

  // 2. Missing approval in Mode B blocked
  const noApproval = evaluateActionGateway({
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    actorUid: 'uid_owner',
    actorType: 'human',
    member: ownerMember,
    actionType: 'publish_post',
    platform: 'instagram',
    contentFormat: 'single_image',
    payloadHash: 'hash_abc123456789',
    idempotencyKey: 'idem_2',
    account: connectedIgAccount,
    approval: null,
    autonomyPolicy: modeB,
    emergencyStop: emergencyOk,
    qualityCheck: passedQa,
  });
  assert.equal(noApproval.allowed, false);
  assert.equal(noApproval.code, 'APPROVAL_REQUIRED');

  // 3. Edited payload hash invalidates prior approval
  const editedHash = evaluateActionGateway({
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    actorUid: 'uid_owner',
    actorType: 'human',
    member: ownerMember,
    actionType: 'publish_post',
    platform: 'instagram',
    contentFormat: 'single_image',
    payloadHash: 'hash_EDITED_999',
    idempotencyKey: 'idem_3',
    account: connectedIgAccount,
    approval: validHumanApproval,
    autonomyPolicy: modeB,
    emergencyStop: emergencyOk,
    qualityCheck: passedQa,
  });
  assert.equal(editedHash.allowed, false);
  assert.equal(editedHash.code, 'APPROVAL_INVALIDATED');

  // 4. AI self-approval blocked (decidedByUid prefixed with ai_agent or matches agent uid)
  const aiSelfApproved: ApprovalRequestRecord = {
    ...validHumanApproval,
    requestedByUid: 'agent_publisher',
    requestedByType: 'ai_agent',
    decidedByUid: 'ai_agent:publisher',
  };
  const aiSelfBlock = evaluateActionGateway({
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    actorUid: 'ai_agent:publisher',
    actorType: 'ai_agent',
    member: ownerMember,
    actionType: 'publish_post',
    platform: 'instagram',
    contentFormat: 'single_image',
    payloadHash: 'hash_abc123456789',
    idempotencyKey: 'idem_4',
    account: connectedIgAccount,
    approval: aiSelfApproved,
    autonomyPolicy: modeB,
    emergencyStop: emergencyOk,
    qualityCheck: passedQa,
  });
  assert.equal(aiSelfBlock.allowed, false);

  // 5. Expired approval blocked
  const expiredApproval: ApprovalRequestRecord = {
    ...validHumanApproval,
    expiresAt: '2020-01-01T00:00:00.000Z',
  };
  const expiredRes = evaluateActionGateway({
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    actorUid: 'uid_owner',
    actorType: 'human',
    member: ownerMember,
    actionType: 'publish_post',
    platform: 'instagram',
    contentFormat: 'single_image',
    payloadHash: 'hash_abc123456789',
    idempotencyKey: 'idem_5',
    account: connectedIgAccount,
    approval: expiredApproval,
    autonomyPolicy: modeB,
    emergencyStop: emergencyOk,
    qualityCheck: passedQa,
  });
  assert.equal(expiredRes.allowed, false);

  // 6. Cross-workspace approval blocked
  const wrongWsApproval: ApprovalRequestRecord = {
    ...validHumanApproval,
    workspaceId: 'ws_OTHER',
  };
  const wrongWsRes = evaluateActionGateway({
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    actorUid: 'uid_owner',
    actorType: 'human',
    member: ownerMember,
    actionType: 'publish_post',
    platform: 'instagram',
    contentFormat: 'single_image',
    payloadHash: 'hash_abc123456789',
    idempotencyKey: 'idem_6',
    account: connectedIgAccount,
    approval: wrongWsApproval,
    autonomyPolicy: modeB,
    emergencyStop: emergencyOk,
    qualityCheck: passedQa,
  });
  assert.equal(wrongWsRes.allowed, false);

  // 7. Global Emergency Stop blocks immediately even with valid approval
  const emergencyStopped = { ...emergencyOk, globalStopped: true, reason: 'Crisis pause' };
  const stoppedRes = evaluateActionGateway({
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    actorUid: 'uid_owner',
    actorType: 'human',
    member: ownerMember,
    actionType: 'publish_post',
    platform: 'instagram',
    contentFormat: 'single_image',
    payloadHash: 'hash_abc123456789',
    idempotencyKey: 'idem_7',
    account: connectedIgAccount,
    approval: validHumanApproval,
    autonomyPolicy: modeB,
    emergencyStop: emergencyStopped,
    qualityCheck: passedQa,
  });
  assert.equal(stoppedRes.allowed, false);
  assert.equal(stoppedRes.code, 'EMERGENCY_STOP_ACTIVE');
});

test('Central Action Gateway: Mode A, Mode C allowlists/daily caps/sensitive topics, and Paid Spend owner guard', () => {
  const emergencyOk = createDefaultEmergencyStopState('ws_1');

  // Mode A DRAFT_ONLY blocks publishing
  const modeA: BrandAutonomyPolicy = {
    ...createDefaultAutonomyPolicy('ws_1', 'brand_1', 'uid_owner'),
    publishingMode: 'DRAFT_ONLY',
  };
  const modeARes = evaluateActionGateway({
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    actorUid: 'uid_owner',
    actorType: 'human',
    member: ownerMember,
    actionType: 'publish_post',
    platform: 'instagram',
    contentFormat: 'single_image',
    payloadHash: 'hash_abc123456789',
    idempotencyKey: 'idem_mode_a',
    account: connectedIgAccount,
    approval: validHumanApproval,
    autonomyPolicy: modeA,
    emergencyStop: emergencyOk,
    qualityCheck: passedQa,
  });
  assert.equal(modeARes.allowed, false);
  assert.equal(modeARes.code, 'AUTONOMY_POLICY_BLOCKED');

  // Mode C allows allowlisted platform/format under daily cap
  const modeC: BrandAutonomyPolicy = {
    ...createDefaultAutonomyPolicy('ws_1', 'brand_1', 'uid_owner'),
    publishingMode: 'AUTHORIZED_AUTO_PUBLISHING',
    allowedAutoPlatforms: ['instagram'],
    allowedAutoFormats: ['single_image'],
    maxAutoPostsPerDay: 2,
  };
  const modeCAllowed = evaluateActionGateway({
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    actorUid: 'agent_1',
    actorType: 'ai_agent',
    member: ownerMember,
    actionType: 'publish_post',
    platform: 'instagram',
    contentFormat: 'single_image',
    payloadHash: 'hash_auto_1',
    idempotencyKey: 'idem_mode_c_1',
    account: connectedIgAccount,
    approval: null,
    autonomyPolicy: modeC,
    emergencyStop: emergencyOk,
    qualityCheck: passedQa,
    todayAutoPublishCount: 1,
    isSensitiveTopic: false,
  });
  assert.equal(modeCAllowed.allowed, true);
  assert.equal(modeCAllowed.executionMode, 'authorized_autonomous');

  // Mode C blocks once daily cap reached
  const modeCCapExceeded = evaluateActionGateway({
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    actorUid: 'agent_1',
    actorType: 'ai_agent',
    member: ownerMember,
    actionType: 'publish_post',
    platform: 'instagram',
    contentFormat: 'single_image',
    payloadHash: 'hash_auto_2',
    idempotencyKey: 'idem_mode_c_2',
    account: connectedIgAccount,
    approval: null,
    autonomyPolicy: modeC,
    emergencyStop: emergencyOk,
    qualityCheck: passedQa,
    todayAutoPublishCount: 2,
    isSensitiveTopic: false,
  });
  assert.equal(modeCCapExceeded.allowed, false);
  assert.equal(modeCCapExceeded.code, 'AUTONOMY_POLICY_BLOCKED');

  // Paid Ads spend without owner authorization & budget cap blocked
  const disabledBudget: CampaignBudgetPolicy = {
    id: 'brand_1',
    schemaVersion: '4.0.0',
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    currency: 'INR',
    enabled: false,
    maxDailySpend: null,
    maxMonthlySpend: null,
    requireExplicitOwnerApprovalForLaunch: true,
    updatedBy: 'uid_owner',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  assert.throws(
    () => assertMetaAdsSpendNotBypassed(disabledBudget),
    (err: unknown) =>
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'PAID_SPEND_NOT_AUTHORIZED',
  );

  const dryRunFail = validateMetaAdCampaignDryRun(
    {
      name: 'Test',
      dailyBudget: 5000,
      totalBudget: 50000,
      currency: 'INR',
      audienceSummary: 'Industrial workshops across India',
    },
    disabledBudget,
  );
  assert.equal(dryRunFail.canLaunchLive, false);
  assert.ok(dryRunFail.blockingReason);

  const overCapFail = validateMetaAdCampaignDryRun(
    {
      name: 'Over Cap',
      dailyBudget: 5000,
      totalBudget: 50000,
      currency: 'INR',
      audienceSummary: 'Industrial workshops across India',
    },
    {
      ...disabledBudget,
      enabled: true,
      maxDailySpend: 1000,
      maxMonthlySpend: 20000,
      ownerAuthorizedByUid: 'uid_owner',
    },
  );
  assert.equal(overCapFail.valid, false);
  assert.equal(overCapFail.canLaunchLive, false);
});

test('Publishing Adapters & Capability Matrix: validates all 8 providers, platform rules, and PUBLISH_STATUS_UNKNOWN reconciliation', async () => {
  const matrix = buildPhase4CapabilityMatrix([]);
  assert.equal(matrix.length, 8);

  // Instagram rejects text-only post
  const igAdapter = getSocialPublishingAdapter('instagram');
  const igTextVal = igAdapter.validatePayload(connectedIgAccount, {
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    contentItemId: 'cnt_1',
    title: 'Hello',
    format: 'text_post',
    caption: 'Hello world',
    hashtags: [],
    mediaAssets: [],
    idempotencyKey: 'k1',
  });
  assert.equal(igTextVal.valid, false);
  assert.equal(igTextVal.code, 'CAPABILITY_UNSUPPORTED');

  // YouTube requires video media
  const ytAdapter = new YouTubeAdapter();
  const ytAccount: ConnectedSocialAccount = {
    ...connectedIgAccount,
    provider: 'youtube',
    grantedScopes: ['https://www.googleapis.com/auth/youtube.upload'],
  };
  const ytNoVideo = ytAdapter.validatePayload(ytAccount, {
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    contentItemId: 'cnt_2',
    title: 'Demo video',
    format: 'youtube_video',
    caption: 'Demo video',
    hashtags: [],
    mediaAssets: [],
    idempotencyKey: 'k2',
  });
  assert.equal(ytNoVideo.valid, false);

  // LinkedIn adapter enforces required scopes
  const liAdapter = new LinkedInAdapter();
  const liMissingScope = liAdapter.validatePayload(
    { ...connectedIgAccount, provider: 'linkedin', grantedScopes: ['openid'] },
    {
      workspaceId: 'ws_1',
      brandId: 'brand_1',
      contentItemId: 'cnt_3',
      title: 'Update',
      format: 'text_post',
      caption: 'LinkedIn update',
      hashtags: [],
      mediaAssets: [],
      idempotencyKey: 'k3',
    },
  );
  assert.equal(liMissingScope.valid, false);
  assert.equal(liMissingScope.code, 'PERMISSION_MISSING');

  // TikTok blocks public direct post on unaudited apps
  const ttAdapter = new TikTokAdapter();
  const ttUnaudited = ttAdapter.validatePayload(
    {
      ...connectedIgAccount,
      provider: 'tiktok',
      unauditedAppWarning: true,
      grantedScopes: ['video.publish', 'video.upload'],
    },
    {
      workspaceId: 'ws_1',
      brandId: 'brand_1',
      contentItemId: 'cnt_4',
      title: 'Clip',
      format: 'short_video',
      caption: 'TikTok clip',
      hashtags: [],
      mediaAssets: [
        {
          id: 'ast_v1',
          schemaVersion: '4.0.0',
          workspaceId: 'ws_1',
          fileName: 'clip.mp4',
          mimeType: 'video/mp4',
          mediaKind: 'video',
          sizeBytes: 1_000_000,
          sha256: 'a'.repeat(64),
          storagePath: 'workspaces/ws_1/clip.mp4',
          source: 'upload',
          processingState: 'validated',
          validationErrors: [],
          compatiblePlatforms: ['tiktok'],
          createdBy: 'u1',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      idempotencyKey: 'k4',
      visibility: 'public',
    },
  );
  assert.equal(ttUnaudited.valid, false);

  // GBP blocks when GBP API access is under review
  const gbpAdapter = new GoogleBusinessProfileAdapter();
  const gbpNotApproved = gbpAdapter.validatePayload(
    {
      ...connectedIgAccount,
      provider: 'google_business_profile',
      gbpAccessState: 'access_under_review',
      grantedScopes: ['https://www.googleapis.com/auth/business.manage'],
    },
    {
      workspaceId: 'ws_1',
      brandId: 'brand_1',
      contentItemId: 'cnt_5',
      title: 'Hours',
      format: 'gbp_update',
      caption: 'Workshop hours update',
      hashtags: [],
      mediaAssets: [],
      idempotencyKey: 'k5',
    },
  );
  assert.equal(gbpNotApproved.valid, false);

  // Isolated test-only mock adapter confirms PUBLISH_STATUS_UNKNOWN + reconciliation
  const ambiguousMock = createTestOnlyMockPublishingAdapter('linkedin', {
    mode: 'publish_status_unknown',
  });
  const res = await ambiguousMock.publish(connectedIgAccount, 'test_tok', {
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    contentItemId: 'cnt_6',
    title: 'Test',
    format: 'text_post',
    caption: 'Test',
    hashtags: [],
    mediaAssets: [],
    idempotencyKey: 'k6',
  });
  assert.equal(res.status, 'publish_status_unknown');
  assert.equal(res.reconciliationRequired, true);
  const reconciled = await ambiguousMock.reconcilePublishStatus(
    connectedIgAccount,
    'test_tok',
    { idempotencyKey: 'k6', containerId: res.providerContainerId },
  );
  assert.equal(reconciled.reconciled, true);
  assert.equal(reconciled.existsOnProvider, 'confirmed_published');
});
