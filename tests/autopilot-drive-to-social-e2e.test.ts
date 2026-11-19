import test from 'node:test';
import assert from 'node:assert/strict';

import { createDevelopmentTestStore } from '../src/lib/server/repositories';
import {
  listAutopilotEvents,
  listAutopilotFiles,
  listAutopilotJobs,
  performAutopilotFileAction,
  runAutopilotCycleForWorkspace,
  updateAutopilotPolicy,
} from '../src/lib/server/autopilot-repositories';
import {
  listDriveFolders,
  reconcileDriveSnapshot,
  verifyDriveFolderAccess,
  type RawDriveFileNode,
} from '../src/lib/autopilot/drive-monitor';
import {
  analyzeVideoAndGenerateMetadata,
  computeJaccardSimilarity,
  createTestOnlyMultimodalVideoAnalyzer,
  inspectVideoForPlatforms,
  type TestVideoMultimodalFixture,
} from '../src/lib/autopilot/video-analyzer';
import {
  claimAutopilotJobLease,
  computeNextEligibleSlots,
  getLocalDateKey,
  recalculateFutureSlotsAfterFailure,
  recoverStaleAutopilotLeases,
} from '../src/lib/autopilot/scheduler';
import {
  buildAutopilotDashboardCounts,
  executeAutopilotPublishJob,
} from '../src/lib/autopilot/engine';
import { createTestOnlyMockPublishingAdapter } from '../src/lib/marketing/providers/registry';
import { resolveScopesForCapabilities, GOOGLE_SCOPE } from '../src/lib/google/permissions';
import type { BrandKnowledgeFact, BrandProfile, ConnectedSocialAccount } from '../src/types/domain';
import type { AutopilotPolicy } from '../src/types/autopilot';

