import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AnalyticsSnapshotRecord,
  PerformanceExperimentRecord,
  ScheduledPostRecord,
} from '../src/types/domain';
import {
  cancelScheduledPostsForDisconnectedAccount,
  claimScheduledPostLease,
  computeRetryOrDeadLetterTransition,
  detectDuplicateScheduledPost,
  formatUtcInTimezone,
  isValidIanaTimezone,
  selectDueScheduledPosts,
} from '../src/lib/marketing/scheduler';
import {
  canPerformExternalLeadOutreach,
  classifyReviewFeedback,
  computeWebhookDedupeKey,
  detectSensitiveTopic,
  draftBrandSafeReviewReply,
  validateMessagingWindow,
  verifyMetaWebhookSignature,
  verifyTikTokWebhookSignature,
} from '../src/lib/marketing/inbox-reviews-leads';
import {
  aggregateAnalyticsSnapshots,
  buildAnalyticsSnapshotDedupeKey,
  evaluateExperimentAndBuildCandidateMemory,
  validateAnalyticsSnapshotInput,
} from '../src/lib/marketing/analytics-optimizer';
import { PHASE_4_MARKETING_APPS_SCRIPT_TEMPLATES } from '../src/lib/google/marketing-templates';

const baseScheduledPost: ScheduledPostRecord = {
  id: 'sch_1',
  schemaVersion: '4.0.0',
  workspaceId: 'ws_1',
  brandId: 'brand_1',
  contentItemId: 'cnt_1',
  platform: 'instagram',
  accountId: 'sacc_1',
  scheduledForUtc: '2026-05-01T08:00:00.000Z',
  timezone: 'Asia/Kolkata',
  status: 'scheduled',
  payloadHash: 'hash_sch_1',
  idempotencyKey: 'idem_sch_1',
  attemptCount: 0,
  maxAttempts: 3,
  reconciliationRequired: false,
  createdBy: 'uid_1',
  createdAt: '2026-05-01T06:00:00.000Z',
  updatedAt: '2026-05-01T06:00:00.000Z',
};

test('Scheduler: due/future selection, concurrent lease claiming, expired lease recovery, retry/dead-letter, disconnect auto-cancel, and IANA timezone DST', () => {
  assert.equal(isValidIanaTimezone('Asia/Kolkata'), true);
  assert.equal(isValidIanaTimezone('America/New_York'), true);
  assert.equal(isValidIanaTimezone('Invalid/Mars_Zone'), false);

  const formatted = formatUtcInTimezone('2026-03-08T07:30:00.000Z', 'America/New_York');
  assert.ok(formatted.formatted.length > 5);

  // Due vs future jobs
  const futurePost: ScheduledPostRecord = {
    ...baseScheduledPost,
    id: 'sch_future',
    scheduledForUtc: '2026-05-01T12:00:00.000Z',
  };
  const selection = selectDueScheduledPosts(
    [baseScheduledPost, futurePost],
    '2026-05-01T08:05:00.000Z',
  );
  assert.equal(selection.dueForExecution.length, 1);
  assert.equal(selection.dueForExecution[0].id, 'sch_1');

  // Duplicate scheduled post detection
  assert.ok(
    detectDuplicateScheduledPost([baseScheduledPost], {
      contentItemId: 'cnt_1',
      platform: 'instagram',
      accountId: 'sacc_1',
      scheduledForUtc: '2026-05-01T08:00:00.000Z',
    }),
  );

  // Lease claiming blocks concurrent second worker, allows recovery after expiry
  const claim1 = claimScheduledPostLease(baseScheduledPost, 'worker_a', '2026-05-01T08:05:00.000Z', 60_000);
  assert.equal(claim1.claimed, true);
  assert.ok(claim1.updated);

  const concurrentClaim = claimScheduledPostLease(claim1.updated, 'worker_b', '2026-05-01T08:05:30.000Z', 60_000);
  assert.equal(concurrentClaim.claimed, false);

  const recoveredClaim = claimScheduledPostLease(claim1.updated, 'worker_b', '2026-05-01T08:07:00.000Z', 60_000);
  assert.equal(recoveredClaim.claimed, true);
  assert.equal(recoveredClaim.updated?.leaseOwner, 'worker_b');

  // Retry -> Dead-letter -> Ambiguous reconciliation protection
  const retryableNext = computeRetryOrDeadLetterTransition(
    claim1.updated,
    { errorCode: 'RATE_LIMITED', errorMessage: '429', retryable: true },
    '2026-05-01T08:05:10.000Z',
  );
  assert.equal(retryableNext.status, 'scheduled');

  const deadLetter = computeRetryOrDeadLetterTransition(
    { ...claim1.updated, attemptCount: 3, maxAttempts: 3 },
    { errorCode: 'PROVIDER_TEMPORARY_ERROR', errorMessage: '503', retryable: true },
    '2026-05-01T08:05:10.000Z',
  );
  assert.equal(deadLetter.status, 'dead_letter');

  const unknownTransition = computeRetryOrDeadLetterTransition(
    claim1.updated,
    { errorCode: 'PUBLISH_STATUS_UNKNOWN', errorMessage: 'Timeout after commit', retryable: false, reconciliationRequired: true },
    '2026-05-01T08:05:10.000Z',
  );
  assert.equal(unknownTransition.status, 'publish_status_unknown');
  assert.equal(claimScheduledPostLease(unknownTransition, 'worker_c', '2026-05-01T09:00:00.000Z').claimed, false);

  // Account disconnect cancels pending scheduled jobs
  const cancelled = cancelScheduledPostsForDisconnectedAccount([baseScheduledPost], 'sacc_1');
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].status, 'cancelled');
});

