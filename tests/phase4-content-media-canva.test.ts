import test from 'node:test';
import assert from 'node:assert/strict';
import type { BrandProfile, MediaAssetRecord } from '../src/types/domain';
import {
  buildBrandCreativeBriefDefaults,
  buildPlatformVariants,
  computeContentPayloadHash,
  doesEditInvalidateApproval,
  evaluateContentQualityGate,
} from '../src/lib/marketing/content-factory';
import {
  buildWorkspaceStoragePath,
  checkMediaCompatibilityForPlatform,
  computeSha256Hex,
  findDuplicateMediaAsset,
  validateMediaAsset,
} from '../src/lib/marketing/media-pipeline';
import {
  downloadCanvaExportForStorage,
  startAndPollCanvaExportJob,
} from '../src/lib/marketing/providers/canva-adapter';

const greenWeldBrand: BrandProfile = {
  id: 'brand_greenweld',
  workspaceId: 'ws_1',
  name: 'GreenWeld',
  slug: 'greenweld',
  starterKey: 'greenweld',
  description: 'Industrial inverter welding machines and engineering equipment.',
  primaryColor: '#15803D',
  brandVoice: 'Precise, factual, engineering-first',
  contentPillars: ['Welding Engineering', 'Shop Floor Reliability'],
  targetAudience: 'Fabrication workshops and industrial buyers',
  status: 'active',
  createdBy: 'uid_owner',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

test('Content Factory: quality gate enforces prohibited claims, media requirements, platform variants, and duplicate detection', () => {
  const validAsset: MediaAssetRecord = {
    id: 'ast_1',
    schemaVersion: '4.0.0',
    workspaceId: 'ws_1',
    brandId: 'brand_greenweld',
    fileName: 'greenweld-400a.png',
    mimeType: 'image/png',
    mediaKind: 'image',
    sizeBytes: 1_200_000,
    width: 1080,
    height: 1350,
    aspectRatio: '4:5',
    sha256: computeSha256Hex('img-1'),
    storagePath: 'workspaces/ws_1/brands/brand_greenweld/media/ast_1/greenweld-400a.png',
    source: 'upload',
    processingState: 'validated',
    validationErrors: [],
    compatiblePlatforms: ['instagram', 'facebook', 'linkedin', 'google_business_profile'],
    createdBy: 'uid_owner',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const variants = buildPlatformVariants({
    title: 'GreenWeld IGBT Duty Cycle Overview',
    hook: 'Understanding 60% duty cycle at 40C ambient temperature.',
    body: 'GreenWeld inverter welders are engineered for continuous shop-floor fabrication with thermal overload protection and verified copper windings.',
    cta: 'Request the official specification sheet.',
    hashtags: ['GreenWeld', 'IndustrialWelding'],
    mediaAssetIds: [validAsset.id],
    targetPlatforms: ['instagram', 'linkedin'],
  });
  assert.equal(variants.length, 2);

  // Clean draft passes QA
  const cleanQa = evaluateContentQualityGate({
    brand: greenWeldBrand,
    brandFacts: [],
    title: 'GreenWeld IGBT Duty Cycle Overview',
    body: 'GreenWeld inverter welders are engineered for continuous shop-floor fabrication with thermal overload protection.',
    hashtags: ['#GreenWeld'],
    format: 'single_image',
    targetPlatforms: ['instagram', 'linkedin'],
    variants,
    mediaAssets: [validAsset],
    existingItems: [],
  });
  assert.equal(cleanQa.passed, true);
  assert.equal(cleanQa.warnings.filter((w) => w.severity === 'error').length, 0);

  // Prohibited unverified guarantee fails QA
  const badClaimQa = evaluateContentQualityGate({
    brand: greenWeldBrand,
    brandFacts: [],
    title: '100% Guaranteed Best Machine Ever',
    body: 'Our machines offer 100% guaranteed zero downtime forever with guaranteed #1 returns.',
    hashtags: ['#GreenWeld'],
    format: 'single_image',
    targetPlatforms: ['instagram'],
    variants,
    mediaAssets: [validAsset],
    existingItems: [],
  });
  assert.equal(badClaimQa.passed, false);
  assert.ok(badClaimQa.prohibitedTermsMatched.length > 0);

  // Missing required image for Instagram fails QA
  const missingMediaQa = evaluateContentQualityGate({
    brand: greenWeldBrand,
    brandFacts: [],
    title: 'Instagram without media',
    body: 'Factual engineering update about workshop grounding practices.',
    hashtags: ['#GreenWeld'],
    format: 'single_image',
    targetPlatforms: ['instagram'],
    variants,
    mediaAssets: [],
    existingItems: [],
  });
  assert.equal(missingMediaQa.passed, false);
  assert.ok(missingMediaQa.warnings.some((w) => w.severity === 'error'));
});

test('Content Factory: payload hash changes invalidate previous approval and creative defaults load brand rules', () => {
  const hash1 = computeContentPayloadHash({
    title: 'Original Title',
    body: 'Original factual body.',
    hashtags: ['#GreenWeld'],
    mediaAssetIds: ['ast_1'],
    targetPlatforms: ['linkedin'],
  });
  const hash2 = computeContentPayloadHash({
    title: 'Edited Title',
    body: 'Original factual body.',
    hashtags: ['#GreenWeld'],
    mediaAssetIds: ['ast_1'],
    targetPlatforms: ['linkedin'],
  });
  assert.notEqual(hash1, hash2);
  assert.equal(
    doesEditInvalidateApproval(
      { status: 'APPROVED', approvedPayloadHash: hash1, payloadHash: hash1 },
      hash2,
    ),
    true,
  );
  assert.equal(
    doesEditInvalidateApproval(
      { status: 'APPROVED', approvedPayloadHash: hash1, payloadHash: hash1 },
      hash1,
    ),
    false,
  );

  const defaults = buildBrandCreativeBriefDefaults(greenWeldBrand, []);
  assert.ok(defaults.mandatoryRules.length > 0);
  assert.ok(defaults.prohibitedClaims.length > 0);
});

test('Media Pipeline: validates valid/invalid MIME, size, resolution, deduplication, and platform compatibility', () => {
  const validImg = validateMediaAsset({
    fileName: 'hero.png',
    mimeType: 'image/png',
    sizeBytes: 2_000_000,
    width: 1080,
    height: 1350,
  });
  assert.equal(validImg.valid, true);
  assert.equal(validImg.mediaKind, 'image');
  assert.equal(validImg.requiresResumableUpload, false);
  assert.ok(validImg.compatiblePlatforms.includes('instagram'));

  const largeVideo = validateMediaAsset({
    fileName: 'reel.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 25 * 1024 * 1024,
    width: 1080,
    height: 1920,
    durationSeconds: 45,
  });
  assert.equal(largeVideo.valid, true);
  assert.equal(largeVideo.requiresResumableUpload, true);
  assert.ok(largeVideo.compatiblePlatforms.includes('youtube'));
  assert.ok(largeVideo.compatiblePlatforms.includes('tiktok'));

  const invalidMime = validateMediaAsset({
    fileName: 'malware.exe',
    mimeType: 'application/x-msdownload',
    sizeBytes: 5000,
  });
  assert.equal(invalidMime.valid, false);
  assert.ok(invalidMime.errors.length > 0);

  const storagePath = buildWorkspaceStoragePath({
    workspaceId: 'ws_1',
    brandId: 'brand_greenweld',
    assetId: 'ast_99',
    fileName: '../unsafe name!.png',
  });
  assert.ok(storagePath.startsWith('workspaces/ws_1/'));
  assert.ok(!storagePath.includes('..'));

  const sha = computeSha256Hex('same-file-bytes');
  const existing: MediaAssetRecord[] = [
    {
      id: 'ast_dup',
      schemaVersion: '4.0.0',
      workspaceId: 'ws_1',
      fileName: 'dup.png',
      mimeType: 'image/png',
      mediaKind: 'image',
      sizeBytes: 50000,
      sha256: sha,
      storagePath: 'workspaces/ws_1/media/ast_dup/dup.png',
      source: 'upload',
      processingState: 'validated',
      validationErrors: [],
      compatiblePlatforms: ['linkedin'],
      createdBy: 'u1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ];
  assert.equal(findDuplicateMediaAsset(existing, sha)?.id, 'ast_dup');
  assert.equal(checkMediaCompatibilityForPlatform(existing[0], 'youtube').compatible, false);
});

test('Canva Connect Adapter: async export bounded polling, expired download URL, and storage failure handling', async () => {
  let pollCount = 0;
  const mockFetch = (async (url: string | URL) => {
    const href = String(url);
    if (href.endsWith('/exports')) {
      return new Response(
        JSON.stringify({ job: { id: 'job_canva_1', status: 'in_progress' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    pollCount += 1;
    if (pollCount < 2) {
      return new Response(
        JSON.stringify({ job: { id: 'job_canva_1', status: 'in_progress' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        job: {
          id: 'job_canva_1',
          status: 'success',
          urls: ['https://export-download.canva.test/file.png'],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;

  const exported = await startAndPollCanvaExportJob(
    'canva_test_token',
    { designId: 'DAG123', format: 'png', maxPolls: 4, pollIntervalMs: 1 },
    mockFetch,
  );
  assert.equal(exported.status, 'completed');
  assert.equal(exported.downloadUrls[0], 'https://export-download.canva.test/file.png');

  const expiredFetch = (async () => new Response('Gone', { status: 410 })) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      downloadCanvaExportForStorage({
        workspaceId: 'ws_1',
        assetId: 'ast_exp',
        designId: 'DAG123',
        format: 'png',
        temporaryDownloadUrl: 'https://export-download.canva.test/expired.png',
        createdBy: 'uid_1',
        fetchImpl: expiredFetch,
      }),
    /expired/i,
  );

  const okBytesFetch = (async () =>
    new Response(Buffer.from('fake-png-bytes'), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    })) as unknown as typeof fetch;

  await assert.rejects(
    () =>
      downloadCanvaExportForStorage({
        workspaceId: 'ws_1',
        assetId: 'ast_store_fail',
        designId: 'DAG123',
        format: 'png',
        temporaryDownloadUrl: 'https://export-download.canva.test/ok.png',
        createdBy: 'uid_1',
        fetchImpl: okBytesFetch,
        persistBytes: async () => {
          throw new Error('Firebase Storage write failed');
        },
      }),
    /Firebase Storage write failed/i,
  );
});