function createFakeDriveFetch(params: {
  rootFolderId: string;
  rootFolderName: string;
  subFolderId: string;
  subFolderName: string;
  rootFiles: RawDriveFileNode[];
  subFiles: RawDriveFileNode[];
}): typeof fetch {
  return (async (input: string | URL) => {
    const urlStr = typeof input === 'string' ? input : input.toString();
    const url = new URL(urlStr);

    if (url.pathname.endsWith(`/files/${params.rootFolderId}`)) {
      return new Response(
        JSON.stringify({
          id: params.rootFolderId,
          name: params.rootFolderName,
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false,
          capabilities: { canListChildren: true },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.pathname.endsWith('/changes/startPageToken')) {
      return new Response(JSON.stringify({ startPageToken: '10042' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname.endsWith('/files')) {
      const q = url.searchParams.get('q') || '';
      if (q.includes(`mimeType = 'application/vnd.google-apps.folder'`)) {
        return new Response(
          JSON.stringify({
            files: [
              {
                id: params.rootFolderId,
                name: params.rootFolderName,
                mimeType: 'application/vnd.google-apps.folder',
                capabilities: { canListChildren: true },
              },
              {
                id: params.subFolderId,
                name: params.subFolderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [params.rootFolderId],
                capabilities: { canListChildren: true },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (q.includes(`'${params.rootFolderId}' in parents`)) {
        return new Response(
          JSON.stringify({
            files: [
              ...params.rootFiles,
              {
                id: params.subFolderId,
                name: params.subFolderName,
                mimeType: 'application/vnd.google-apps.folder',
                trashed: false,
                capabilities: { canListChildren: true },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (q.includes(`'${params.subFolderId}' in parents`)) {
        return new Response(JSON.stringify({ files: params.subFiles }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ error: { message: `Unhandled URL: ${urlStr}` } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const FIVE_VIDEO_FIXTURES: Record<string, TestVideoMultimodalFixture> = {
  drv_vid_01: {
    visualScenes: [
      { timestampSeconds: 1, sceneType: 'hook', description: 'Close-up of TIG torch arc striking a clean stainless weld seam' },
      { timestampSeconds: 12, sceneType: 'demo', description: 'Technician adjusting pulse frequency knob to 2.5 Hz on inverter panel' },
    ],
    visualScenesSummary: 'Workshop technician demonstrates pulsing TIG welds on 2mm stainless steel tubing with zero burn-through.',
    transcript: 'When welding thin 2mm stainless tubing, switching to 2.5 Hz pulse keeps the heat-affected zone tight and prevents warping.',
    detectedLanguage: 'English',
    subject: 'Pulse TIG Welding Thin Stainless Steel',
    context: 'Industrial fabrication workshop demonstration',
    centralMessage: 'Use 2.5 Hz TIG pulse control to prevent burn-through on 2mm stainless steel tubing.',
  },
  drv_vid_02: {
    visualScenes: [
      { timestampSeconds: 1, sceneType: 'hook', description: 'Operator scanning MIG wire spool tension dial before production shift' },
      { timestampSeconds: 15, sceneType: 'demo', description: 'Steady copper-coated wire feeding smoothly through a 4-roll drive assembly' },
    ],
    visualScenesSummary: 'Step-by-step morning MIG feeder inspection checking drive roll tension and liner alignment.',
    transcript: 'Before your shift begins, run a two-finger pinch test on your MIG wire feed to stop bird-nesting mid-seam.',
    detectedLanguage: 'English',
    subject: 'Preventing MIG Wire Bird-Nesting',
    context: 'Preventive shop floor maintenance checklist',
    centralMessage: 'A 30-second drive roll tension check prevents costly MIG wire feed jams during production.',
  },
  drv_vid_03: {
    visualScenes: [
      { timestampSeconds: 2, sceneType: 'hook', description: 'Side-by-side comparison of auto-darkening helmet clarity under bright arc' },
      { timestampSeconds: 18, sceneType: 'demo', description: 'Welder switching shade 9 to shade 13 while inspecting puddle fluidity' },
    ],
    visualScenesSummary: 'True-color welding helmet optics test showing puddle visibility at 180 amps.',
    transcript: 'True-color optical filters reduce eye fatigue across eight-hour fabrication shifts by clarifying weld puddle edges.',
    detectedLanguage: 'English',
    subject: 'True-Color Auto-Darkening Welding Optics',
    context: 'Operator safety and visual ergonomics comparison',
    centralMessage: 'High-clarity optical filters improve puddle tracking and cut operator eye strain on long shifts.',
  },
  drv_vid_04: {
    visualScenes: [
      { timestampSeconds: 1, sceneType: 'hook', description: 'Plasma cutter slicing cleanly through 16mm mild steel plate' },
      { timestampSeconds: 20, sceneType: 'demo', description: 'Inspector measuring dross-free bevel edge with digital calipers' },
    ],
    visualScenesSummary: 'High-definition air plasma cutting 16mm mild steel with clean dross-free edges.',
    transcript: 'Dialing compressed air pressure to 5.5 bar and matching nozzle amperage eliminates slag grinding after plasma cuts.',
    detectedLanguage: 'English',
    subject: 'Dross-Free 16mm Plasma Steel Cutting',
    context: 'Heavy plate cutting throughput demonstration',
    centralMessage: 'Matching air pressure and nozzle amperage eliminates secondary slag grinding on 16mm steel.',
  },
  drv_vid_05: {
    visualScenes: [
      { timestampSeconds: 1, sceneType: 'hook', description: 'Thermal camera showing inverter heatsink cooling during 60% duty cycle test' },
      { timestampSeconds: 22, sceneType: 'demo', description: 'Engineer logging steady 250A output across continuous structural beam welds' },
    ],
    visualScenesSummary: 'Thermal imaging stress test validating inverter duty cycle stability at 40C ambient workshop temperature.',
    transcript: 'Always verify duty cycle ratings at 40 degrees Celsius, not 25 degrees, so your inverter holds arc stability in summer workshops.',
    detectedLanguage: 'English',
    subject: 'Evaluating Inverter Duty Cycle at 40C',
    context: 'Engineering lab reliability testing',
    centralMessage: 'Verify inverter duty cycle ratings at 40C ambient temperature for reliable heavy fabrication.',
  },
};

const FIVE_DRIVE_NODES: RawDriveFileNode[] = [
  {
    id: 'drv_vid_01',
    name: 'CLIP_001.mp4',
    mimeType: 'video/mp4',
    size: 8_400_000,
    md5Checksum: 'hash_vid_01',
    createdTime: '2026-04-06T08:00:00.000Z',
    modifiedTime: '2026-04-06T08:00:00.000Z',
    capabilities: { canDownload: true },
    videoMediaMetadata: { width: 1080, height: 1920, durationMillis: 34_000 },
  },
  {
    id: 'drv_vid_02',
    name: 'CLIP_002.mp4',
    mimeType: 'video/mp4',
    size: 9_100_000,
    md5Checksum: 'hash_vid_02',
    createdTime: '2026-04-06T08:05:00.000Z',
    modifiedTime: '2026-04-06T08:05:00.000Z',
    capabilities: { canDownload: true },
    videoMediaMetadata: { width: 1080, height: 1920, durationMillis: 41_000 },
  },
  {
    id: 'drv_vid_03',
    name: 'CLIP_003.mp4',
    mimeType: 'video/mp4',
    size: 7_900_000,
    md5Checksum: 'hash_vid_03',
    createdTime: '2026-04-06T08:10:00.000Z',
    modifiedTime: '2026-04-06T08:10:00.000Z',
    capabilities: { canDownload: true },
    videoMediaMetadata: { width: 1080, height: 1920, durationMillis: 38_000 },
  },
  {
    id: 'drv_vid_04',
    name: 'CLIP_004.mp4',
    mimeType: 'video/mp4',
    size: 11_200_000,
    md5Checksum: 'hash_vid_04',
    createdTime: '2026-04-06T08:15:00.000Z',
    modifiedTime: '2026-04-06T08:15:00.000Z',
    capabilities: { canDownload: true },
    videoMediaMetadata: { width: 1080, height: 1920, durationMillis: 45_000 },
  },
];

const SUBFOLDER_NODES: RawDriveFileNode[] = [
  {
    id: 'drv_vid_05',
    name: 'CLIP_005.mp4',
    mimeType: 'video/mp4',
    size: 10_500_000,
    md5Checksum: 'hash_vid_05',
    createdTime: '2026-04-06T08:20:00.000Z',
    modifiedTime: '2026-04-06T08:20:00.000Z',
    capabilities: { canDownload: true },
    videoMediaMetadata: { width: 1080, height: 1920, durationMillis: 52_000 },
  },
  {
    // Duplicate of drv_vid_01 with different filename & Drive ID, identical md5Checksum!
    id: 'drv_vid_01_dup',
    name: 'CLIP_001_COPY_REUPLOAD.mp4',
    mimeType: 'video/mp4',
    size: 8_400_000,
    md5Checksum: 'hash_vid_01',
    createdTime: '2026-04-06T08:25:00.000Z',
    modifiedTime: '2026-04-06T08:25:00.000Z',
    capabilities: { canDownload: true },
    videoMediaMetadata: { width: 1080, height: 1920, durationMillis: 34_000 },
  },
  {
    // Unsupported file type should be gracefully classified without crashing the pipeline
    id: 'drv_doc_pdf',
    name: 'shoot_notes.pdf',
    mimeType: 'application/pdf',
    size: 420_000,
    md5Checksum: 'hash_pdf_01',
    createdTime: '2026-04-06T08:30:00.000Z',
    modifiedTime: '2026-04-06T08:30:00.000Z',
    capabilities: { canDownload: true },
  },
];

test('Drive-to-Social Autopilot 17-Step Acceptance Suite (Discovery, Multimodal Analysis, Uniqueness, Daily Cap Scheduling, Crash Recovery, Failure/Retry, Pause/Resume, Approval vs Auto-Publish, Dashboard Counts)', async () => {
  const store = createDevelopmentTestStore();
  const wsId = 'ws_autopilot_e2e';
  const ownerUid = 'uid_owner_e2e';
  const brandId = 'brand_magnarc_e2e';
  const nowIso = '2026-04-06T04:30:00.000Z'; // 10:00 AM Asia/Kolkata (Monday)

  // Step 1: Verify official Google Drive read-only OAuth scope registration
  const driveScopes = resolveScopesForCapabilities(['google_identity', 'drive_autopilot_read']);
  assert.ok(driveScopes.includes(GOOGLE_SCOPE.DRIVE_READONLY), 'drive.readonly scope must be registered');

  // Seed workspace, owner membership, brand, verified brand facts, and two connected accounts
  await store.commit([
    {
      path: `workspaces/${wsId}`,
      data: {
        id: wsId,
        name: 'MAGNARC Production Workspace',
        timezone: 'Asia/Kolkata',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
    {
      path: `workspaces/${wsId}/members/${ownerUid}`,
      data: {
        id: ownerUid,
        workspaceId: wsId,
        uid: ownerUid,
        email: 'owner@magnarc.test',
        role: 'owner',
        status: 'active',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    },
  ]);

  const brand: BrandProfile = {
    id: brandId,
    workspaceId: wsId,
    name: 'MAGNARC Welding Systems',
    slug: 'magnarc-welding',
    industry: 'Industrial Welding Equipment',
    description: 'Precision inverter welding & plasma cutting machines engineered for Indian fabrication shops.',
    targetAudience: 'Fabrication workshop owners, welding engineers, and industrial operators',
    brandVoice: 'Practical, technical, shop-floor authentic, zero hype',
    contentPillars: ['TIG Welding', 'MIG Maintenance', 'Plasma Cutting'],
    primaryColor: '#1D4ED8',
    restrictions: 'Never invent pricing or unverified warranty guarantees.',
    starterKey: 'magnarc',
    status: 'active',
    createdBy: ownerUid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const brandFact: BrandKnowledgeFact = {
    id: 'bf_magnarc_40c',
    workspaceId: wsId,
    brandId,
    category: 'technical_capabilities',
    title: '40C Rated Industrial Inverters',
    statement: 'All MAGNARC industrial inverters are rated and tested at 40 degrees Celsius ambient workshop temperature.',
    verificationStatus: 'VERIFIED',
    approvalStatus: 'approved',
    confidence: 1,
    provenanceType: 'human_entered',
    sourceIds: [],
    createdBy: ownerUid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const authorizedIgAccount: ConnectedSocialAccount = {
    id: 'acc_ig_test_auth',
    schemaVersion: '4.0.0',
    workspaceId: wsId,
    brandId,
    provider: 'instagram',
    externalAccountId: 'ig_biz_999',
    displayName: 'MAGNARC Official Reels (Test Sandbox)',
    handle: '@magnarc_test',
    status: 'connected',
    readinessState: 'connected',
    grantedScopes: ['instagram_basic', 'instagram_content_publish', 'pages_show_list', 'pages_read_engagement'],
    capabilities: ['reel', 'short_video'],
    unsupportedCapabilities: [],
    tokenExpiresAt: '2026-12-31T00:00:00.000Z',
    hasRefreshToken: true,
    encryptedCredentialId: 'cred_ig_test',
    connectedBy: ownerUid,
    connectedAt: nowIso,
    updatedAt: nowIso,
  };

  const unauthorizedYtAccount: ConnectedSocialAccount = {
    id: 'acc_yt_unauth_auto',
    schemaVersion: '4.0.0',
    workspaceId: wsId,
    brandId,
    provider: 'youtube',
    externalAccountId: 'yt_ch_888',
    displayName: 'MAGNARC YouTube (Manual Approval Only)',
    handle: '@magnarc_yt_test',
    status: 'connected',
    readinessState: 'connected',
    grantedScopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
    capabilities: ['youtube_short', 'youtube_video'],
    unsupportedCapabilities: [],
    tokenExpiresAt: '2026-12-31T00:00:00.000Z',
    hasRefreshToken: true,
    encryptedCredentialId: 'cred_yt_test',
    connectedBy: ownerUid,
    connectedAt: nowIso,
    updatedAt: nowIso,
  };

  await store.commit([
    { path: `workspaces/${wsId}/brands/${brandId}`, data: brand as unknown as Record<string, unknown> },
    { path: `workspaces/${wsId}/brandKnowledge/${brandFact.id}`, data: brandFact as unknown as Record<string, unknown> },
    { path: `workspaces/${wsId}/socialAccounts/${authorizedIgAccount.id}`, data: authorizedIgAccount as unknown as Record<string, unknown> },
    { path: `workspaces/${wsId}/socialAccounts/${unauthorizedYtAccount.id}`, data: unauthorizedYtAccount as unknown as Record<string, unknown> },
  ]);

  // Step 2: Verify Drive Folder Picker & folder access with fake Drive API fetch
  const fakeDriveFetch = createFakeDriveFetch({
    rootFolderId: 'folder_root_magnarc',
    rootFolderName: 'MAGNARC Raw Reels Drop',
    subFolderId: 'folder_sub_week1',
    subFolderName: 'Week 01',
    rootFiles: FIVE_DRIVE_NODES,
    subFiles: SUBFOLDER_NODES,
  });

  const pickerList = await listDriveFolders({
    accessToken: 'test_google_drive_token',
    fetchImpl: fakeDriveFetch,
  });
  assert.equal(pickerList.length, 2, 'Drive Folder Picker must list accessible folders');

  const verifiedFolder = await verifyDriveFolderAccess({
    accessToken: 'test_google_drive_token',
    folderId: 'folder_root_magnarc',
    fetchImpl: fakeDriveFetch,
  });
  assert.equal(verifiedFolder.name, 'MAGNARC Raw Reels Drop');

  // Create Autopilot Policy (start in APPROVAL_REQUIRED to verify approval gate first!)
  const policyId = 'appol_e2e_01';
  const policy: AutopilotPolicy = {
    id: policyId,
    schemaVersion: '5.1.0',
    workspaceId: wsId,
    brandId,
    name: 'MAGNARC Reels Autopilot',
    googleConnectionId: 'gconn_test_drive',
    sourceFolderId: 'folder_root_magnarc',
    sourceFolderName: 'MAGNARC Raw Reels Drop',
    includeSubfolders: true,
    maxSubfolderDepth: 3,
    destinationAccountIds: [authorizedIgAccount.id],
    allowedFormats: ['reel', 'youtube_short', 'short_video'],
    maxPostsPerDay: 2, // Strict cap of 2 posts per day
    minGapMinutes: 180, // 3 hours minimum gap
    publishingDays: [1, 2, 3, 4, 5, 6],
    dailyTimeWindows: [{ startHour: 10, startMinute: 0, endHour: 20, endMinute: 0 }],
    timezone: 'Asia/Kolkata',
    orderingMode: 'chronological',
    language: 'English',
    captionStyle: 'Shop-floor technical and grounded',
    hashtagStrategy: 'balanced',
    maxHashtags: 6,
    executionMode: 'APPROVAL_REQUIRED',
    authorizedAutoPublishAccountIds: [],
    duplicatePrevention: {
      byDriveFileId: true,
      byContentHash: true,
      allowExplicitReprocess: true,
    },
    maxProcessingCostUsdPerDay: 5,
    failurePolicy: {
      maxRetries: 2,
      pauseOnAuthExpired: true,
      pauseOnPolicyViolation: true,
      pauseOnCostExceeded: true,
    },
    status: 'active',
    createdBy: ownerUid,
    updatedBy: ownerUid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await store.commit([
    {
      path: `workspaces/${wsId}/autopilotPolicies/${policyId}`,
      data: policy as unknown as Record<string, unknown>,
    },
  ]);

  // Step 3–6: Run Cycle 1 -> Discover 5 videos + skip 1 duplicate + classify 1 unsupported PDF + analyze all 5 + schedule
  const mockIgSuccess = createTestOnlyMockPublishingAdapter('instagram', { mode: 'success' });
  const testAnalyzer = createTestOnlyMultimodalVideoAnalyzer();

  const cycle1 = await runAutopilotCycleForWorkspace(store, wsId, {
    workerId: 'worker_boot_1',
    onlyPolicyId: policyId,
    nowIso,
    fetchImpl: fakeDriveFetch,
    googleAccessTokenOverride: 'test_google_drive_token',
    socialAccessTokenOverride: 'test_ig_token',
    analyzerAdapter: testAnalyzer,
    testMultimodalFixturesByDriveId: FIVE_VIDEO_FIXTURES,
    publishingAdapterByPlatform: { instagram: mockIgSuccess },
  });

  assert.equal(cycle1.discoveredNewCount, 5, 'Must discover all 5 distinct videos across root and subfolder');
  assert.equal(cycle1.duplicateSkippedCount, 1, 'Must skip duplicate video matching content hash');
  assert.equal(cycle1.analyzedCount, 5, 'Must analyze all 5 videos via multimodal pipeline');
  assert.equal(cycle1.scheduledCount, 5, 'Must queue 5 jobs (held awaiting approval in APPROVAL_REQUIRED mode)');
  assert.equal(cycle1.publishedCount, 0, 'APPROVAL_REQUIRED mode MUST NOT auto-publish without human approval');
  assert.equal(mockIgSuccess.callCount, 0, 'Provider publish adapter must not be called while awaiting approval');

  // Verify Anti-Filename-Only invariant directly
  const filesAfterCycle1 = await listAutopilotFiles(store, wsId, policyId);
  const firstVideoFile = filesAfterCycle1.find((f) => f.driveFileId === 'drv_vid_01')!;
  await assert.rejects(
    async () => {
      await analyzeVideoAndGenerateMetadata({
        file: firstVideoFile,
        policy,
        brand,
        brandFacts: [brandFact],
        targetPlatforms: ['instagram'],
        // Intentionally NO videoBytes, NO extractedFrames, NO testMultimodalFixture!
      });
    },
    (err: unknown) =>
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'VIDEO_MEDIA_REQUIRED_FOR_ANALYSIS',
    'Must refuse filename-only caption generation when video media is absent',
  );

  // Verify all 5 generated caption packages are genuinely unique (never repeating generic captions)
  const analyzedVideos = filesAfterCycle1.filter((f) => f.analysis !== null && f.generatedMetadata !== null);
  assert.equal(analyzedVideos.length, 5, 'All 5 videos must have multimodal analysis & metadata');
  for (let i = 0; i < analyzedVideos.length; i++) {
    const metaA = analyzedVideos[i].generatedMetadata!;
    assert.ok(metaA.contentTitle.length > 5 && metaA.openingHook.length > 10);
    assert.ok(metaA.instagramCaption.length > 30 && metaA.youtubeTitle.length > 5);
    assert.ok(metaA.youtubeDescription.length > 30 && metaA.suggestedThumbnailText.length > 2);
    // Ensure caption reflects actual video content rather than opaque filename CLIP_00X.mp4
    assert.ok(!metaA.contentTitle.includes('CLIP_00'), 'Title must describe actual video content, not opaque filename');
    for (let j = i + 1; j < analyzedVideos.length; j++) {
      const metaB = analyzedVideos[j].generatedMetadata!;
      const sim = computeJaccardSimilarity(metaA.instagramCaption, metaB.instagramCaption);
      assert.ok(sim < 0.72, `Captions for videos ${i + 1} and ${j + 1} must be unique (similarity=${sim})`);
      assert.notEqual(metaA.metadataFingerprint, metaB.metadataFingerprint);
    }
  }

  // Verify platform format inspection catches unsupported WebM on Instagram
  const webmIssues = inspectVideoForPlatforms(
    firstVideoFile.videoMetadata,
    'video/webm',
    firstVideoFile.sizeBytes,
    ['instagram'],
  );
  assert.ok(webmIssues.some((i) => i.code === 'IG_WEBM_UNSUPPORTED' && i.severity === 'error'));

  // Step 5 (Re-scan): Confirm unchanged videos are NEVER reprocessed twice
  const cycleRescan = await runAutopilotCycleForWorkspace(store, wsId, {
    workerId: 'worker_rescan',
    onlyPolicyId: policyId,
    nowIso,
    fetchImpl: fakeDriveFetch,
    googleAccessTokenOverride: 'test_google_drive_token',
    analyzerAdapter: testAnalyzer,
    testMultimodalFixturesByDriveId: FIVE_VIDEO_FIXTURES,
  });
  assert.equal(cycleRescan.discoveredNewCount, 0, 'Second scan must not rediscover unchanged videos');
  assert.equal(cycleRescan.analyzedCount, 0, 'Unchanged videos must never be re-analyzed twice');
  assert.equal(cycleRescan.scheduledCount, 0, 'Must never create duplicate scheduled jobs');

  // Step 8: Confirm daily-limit scheduling (max 2/day across 3 days: Day 1 = 2, Day 2 = 2, Day 3 = 1)
  const jobsAfterCycle1 = await listAutopilotJobs(store, wsId, policyId);
  assert.equal(jobsAfterCycle1.length, 5);
  const perDayCounts = new Map<string, number>();
  for (const j of jobsAfterCycle1) {
    const dayKey = getLocalDateKey(j.scheduledForUtc, 'Asia/Kolkata');
    perDayCounts.set(dayKey, (perDayCounts.get(dayKey) || 0) + 1);
  }
  for (const [dayKey, count] of perDayCounts.entries()) {
    assert.ok(count <= 2, `Day ${dayKey} scheduled ${count} posts, exceeding maxPostsPerDay=2`);
  }
  assert.equal(perDayCounts.size, 3, '5 videos at max 2/day must span exactly 3 calendar days');
  // Empty queue check: maxPostsPerDay is a CAP, never a forced promise
  assert.deepEqual(
    computeNextEligibleSlots({ policy, fromIsoUtc: nowIso, count: 0 }),
    [],
    'Zero eligible videos must schedule zero slots',
  );

  // Step 12: Verify APPROVAL_REQUIRED mode: edit caption invalidates approval, explicit approval unlocks publishing
  const approveRes = await performAutopilotFileAction(
    ownerUid,
    'owner@magnarc.test',
    wsId,
    firstVideoFile.id,
    { action: 'approve', note: 'Verified technical accuracy' },
    { store },
  );
  assert.equal(approveRes.file.status, 'scheduled', 'Approved video transitions to scheduled');

  // Now edit caption after approval -> MUST invalidate approval & move back to awaiting_approval!
  const editRes = await performAutopilotFileAction(
    ownerUid,
    'owner@magnarc.test',
    wsId,
    firstVideoFile.id,
    {
      action: 'edit_metadata',
      metadata: {
        contentTitle: 'Updated Pulse TIG Guide for 2mm Stainless',
      },
    },
    { store },
  );
  assert.equal(editRes.file.approvedPayloadHash, undefined, 'Editing caption must invalidate prior approval');
  assert.equal(editRes.file.status, 'awaiting_approval', 'Edited video must return to awaiting_approval');

  // Re-approve after final edit
  await performAutopilotFileAction(
    ownerUid,
    'owner@magnarc.test',
    wsId,
    firstVideoFile.id,
    { action: 'approve', note: 'Re-approved after title edit' },
    { store },
  );

  // Step 9: Simulate worker restart/crash recovery on a stale lease
  const jobsBeforeCrash = await listAutopilotJobs(store, wsId, policyId);
  const targetJob = jobsBeforeCrash.find((j) => j.fileRecordId === firstVideoFile.id)!;
  const claimed = claimAutopilotJobLease(targetJob, 'crashed_worker_pid_99', nowIso, 60_000);
  assert.equal(claimed.claimed, true);
  // Advance clock past lease expiration -> recovery must put it back to scheduled!
  const afterCrashIso = '2026-04-06T04:35:00.000Z';
  const recovered = recoverStaleAutopilotLeases([claimed.job], afterCrashIso);
  assert.equal(recovered.recoveredJobs.length, 1, 'Stale pre-submit lease must recover to scheduled');
  assert.equal(recovered.recoveredJobs[0].status, 'scheduled');

  // Verify post-submit crash transitions safely to publish_status_unknown (no blind retry)
  const postSubmitCrash = recoverStaleAutopilotLeases(
    [{ ...claimed.job, reconciliationRequired: true }],
    afterCrashIso,
  );
  assert.equal(postSubmitCrash.unknownStatusJobs.length, 1);
  assert.equal(postSubmitCrash.unknownStatusJobs[0].status, 'publish_status_unknown');

  // Step 10: Simulate provider temporary failure (rate_limited) -> safe backoff retry + slot recalculation
  const rateLimitedAdapter = createTestOnlyMockPublishingAdapter('instagram', { mode: 'rate_limited' });
  const latestFiles = await listAutopilotFiles(store, wsId, policyId);
  const latestFirstFile = latestFiles.find((f) => f.id === firstVideoFile.id)!;
  const approvals = await store.listWorkspaceSubcollection(wsId, 'approvalRequests');
  const matchingApproval = approvals.find((a) => a.id === latestFirstFile.approvalRequestId) as never;

  const rateLimitOutcome = await executeAutopilotPublishJob({
    policy,
    file: latestFirstFile,
    job: { ...targetJob, status: 'claimed', approvalRequestId: latestFirstFile.approvalRequestId },
    account: authorizedIgAccount,
    accountAccessToken: 'test_ig_token',
    approval: matchingApproval,
    todayPublishedCount: 0,
    adapterOverride: rateLimitedAdapter,
    nowIso: afterCrashIso,
  });
  assert.equal(rateLimitOutcome.outcome, 'retry_scheduled');
  assert.equal(rateLimitOutcome.updatedJob.status, 'scheduled');
  assert.ok(rateLimitOutcome.updatedJob.nextRetryAtUtc, 'Retry backoff timestamp must be persisted');
  assert.equal(
    rateLimitOutcome.isLiveProviderVerification,
    false,
    'Mock publishing adapter MUST NEVER be marked as live provider verification',
  );

  // Verify publish_status_unknown never blindly retries
  const unknownAdapter = createTestOnlyMockPublishingAdapter('instagram', {
    mode: 'publish_status_unknown',
  });
  const unknownOutcome = await executeAutopilotPublishJob({
    policy,
    file: latestFirstFile,
    job: { ...targetJob, status: 'claimed', approvalRequestId: latestFirstFile.approvalRequestId },
    account: authorizedIgAccount,
    accountAccessToken: 'test_ig_token',
    approval: matchingApproval,
    todayPublishedCount: 0,
    adapterOverride: unknownAdapter,
    nowIso: afterCrashIso,
  });
  assert.equal(unknownOutcome.outcome, 'publish_status_unknown');
  assert.equal(unknownOutcome.updatedJob.reconciliationRequired, true);

  // Verify future slots can be recalculated without dropping queued jobs
  const recalculated = recalculateFutureSlotsAfterFailure({
    policy,
    pendingJobs: jobsBeforeCrash.slice(1),
    publishedOrFixedJobs: [jobsBeforeCrash[0]],
    fromIsoUtc: afterCrashIso,
  });
  assert.equal(recalculated.length, 4, 'All 4 remaining queued videos must remain scheduled (never discarded)');

  // Step 11: Pause policy immediately -> verify worker publishes 0 posts while paused -> then Resume
  await updateAutopilotPolicy(
    ownerUid,
    wsId,
    policyId,
    { action: 'pause', pauseReason: 'Operator pause test' },
    { store },
  );
  const pausedCycle = await runAutopilotCycleForWorkspace(store, wsId, {
    workerId: 'worker_while_paused',
    onlyPolicyId: policyId,
    nowIso: afterCrashIso,
    fetchImpl: fakeDriveFetch,
    googleAccessTokenOverride: 'test_google_drive_token',
    socialAccessTokenOverride: 'test_ig_token',
    publishingAdapterByPlatform: { instagram: mockIgSuccess },
  });
  assert.equal(pausedCycle.policiesProcessed, 0, 'Paused policy must not run');
  assert.equal(pausedCycle.publishedCount, 0);

  // Resume and switch to AUTOMATIC_PUBLISHING with explicit per-account authorization ONLY for authorizedIgAccount
  await updateAutopilotPolicy(
    ownerUid,
    wsId,
    policyId,
    {
      action: 'resume',
      executionMode: 'AUTOMATIC_PUBLISHING',
      destinationAccountIds: [authorizedIgAccount.id, unauthorizedYtAccount.id],
      authorizedAutoPublishAccountIds: [authorizedIgAccount.id], // YouTube NOT authorized for auto!
    },
    { store },
  );

  // Step 13–14: Run worker at slot time -> authorized IG test account publishes; unauthorized YT remains awaiting approval!
  const publishRun = await runAutopilotCycleForWorkspace(store, wsId, {
    workerId: 'worker_auto_pub',
    onlyPolicyId: policyId,
    nowIso: '2026-04-06T04:40:00.000Z',
    fetchImpl: fakeDriveFetch,
    googleAccessTokenOverride: 'test_google_drive_token',
    socialAccessTokenOverride: 'test_ig_token',
    publishingAdapterByPlatform: { instagram: mockIgSuccess },
  });

  assert.ok(publishRun.publishedCount >= 1, 'Authorized test account must publish due video');
  const finalJobs = await listAutopilotJobs(store, wsId, policyId);
  const publishedJob = finalJobs.find((j) => j.status === 'published');
  assert.ok(publishedJob, 'Published job must be persisted');
  assert.ok(publishedJob.externalPostId?.startsWith('test_post_instagram_'));
  assert.ok(publishedJob.externalPostUrl?.startsWith('https://example.test/instagram/'));
  assert.equal(
    publishedJob.isLiveProviderVerification,
    false,
    'Test-adapter publish MUST be explicitly flagged isLiveProviderVerification=false',
  );

  // Verify unauthorized YouTube account was NOT auto-published
  const ytJobs = finalJobs.filter((j) => j.accountId === unauthorizedYtAccount.id);
  assert.ok(
    ytJobs.every((j) => j.status !== 'published'),
    'Unauthorized destination account must NEVER auto-publish',
  );

  // Verify auth expiry auto-pauses policy cleanly
  const expiredAccount: ConnectedSocialAccount = {
    ...authorizedIgAccount,
    tokenExpiresAt: '2020-01-01T00:00:00.000Z',
  };
  const updatedPolicyDoc = (await store.getDoc(
    `workspaces/${wsId}/autopilotPolicies/${policyId}`,
  )) as unknown as AutopilotPolicy;
  const expiredAuthOutcome = await executeAutopilotPublishJob({
    policy: updatedPolicyDoc,
    file: latestFirstFile,
    job: { ...targetJob, id: 'apj_auth_exp_test', idempotencyKey: 'idem_auth_exp', status: 'claimed' },
    account: expiredAccount,
    accountAccessToken: 'expired_token',
    todayPublishedCount: 0,
    adapterOverride: mockIgSuccess,
    nowIso: '2026-04-06T04:45:00.000Z',
  });
  assert.equal(expiredAuthOutcome.shouldPausePolicy, true);
  assert.equal(expiredAuthOutcome.newPolicyStatus, 'paused_auth_expired');

  // Verify Drive deletion detection works cleanly
  const finalFiles = await listAutopilotFiles(store, wsId, policyId);
  const deleteDiff = reconcileDriveSnapshot({
    policy: updatedPolicyDoc,
    existingRegistry: finalFiles,
    scannedNodes: [], // All files removed from folder
    nowIso: '2026-04-06T05:00:00.000Z',
  });
  assert.ok(deleteDiff.deletedFiles.length >= 5, 'Removed Drive files must be detected as deleted');

  // Step 15–17: Verify dashboard counts & complete execution history
  const counts = buildAutopilotDashboardCounts({
    policy: updatedPolicyDoc,
    files: finalFiles,
    jobs: finalJobs,
    nowIso: '2026-04-06T04:40:00.000Z',
  });
  assert.equal(counts.totalDiscovered, 7, '5 videos + 1 duplicate + 1 unsupported PDF = 7 tracked Drive items');
  assert.equal(counts.processedVideos, 5);
  assert.equal(counts.publishedVideos, 1);
  assert.equal(counts.dailyPostingLimit, 2);
  assert.equal(counts.actualPublishedToday, 1);
  assert.equal(counts.skippedOrDuplicateVideos, 2, '1 duplicate + 1 unsupported PDF');
  assert.ok(counts.estimatedProcessingCostUsd > 0);

  const history = await listAutopilotEvents(store, wsId, policyId);
  assert.ok(history.some((e) => e.eventType === 'drive_scan_completed'));
  assert.ok(history.some((e) => e.eventType === 'video_analyzed'));
  assert.ok(history.some((e) => e.eventType === 'approval_granted'));
  assert.ok(history.some((e) => e.eventType === 'metadata_edited'));
  assert.ok(history.some((e) => e.eventType === 'policy_paused'));
  assert.ok(history.some((e) => e.eventType === 'policy_resumed'));
  assert.ok(history.some((e) => e.eventType === 'job_published'));
});