test('Webhooks, Social Inbox, Reviews (8 categories), and Leads consent provenance', () => {
  // Meta HMAC verification
  const rawMeta = JSON.stringify({ object: 'instagram', entry: [{ id: '123', time: 1700000000 }] });
  const metaSecret = 'test_meta_app_secret';
  const validMetaSig = `sha256=${crypto.createHmac('sha256', metaSecret).update(rawMeta).digest('hex')}`;
  assert.equal(verifyMetaWebhookSignature(rawMeta, validMetaSig, metaSecret).valid, true);
  assert.equal(verifyMetaWebhookSignature(rawMeta, 'sha256=deadbeef', metaSecret).valid, false);

  // TikTok HMAC verification
  const rawTt = JSON.stringify({ event: 'video.publish.complete', event_id: 'tt_evt_1' });
  const ttSecret = 'test_tiktok_secret';
  const ts = '1700000000';
  const validTtSig = `t=${ts},s=${crypto.createHmac('sha256', ttSecret).update(`${ts}.${rawTt}`).digest('hex')}`;
  assert.equal(verifyTikTokWebhookSignature(rawTt, validTtSig, ttSecret).valid, true);
  assert.equal(verifyTikTokWebhookSignature(rawTt, 't=1,s=0000', ttSecret).valid, false);

  // Dedupe keys deterministic
  assert.equal(
    computeWebhookDedupeKey('meta', rawMeta, '123:1700000000'),
    computeWebhookDedupeKey('meta', rawMeta, '123:1700000000'),
  );

  // Messaging windows: 24h open vs expired vs 72h click-to-message
  const open24h = validateMessagingWindow(
    {
      platform: 'instagram',
      channelType: 'dm',
      messagingWindowType: 'standard_24h',
      messagingWindowExpiresAt: '2026-05-02T00:00:00.000Z',
      lastMessageAt: '2026-05-01T00:00:00.000Z',
    },
    '2026-05-01T12:00:00.000Z',
  );
  assert.equal(open24h.allowed, true);

  const expired24h = validateMessagingWindow(
    {
      platform: 'instagram',
      channelType: 'dm',
      messagingWindowType: 'standard_24h',
      messagingWindowExpiresAt: '2026-05-01T05:00:00.000Z',
      lastMessageAt: '2026-04-30T05:00:00.000Z',
    },
    '2026-05-01T12:00:00.000Z',
  );
  assert.equal(expired24h.allowed, false);

  const openClickToMsg = validateMessagingWindow(
    {
      platform: 'facebook',
      channelType: 'dm',
      messagingWindowType: 'click_to_message_ad',
      messagingWindowExpiresAt: '2026-05-04T00:00:00.000Z',
      lastMessageAt: '2026-05-01T00:00:00.000Z',
    },
    '2026-05-03T12:00:00.000Z',
  );
  assert.equal(openClickToMsg.allowed, true);

  // Sensitive topic detection
  assert.equal(detectSensitiveTopic('I am going to consumer forum and my lawyer for a refund').sensitive, true);
  assert.equal(detectSensitiveTopic('What is the price of the 250A model?').sensitive, false);

  // 8-Category Review classification + escalation
  const defectReview = classifyReviewFeedback(1, 'The unit arrived defective and stopped working after 1 day.');
  assert.equal(defectReview.escalationRequired, true);
  const praiseReview = classifyReviewFeedback(5, 'Excellent welding performance and helpful dealer team.');
  assert.equal(praiseReview.category, 'praise');
  assert.equal(praiseReview.escalationRequired, false);
  const safeReply = draftBrandSafeReviewReply({
    brandName: 'GreenWeld',
    reviewerName: 'Arjun',
    rating: 1,
    category: defectReview.category,
  });
  assert.ok(safeReply.includes('GreenWeld'));

  // Leads consent enforcement
  assert.equal(canPerformExternalLeadOutreach({ consentStatus: 'opted_out', stage: 'QUALIFIED' }).allowed, false);
  assert.equal(canPerformExternalLeadOutreach({ consentStatus: 'unconfirmed', stage: 'NEW' }).allowed, false);
  assert.equal(canPerformExternalLeadOutreach({ consentStatus: 'explicit_opt_in', stage: 'QUALIFIED' }).allowed, true);
});

test('Analytics null-preservation, currency separation, ROAS omission, Experiments -> Phase 3 memory, and 8 Apps Script templates + Firestore rules parity', () => {
  // Invalid period rejected
  const invalidPeriod = validateAnalyticsSnapshotInput({
    periodStart: '2026-05-10T00:00:00.000Z',
    periodEnd: '2026-05-01T00:00:00.000Z',
    existingSnapshots: [],
    dedupeKey: 'dk_1',
    spendAmount: null,
    revenueAmount: null,
  });
  assert.equal(invalidPeriod.valid, false);

  // Spend without currency rejected
  const missingCurrency = validateAnalyticsSnapshotInput({
    periodStart: '2026-05-01T00:00:00.000Z',
    periodEnd: '2026-05-07T00:00:00.000Z',
    existingSnapshots: [],
    dedupeKey: 'dk_2',
    spendAmount: 1500,
    revenueAmount: null,
  });
  assert.equal(missingCurrency.valid, false);

  // Null-preserving aggregation & currency separation & ROAS omitted when no revenue
  const snapInr: AnalyticsSnapshotRecord = {
    id: 'an_1',
    schemaVersion: '4.0.0',
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    platform: 'instagram',
    contentItemId: 'cnt_variant',
    periodStart: '2026-05-01T00:00:00.000Z',
    periodEnd: '2026-05-07T00:00:00.000Z',
    collectedAt: '2026-05-07T01:00:00.000Z',
    timezone: 'Asia/Kolkata',
    sourceApi: 'instagram_graph_v21',
    attributionNote: 'Post insights',
    dedupeKey: buildAnalyticsSnapshotDedupeKey({
      workspaceId: 'ws_1',
      brandId: 'brand_1',
      platform: 'instagram',
      contentItemId: 'cnt_variant',
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-07T00:00:00.000Z',
    }),
    units: { currency: 'INR', engagementDefinition: 'likes+comments+shares+saves' },
    metrics: {
      impressions: 5000,
      reach: null,
      engagements: 320,
      clicks: null,
      videoViews: null,
      followersDelta: null,
      leadsAttributed: 14,
      spendAmount: 2000,
      revenueAmount: null,
    },
  };

  const snapUsd: AnalyticsSnapshotRecord = {
    ...snapInr,
    id: 'an_2',
    contentItemId: 'cnt_control',
    units: { currency: 'USD', engagementDefinition: 'likes+comments+shares+saves' },
    metrics: {
      ...snapInr.metrics,
      impressions: 3000,
      engagements: 180,
      spendAmount: 50,
      revenueAmount: null,
    },
  };

  const agg = aggregateAnalyticsSnapshots([snapInr, snapUsd]);
  assert.equal(agg.impressions, 8000);
  assert.equal(agg.reach, null);
  assert.equal(agg.clicks, null);
  assert.equal(agg.spendByCurrency.INR, 2000);
  assert.equal(agg.spendByCurrency.USD, 50);
  assert.equal(agg.roasByCurrency.INR, null);

  // Experiment evaluation produces Phase 3 candidate memory
  const exp: PerformanceExperimentRecord = {
    id: 'exp_1',
    schemaVersion: '4.0.0',
    workspaceId: 'ws_1',
    brandId: 'brand_1',
    title: 'Technical Spec Hook vs Generic Hook',
    hypothesis: 'Duty-cycle specs earn more engagements than generic slogans.',
    platform: 'instagram',
    primaryMetric: 'engagements',
    controlContentId: 'cnt_control',
    variantContentId: 'cnt_variant',
    minSampleSize: 100,
    observedControlValue: null,
    observedVariantValue: null,
    confidenceNote: 'Pending evaluation',
    status: 'running',
    createdBy: 'uid_1',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };
  const evaluation = evaluateExperimentAndBuildCandidateMemory(exp, [snapInr, snapUsd], 'uid_1');
  assert.equal(evaluation.status, 'completed');
  assert.ok(evaluation.candidateMemory);
  assert.equal(evaluation.candidateMemory.status, 'candidate');

  // 8 Phase 4 Marketing Apps Script templates exist and build valid files
  assert.equal(PHASE_4_MARKETING_APPS_SCRIPT_TEMPLATES.length, 8);
  for (const tpl of PHASE_4_MARKETING_APPS_SCRIPT_TEMPLATES) {
    const files = tpl.buildFiles('Asia/Kolkata');
    assert.ok(files.some((f) => f.name === 'appsscript' && f.type === 'JSON'));
    assert.ok(files.some((f) => f.name === 'Code' && f.type === 'SERVER_JS'));
  }

  // Firestore rules parity between DRAFT_firestore.rules and firestore.rules
  const rootDir = process.cwd();
  const draftRules = fs.readFileSync(path.join(rootDir, 'DRAFT_firestore.rules'), 'utf8');
  const liveRules = fs.readFileSync(path.join(rootDir, 'firestore.rules'), 'utf8');
  assert.equal(draftRules, liveRules);
  assert.ok(liveRules.includes('scheduledPosts'));
  assert.ok(liveRules.includes('autonomyPolicies'));
  assert.ok(liveRules.includes('analyticsSnapshots'));
});
