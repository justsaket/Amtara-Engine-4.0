import crypto from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { AppError } from '@/lib/server/error-handler';
import type { BrandKnowledgeFact, BrandProfile, SocialPlatformId } from '@/types/domain';
import type {
  AutopilotDriveFileRecord,
  AutopilotGeneratedMetadata,
  AutopilotPlatformFormatIssue,
  AutopilotPolicy,
  AutopilotRepresentativeFrame,
  AutopilotVideoAnalysis,
  AutopilotVideoTechnicalMetadata,
} from '@/types/autopilot';
import {
  MAX_AUTOPILOT_VIDEO_BYTES,
  MAX_INLINE_MULTIMODAL_BYTES,
  SUPPORTED_AUTOPILOT_VIDEO_MIMES,
} from './drive-monitor';

const DEFAULT_MULTIMODAL_MODEL = 'gemini-4-hydrogen';

export interface VideoMediaAnalysisInput {
  file: AutopilotDriveFileRecord;
  policy: AutopilotPolicy;
  brand: BrandProfile;
  brandFacts: BrandKnowledgeFact[];
  targetPlatforms: SocialPlatformId[];
  priorMetadataFingerprints?: Array<{
    fileId: string;
    contentTitle: string;
    openingHook: string;
    instagramCaption: string;
  }>;
  /** Actual video bytes retrieved from Google Drive (mandatory unless frames or test fixture provided). */
  videoBytes?: Buffer;
  /** Representative extracted frames (base64 JPEG/PNG) when video exceeds inline threshold. */
  extractedFrames?: Array<{
    timestampSeconds: number;
    mimeType: 'image/jpeg' | 'image/png';
    base64Data: string;
  }>;
  /** Optional pre-extracted speech transcript accompanying extracted frames. */
  extractedAudioTranscript?: string;
  /** Optional test-only multimodal fixture passed strictly in automated tests. */
  testMultimodalFixture?: TestVideoMultimodalFixture;
  /** Optional analyzer adapter override (strictly for deterministic testing). */
  analyzerAdapter?: AutopilotVideoAnalyzerAdapter;
  nowIso?: string;
}

export interface TestVideoMultimodalFixture {
  visualScenes: AutopilotRepresentativeFrame[];
  visualScenesSummary: string;
  transcript: string;
  detectedLanguage: string;
  subject: string;
  context: string;
  centralMessage: string;
  misleadingOrUnsupportedClaims?: string[];
  sensitiveOrUnsuitableFlags?: string[];
}

export interface AutopilotVideoAnalysisOutput {
  analysis: AutopilotVideoAnalysis;
  generatedMetadata: AutopilotGeneratedMetadata;
  validationIssues: string[];
  uniquenessScore: number;
}

export type AutopilotVideoAnalyzerAdapter = (
  input: VideoMediaAnalysisInput,
) => Promise<{
  analysis: AutopilotVideoAnalysis;
  generatedMetadata: AutopilotGeneratedMetadata;
}>;

/**
 * Computes deterministic representative frame timestamps across a video's duration
 * so opening hook, mid-body narrative, and closing CTA are always sampled.
 */
export function planRepresentativeFrameTimestamps(durationSeconds: number | null): number[] {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [0, 2, 5, 10, 15];
  }
  const ratios = [0.05, 0.25, 0.5, 0.75, 0.92];
  const unique = new Set<number>();
  for (const r of ratios) {
    unique.add(Number(Math.max(0, Math.min(durationSeconds - 0.1, durationSeconds * r)).toFixed(2)));
  }
  return Array.from(unique).sort((a, b) => a - b);
}

/**
 * Validates technical video metadata against destination platform publishing rules.
 */
export function inspectVideoForPlatforms(
  videoMeta: AutopilotVideoTechnicalMetadata,
  mimeType: string,
  sizeBytes: number,
  platforms: SocialPlatformId[],
): AutopilotPlatformFormatIssue[] {
  const issues: AutopilotPlatformFormatIssue[] = [];

  if (!SUPPORTED_AUTOPILOT_VIDEO_MIMES.has(mimeType)) {
    for (const platform of platforms) {
      issues.push({
        platform,
        severity: 'error',
        code: 'UNSUPPORTED_VIDEO_MIME',
        message: `MIME type "${mimeType}" is not supported for automated social video publishing.`,
      });
    }
    return issues;
  }

  if (sizeBytes > MAX_AUTOPILOT_VIDEO_BYTES) {
    for (const platform of platforms) {
      issues.push({
        platform,
        severity: 'error',
        code: 'VIDEO_TOO_LARGE',
        message: `Video size (${Math.round(sizeBytes / (1024 * 1024))} MB) exceeds the 500 MB autopilot limit.`,
      });
    }
  }

  const duration = videoMeta.durationSeconds;

  for (const platform of platforms) {
    if (platform === 'instagram') {
      if (duration !== null && duration > 90) {
        issues.push({
          platform,
          severity: 'warning',
          code: 'IG_REEL_DURATION_LONG',
          message: `Duration (${duration}s) exceeds Instagram Reels 90s recommendation; consider trimming.`,
        });
      }
      if (videoMeta.orientation === 'horizontal') {
        issues.push({
          platform,
          severity: 'warning',
          code: 'IG_REEL_HORIZONTAL_ASPECT',
          message: `Video aspect ratio (${videoMeta.aspectRatio || 'horizontal'}) is horizontal; 9:16 vertical performs better on Instagram Reels.`,
        });
      }
      if (mimeType === 'video/webm') {
        issues.push({
          platform,
          severity: 'error',
          code: 'IG_WEBM_UNSUPPORTED',
          message: 'Instagram Graph API requires MP4 or MOV video containers (WebM is unsupported).',
        });
      }
    }

    if (platform === 'youtube') {
      if (duration !== null && duration <= 60 && videoMeta.orientation === 'horizontal') {
        issues.push({
          platform,
          severity: 'warning',
          code: 'YT_SHORT_NOT_VERTICAL',
          message: 'Video is <=60s but horizontal; YouTube classifies it as a regular video rather than a YouTube Short.',
        });
      }
      if (videoMeta.width !== null && videoMeta.height !== null && Math.min(videoMeta.width, videoMeta.height) < 480) {
        issues.push({
          platform,
          severity: 'warning',
          code: 'YT_LOW_RESOLUTION',
          message: `Low video resolution (${videoMeta.width}x${videoMeta.height}); 720p or 1080p is recommended for YouTube.`,
        });
      }
    }

    if (platform === 'tiktok') {
      if (duration !== null && duration > 600) {
        issues.push({
          platform,
          severity: 'error',
          code: 'TIKTOK_DURATION_LIMIT',
          message: `Video duration (${duration}s) exceeds TikTok 10-minute Content Posting API limit.`,
        });
      }
      if (videoMeta.orientation === 'horizontal') {
        issues.push({
          platform,
          severity: 'warning',
          code: 'TIKTOK_HORIZONTAL_ASPECT',
          message: 'Horizontal video uploaded to TikTok; vertical 9:16 is recommended.',
        });
      }
    }

    if (platform === 'linkedin') {
      if (duration !== null && duration > 600) {
        issues.push({
          platform,
          severity: 'error',
          code: 'LINKEDIN_DURATION_LIMIT',
          message: `Video duration (${duration}s) exceeds LinkedIn 10-minute video upload cap.`,
        });
      }
      if (mimeType !== 'video/mp4') {
        issues.push({
          platform,
          severity: 'warning',
          code: 'LINKEDIN_PREFERS_MP4',
          message: `LinkedIn recommends MP4 H.264 video containers (received ${mimeType}).`,
        });
      }
    }
  }

  return issues;
}

export function computeMetadataFingerprint(metadata: Omit<AutopilotGeneratedMetadata, 'metadataFingerprint'>): string {
  const canonical = JSON.stringify({
    contentTitle: metadata.contentTitle.trim(),
    openingHook: metadata.openingHook.trim(),
    instagramCaption: metadata.instagramCaption.trim(),
    youtubeTitle: metadata.youtubeTitle.trim(),
    youtubeDescription: metadata.youtubeDescription.trim(),
    hashtags: metadata.hashtags.map((h) => h.trim().toLowerCase()),
    cta: metadata.cta.trim(),
    suggestedThumbnailText: metadata.suggestedThumbnailText.trim(),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function computeAutopilotMetadataPayloadHash(params: {
  driveFileId: string;
  brandId: string;
  destinationAccountIds: string[];
  metadata: AutopilotGeneratedMetadata;
}): string {
  const canonical = JSON.stringify({
    driveFileId: params.driveFileId,
    brandId: params.brandId,
    destinationAccountIds: [...params.destinationAccountIds].sort(),
    contentTitle: params.metadata.contentTitle.trim(),
    openingHook: params.metadata.openingHook.trim(),
    instagramCaption: params.metadata.instagramCaption.trim(),
    youtubeTitle: params.metadata.youtubeTitle.trim(),
    youtubeDescription: params.metadata.youtubeDescription.trim(),
    hashtags: params.metadata.hashtags.map((h) => h.trim()),
    cta: params.metadata.cta.trim(),
    suggestedThumbnailText: params.metadata.suggestedThumbnailText.trim(),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function tokenizeForSimilarity(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'into', 'are', 'was',
    'were', 'our', 'you', 'how', 'why', 'what', 'when', 'have', 'has', 'will', 'can',
    'all', 'not', 'but', 'about', 'more', 'out', 'new', 'now', 'get', 'see', 'watch',
  ]);
  const tokens = text
    .toLowerCase()
    .replace(/#[a-z0-9_]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));
  return new Set(tokens);
}

export function computeJaccardSimilarity(a: string, b: string): number {
  const setA = tokenizeForSimilarity(a);
  const setB = tokenizeForSimilarity(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function validateGeneratedMetadataPackage(params: {
  analysis: AutopilotVideoAnalysis;
  metadata: AutopilotGeneratedMetadata;
  brand: BrandProfile;
  brandFacts: BrandKnowledgeFact[];
  priorPackages?: Array<{
    fileId: string;
    contentTitle: string;
    openingHook: string;
    instagramCaption: string;
  }>;
  currentFileId: string;
}): { valid: boolean; issues: string[]; uniquenessScore: number } {
  const issues: string[] = [];
  const { analysis, metadata } = params;

  if (!metadata.contentTitle.trim()) issues.push('Missing content title.');
  if (!metadata.openingHook.trim()) issues.push('Missing opening hook.');
  if (!metadata.instagramCaption.trim()) issues.push('Missing Instagram caption.');
  if (!metadata.youtubeTitle.trim()) issues.push('Missing YouTube title.');
  if (metadata.youtubeTitle.trim().length > 100) {
    issues.push(`YouTube title exceeds 100 characters (${metadata.youtubeTitle.trim().length}).`);
  }
  if (!metadata.youtubeDescription.trim()) issues.push('Missing YouTube description.');
  if (!metadata.shortDescription.trim()) issues.push('Missing short description.');
  if (!metadata.suggestedThumbnailText.trim()) issues.push('Missing suggested thumbnail text.');

  // Uniqueness check against prior generated captions in the policy
  let maxSimilarity = 0;
  for (const prior of params.priorPackages || []) {
    if (prior.fileId === params.currentFileId) continue;
    const captionSim = computeJaccardSimilarity(metadata.instagramCaption, prior.instagramCaption);
    const titleSim = computeJaccardSimilarity(metadata.contentTitle, prior.contentTitle);
    const hookSim = computeJaccardSimilarity(metadata.openingHook, prior.openingHook);
    maxSimilarity = Math.max(maxSimilarity, captionSim);
    if (captionSim >= 0.72) {
      issues.push(
        `Generated Instagram caption is too similar (${Math.round(captionSim * 100)}%) to previously processed video "${prior.contentTitle}".`,
      );
    }
    if (titleSim >= 0.85 && hookSim >= 0.85) {
      issues.push(`Generated title & hook duplicate an earlier video package ("${prior.contentTitle}").`);
    }
  }

  // Brand prohibited claims check
  const combinedCopy = [
    metadata.contentTitle,
    metadata.openingHook,
    metadata.instagramCaption,
    metadata.youtubeTitle,
    metadata.youtubeDescription,
    metadata.cta,
  ]
    .join(' ')
    .toLowerCase();

  const prohibitedFacts = params.brandFacts.filter(
    (f) => f.category === 'prohibited_claims_and_restrictions',
  );
  const restrictionText = [
    params.brand.restrictions || '',
    ...prohibitedFacts.map((f) => `${f.title} ${f.statement}`),
  ]
    .join(' ')
    .toLowerCase();

  // Check for explicit banned patterns like "guaranteed 10x", "100% cure", "free lifetime", etc. if restricted
  const highRiskUnverifiedPatterns: Array<{ regex: RegExp; label: string }> = [
    { regex: /\b100%\s*(guaranteed|cure|risk[-\s]?free)\b/i, label: 'Unverifiable 100% guarantee/cure claim' },
    { regex: /\bguaranteed\s+\d+x\s+(roi|returns|profit)\b/i, label: 'Unverified multiplied ROI guarantee' },
  ];
  for (const pattern of highRiskUnverifiedPatterns) {
    if (pattern.regex.test(combinedCopy)) {
      issues.push(`Blocked potentially misleading claim: ${pattern.label}.`);
    }
  }
  if (restrictionText.includes('no pricing') && /\$\d+|₹\d+|\brs\.?\s*\d+/i.test(combinedCopy)) {
    issues.push('Brand restrictions prohibit quoting unapproved pricing in captions.');
  }

  if (analysis.sensitiveOrUnsuitableFlags.length > 0) {
    issues.push(
      `Sensitive/unsuitable video content flagged: ${analysis.sensitiveOrUnsuitableFlags.join('; ')}.`,
    );
  }
  if (analysis.misleadingOrUnsupportedClaims.length > 0) {
    issues.push(
      `Misleading or unsupported claim detected in video: ${analysis.misleadingOrUnsupportedClaims.join('; ')}.`,
    );
  }

  const uniquenessScore = Number((1 - maxSimilarity).toFixed(3));
  return {
    valid: issues.length === 0,
    issues,
    uniquenessScore,
  };
}

function estimateGeminiCostUsd(inputTokens: number, outputTokens: number): number {
  // Transparent approximate token estimate for Gemini multimodal tier
  const inputCost = (inputTokens / 1_000_000) * 0.35;
  const outputCost = (outputTokens / 1_000_000) * 1.05;
  return Number((inputCost + outputCost).toFixed(6));
}

function buildGroundedSystemPrompt(input: VideoMediaAnalysisInput): string {
  const verifiedFacts = input.brandFacts
    .filter((f) => f.verificationStatus === 'VERIFIED' || f.verificationStatus === 'SUPPORTED')
    .slice(0, 15)
    .map((f) => `- [${f.id}] (${f.category}): ${f.title} — ${f.statement}`);

  const restrictions = input.brandFacts
    .filter(
      (f) =>
        f.category === 'prohibited_claims_and_restrictions' ||
        f.category === 'compliance_and_legal_constraints',
    )
    .slice(0, 10)
    .map((f) => `- ${f.title}: ${f.statement}`);

  const priorCaptions = (input.priorMetadataFingerprints || [])
    .slice(0, 8)
    .map((p) => `- "${p.contentTitle}" | Hook: "${p.openingHook}"`);

  const plannedFrames = planRepresentativeFrameTimestamps(input.file.videoMetadata.durationSeconds);

  return [
    'You are Antara Engine Video Intelligence & Brand Copywriting Specialist.',
    'Analyze the ACTUAL provided video media (visual scenes, on-screen demonstrations, spoken audio/speech, pacing, and context).',
    'STRICT GROUNDING RULES:',
    '1. NEVER invent captions from the filename. Every detail in the summary, hook, captions, and thumbnail text must come directly from what is visually shown or spoken in this specific video.',
    '2. NEVER invent unverified claims, fake discounts, fabricated customer testimonials, or unverified statistics.',
    '3. Flag any misleading/unsupported claims spoken or displayed in the video, and flag any sensitive/unsuitable content.',
    '4. Write completely unique, non-generic copy tailored to this video. Do NOT repeat phrasing from earlier videos.',
    `5. Target output language: ${input.policy.language}. Caption style: ${input.policy.captionStyle}. Hashtag strategy: ${input.policy.hashtagStrategy} (maximum ${input.policy.maxHashtags} hashtags).`,
    '',
    `BRAND PROFILE: ${input.brand.name}`,
    `- Industry: ${input.brand.industry || 'Not specified'}`,
    `- Description: ${input.brand.description || 'Not specified'}`,
    `- Target Audience: ${input.brand.targetAudience || 'Not specified'}`,
    `- Voice & Tone: ${input.brand.brandVoice || 'Clear, authentic, authoritative'}`,
    `- Restrictions: ${input.brand.restrictions || 'Never fabricate offers, testimonials, or unverified metrics.'}`,
    '',
    'VERIFIED BRAND FACTS (cite IDs in brandFactRefsUsed only when genuinely relevant):',
    verifiedFacts.length > 0 ? verifiedFacts.join('\n') : '- No additional verified facts recorded.',
    '',
    'BRAND PROHIBITED CLAIMS & COMPLIANCE CONSTRAINTS:',
    restrictions.length > 0 ? restrictions.join('\n') : '- Standard truthfulness and platform policy compliance.',
    '',
    'RECENT VIDEOS ALREADY PROCESSED (DO NOT REPEAT THESE HOOKS OR BOILERPLATE):',
    priorCaptions.length > 0 ? priorCaptions.join('\n') : '- None yet.',
    '',
    `TECHNICAL METADATA: mimeType=${input.file.mimeType}, durationSeconds=${input.file.videoMetadata.durationSeconds ?? 'unknown'}, resolution=${input.file.videoMetadata.width ?? '?'}x${input.file.videoMetadata.height ?? '?'}, orientation=${input.file.videoMetadata.orientation}, suggestedRepresentativeTimestampsSec=[${plannedFrames.join(', ')}]`,
  ].join('\n');
}

/**
 * Core multimodal video analysis & brand-grounded metadata generator.
 * Rejects filename-only invocation when no actual video media, extracted frames, or test multimodal fixture is provided.
 */
export async function analyzeVideoAndGenerateMetadata(
  input: VideoMediaAnalysisInput,
): Promise<AutopilotVideoAnalysisOutput> {
  const nowIso = input.nowIso || new Date().toISOString();
  const hasVideoBytes = Boolean(input.videoBytes && input.videoBytes.byteLength > 0);
  const hasFrames = Boolean(input.extractedFrames && input.extractedFrames.length > 0);
  const hasTestFixture = Boolean(input.testMultimodalFixture);

  if (!hasVideoBytes && !hasFrames && !hasTestFixture) {
    throw new AppError(
      422,
      'VIDEO_MEDIA_REQUIRED_FOR_ANALYSIS',
      `Refused filename-only caption generation for "${input.file.name}". Retrieved video media bytes or extracted frames + audio transcript are mandatory.`,
    );
  }

  const platformFormatIssues = inspectVideoForPlatforms(
    input.file.videoMetadata,
    input.file.mimeType,
    input.file.sizeBytes,
    input.targetPlatforms,
  );

  // Test-only injectable adapter path
  if (input.analyzerAdapter) {
    const adapterOut = await input.analyzerAdapter(input);
    const mergedAnalysis: AutopilotVideoAnalysis = {
      ...adapterOut.analysis,
      platformFormatIssues,
      safeToPublish:
        adapterOut.analysis.safeToPublish &&
        adapterOut.analysis.sensitiveOrUnsuitableFlags.length === 0 &&
        adapterOut.analysis.misleadingOrUnsupportedClaims.length === 0 &&
        !platformFormatIssues.some((i) => i.severity === 'error'),
    };
    const validation = validateGeneratedMetadataPackage({
      analysis: mergedAnalysis,
      metadata: adapterOut.generatedMetadata,
      brand: input.brand,
      brandFacts: input.brandFacts,
      priorPackages: input.priorMetadataFingerprints,
      currentFileId: input.file.id,
    });
    return {
      analysis: mergedAnalysis,
      generatedMetadata: adapterOut.generatedMetadata,
      validationIssues: validation.issues,
      uniquenessScore: validation.uniquenessScore,
    };
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new AppError(
      503,
      'AI_PROVIDER_NOT_CONFIGURED',
      'Server-side GEMINI_API_KEY is not configured; cannot execute multimodal video analysis.',
    );
  }

  if (hasVideoBytes && input.videoBytes!.byteLength > MAX_INLINE_MULTIMODAL_BYTES && !hasFrames) {
    throw new AppError(
      413,
      'VIDEO_EXCEEDS_INLINE_MULTIMODAL_LIMIT',
      `Video is ${Math.round(input.videoBytes!.byteLength / (1024 * 1024))} MB (inline limit is 20 MB). Supply extracted representative frames and audio transcript for large videos.`,
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [{ text: buildGroundedSystemPrompt(input) }];

  let sourceMethod: AutopilotVideoAnalysis['sourceMethod'] = 'multimodal_video_bytes';
  if (hasVideoBytes && input.videoBytes!.byteLength <= MAX_INLINE_MULTIMODAL_BYTES) {
    parts.push({
      inlineData: {
        mimeType: input.file.mimeType,
        data: input.videoBytes!.toString('base64'),
      },
    });
  } else if (hasFrames) {
    sourceMethod = 'extracted_frames_and_audio';
    for (const frame of input.extractedFrames!.slice(0, 8)) {
      parts.push({ text: `Representative frame at ${frame.timestampSeconds}s:` });
      parts.push({
        inlineData: {
          mimeType: frame.mimeType,
          data: frame.base64Data,
        },
      });
    }
    if (input.extractedAudioTranscript) {
      parts.push({ text: `Extracted audio/speech transcript:\n${input.extractedAudioTranscript}` });
    }
  }

  parts.push({
    text: 'Inspect the video scenes and audio carefully and return the structured JSON analysis and brand-grounded platform metadata package.',
  });

  const response = await ai.models.generateContent({
    model: DEFAULT_MULTIMODAL_MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          representativeFrames: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                timestampSeconds: { type: Type.NUMBER },
                sceneType: { type: Type.STRING },
                description: { type: Type.STRING },
              },
              required: ['timestampSeconds', 'sceneType', 'description'],
            },
          },
          visualScenesSummary: { type: Type.STRING },
          transcript: { type: Type.STRING },
          detectedLanguage: { type: Type.STRING },
          subject: { type: Type.STRING },
          context: { type: Type.STRING },
          centralMessage: { type: Type.STRING },
          misleadingOrUnsupportedClaims: { type: Type.ARRAY, items: { type: Type.STRING } },
          sensitiveOrUnsuitableFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
          contentTitle: { type: Type.STRING },
          openingHook: { type: Type.STRING },
          instagramCaption: { type: Type.STRING },
          youtubeTitle: { type: Type.STRING },
          youtubeDescription: { type: Type.STRING },
          hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
          keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
          cta: { type: Type.STRING },
          shortDescription: { type: Type.STRING },
          suggestedThumbnailText: { type: Type.STRING },
          instagramAltText: { type: Type.STRING },
          facebookDescription: { type: Type.STRING },
          linkedinCommentary: { type: Type.STRING },
          tiktokTitle: { type: Type.STRING },
          brandFactRefsUsed: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          'representativeFrames',
          'visualScenesSummary',
          'transcript',
          'detectedLanguage',
          'subject',
          'context',
          'centralMessage',
          'misleadingOrUnsupportedClaims',
          'sensitiveOrUnsuitableFlags',
          'contentTitle',
          'openingHook',
          'instagramCaption',
          'youtubeTitle',
          'youtubeDescription',
          'hashtags',
          'keywords',
          'cta',
          'shortDescription',
          'suggestedThumbnailText',
        ],
      },
    },
  });

  const rawText = (response.text || '').trim();
  if (!rawText) {
    throw new AppError(502, 'AI_EMPTY_VIDEO_ANALYSIS', 'Gemini returned an empty response during video analysis.');
  }

  const parsed = JSON.parse(rawText) as {
    representativeFrames: AutopilotRepresentativeFrame[];
    visualScenesSummary: string;
    transcript: string;
    detectedLanguage: string;
    subject: string;
    context: string;
    centralMessage: string;
    misleadingOrUnsupportedClaims: string[];
    sensitiveOrUnsuitableFlags: string[];
    contentTitle: string;
    openingHook: string;
    instagramCaption: string;
    youtubeTitle: string;
    youtubeDescription: string;
    hashtags: string[];
    keywords: string[];
    cta: string;
    shortDescription: string;
    suggestedThumbnailText: string;
    instagramAltText?: string;
    facebookDescription?: string;
    linkedinCommentary?: string;
    tiktokTitle?: string;
    brandFactRefsUsed?: string[];
  };

  const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
  const estimatedCostUsd =
    inputTokens > 0 || outputTokens > 0 ? estimateGeminiCostUsd(inputTokens, outputTokens) : null;

  const isShort =
    input.file.videoMetadata.orientation === 'vertical' &&
    (input.file.videoMetadata.durationSeconds === null || input.file.videoMetadata.durationSeconds <= 60);

  const normalizedHashtags = (parsed.hashtags || [])
    .map((h) => (h.startsWith('#') ? h : `#${h.replace(/\s+/g, '')}`))
    .slice(0, input.policy.maxHashtags);

  const baseMeta: Omit<AutopilotGeneratedMetadata, 'metadataFingerprint'> = {
    contentTitle: parsed.contentTitle.trim(),
    openingHook: parsed.openingHook.trim(),
    instagramCaption: parsed.instagramCaption.trim(),
    youtubeTitle: parsed.youtubeTitle.trim().slice(0, 100),
    youtubeDescription: parsed.youtubeDescription.trim(),
    hashtags: normalizedHashtags,
    keywords: (parsed.keywords || []).slice(0, 20),
    cta: parsed.cta.trim(),
    shortDescription: parsed.shortDescription.trim(),
    suggestedThumbnailText: parsed.suggestedThumbnailText.trim().slice(0, 80),
    platformMetadata: {
      instagram: {
        shareToFeed: true,
        altText: (parsed.instagramAltText || parsed.visualScenesSummary).slice(0, 400),
      },
      youtube: {
        categoryId: '22',
        tags: (parsed.keywords || []).slice(0, 15),
        privacyStatus: 'public',
        isShort,
      },
      facebook: {
        description: (parsed.facebookDescription || parsed.instagramCaption).slice(0, 2000),
      },
      linkedin: {
        commentary: (parsed.linkedinCommentary || `${parsed.openingHook}\n\n${parsed.shortDescription}`).slice(0, 2800),
      },
      tiktok: {
        title: (parsed.tiktokTitle || parsed.contentTitle).slice(0, 150),
        privacyLevel: 'PUBLIC_TO_EVERYONE',
      },
    },
    brandFactRefsUsed: (parsed.brandFactRefsUsed || []).filter((id) =>
      input.brandFacts.some((f) => f.id === id),
    ),
    editedByUser: false,
  };

  const generatedMetadata: AutopilotGeneratedMetadata = {
    ...baseMeta,
    metadataFingerprint: computeMetadataFingerprint(baseMeta),
  };

  const analysis: AutopilotVideoAnalysis = {
    analyzedAt: nowIso,
    provider: 'google_gemini',
    model: DEFAULT_MULTIMODAL_MODEL,
    sourceMethod,
    representativeFrames: parsed.representativeFrames || [],
    visualScenesSummary: parsed.visualScenesSummary,
    transcript: parsed.transcript,
    detectedLanguage: parsed.detectedLanguage || input.policy.language,
    subject: parsed.subject,
    context: parsed.context,
    centralMessage: parsed.centralMessage,
    misleadingOrUnsupportedClaims: parsed.misleadingOrUnsupportedClaims || [],
    sensitiveOrUnsuitableFlags: parsed.sensitiveOrUnsuitableFlags || [],
    platformFormatIssues,
    safeToPublish:
      (parsed.misleadingOrUnsupportedClaims || []).length === 0 &&
      (parsed.sensitiveOrUnsuitableFlags || []).length === 0 &&
      !platformFormatIssues.some((i) => i.severity === 'error'),
    inputTokens,
    outputTokens,
    estimatedCostUsd,
  };

  const validation = validateGeneratedMetadataPackage({
    analysis,
    metadata: generatedMetadata,
    brand: input.brand,
    brandFacts: input.brandFacts,
    priorPackages: input.priorMetadataFingerprints,
    currentFileId: input.file.id,
  });

  if (!validation.valid && analysis.safeToPublish) {
    analysis.safeToPublish = false;
  }

  return {
    analysis,
    generatedMetadata,
    validationIssues: validation.issues,
    uniquenessScore: validation.uniquenessScore,
  };
}

/**
 * TEST-ONLY deterministic multimodal analyzer.
 * Strictly inspects the provided video fixture (visual scenes + audio transcript) — NEVER the filename alone —
 * and builds unique, brand-grounded metadata packages for automated E2E tests.
 */
export function createTestOnlyMultimodalVideoAnalyzer(): AutopilotVideoAnalyzerAdapter {
  return async (input) => {
    const fixture = input.testMultimodalFixture;
    if (!fixture) {
      throw new AppError(
        422,
        'VIDEO_MEDIA_REQUIRED_FOR_ANALYSIS',
        'Test multimodal analyzer requires a testMultimodalFixture with visual scenes and audio transcript.',
      );
    }
    const nowIso = input.nowIso || new Date().toISOString();
    const verifiedFacts = input.brandFacts.filter(
      (f) => f.verificationStatus === 'VERIFIED' || f.verificationStatus === 'SUPPORTED',
    );
    const chosenFact = verifiedFacts[0];
    const cleanSubject = fixture.subject.trim();
    const cleanMessage = fixture.centralMessage.trim();
    const firstScene = fixture.visualScenes[0]?.description || fixture.visualScenesSummary;

    const subjectKeywords = cleanSubject
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4);
    const brandTag = input.brand.name.replace(/[^a-zA-Z0-9]/g, '');
    const hashtags = Array.from(
      new Set([
        `#${brandTag}`,
        ...subjectKeywords.slice(0, 4).map((k) => `#${k}`),
        '#VideoGuide',
      ]),
    ).slice(0, input.policy.maxHashtags);

    const isShort =
      input.file.videoMetadata.orientation === 'vertical' &&
      (input.file.videoMetadata.durationSeconds === null || input.file.videoMetadata.durationSeconds <= 60);

    const contentTitle = `${cleanSubject}: ${cleanMessage.slice(0, 68)}`;
    const openingHook = `Watch how ${cleanSubject.toLowerCase()} works in practice — ${firstScene.slice(0, 90)}.`;
    const instagramCaption = [
      openingHook,
      '',
      `In this clip for ${input.brand.name}: ${fixture.visualScenesSummary}`,
      `Key takeaway: ${cleanMessage}`,
      chosenFact ? `Grounded note: ${chosenFact.statement}` : '',
      `Save this breakdown and share your question in the comments.`,
      hashtags.join(' '),
    ]
      .filter(Boolean)
      .join('\n');

    const youtubeTitle = `${cleanSubject} | ${input.brand.name}`.slice(0, 100);
    const youtubeDescription = [
      `${cleanMessage}`,
      '',
      `Visual walkthrough: ${fixture.visualScenesSummary}`,
      `Spoken highlights: ${fixture.transcript}`,
      chosenFact ? `Verified context (${input.brand.name}): ${chosenFact.statement}` : '',
      `Target audience: ${input.brand.targetAudience || 'Professionals & customers'}`,
      '',
      hashtags.join(' '),
    ]
      .filter(Boolean)
      .join('\n');

    const baseMeta: Omit<AutopilotGeneratedMetadata, 'metadataFingerprint'> = {
      contentTitle,
      openingHook,
      instagramCaption,
      youtubeTitle,
      youtubeDescription,
      hashtags,
      keywords: Array.from(new Set([input.brand.name, ...subjectKeywords, fixture.context.split(' ')[0] || 'video'])).slice(0, 12),
      cta: `Follow ${input.brand.name} for practical breakdowns on ${cleanSubject.toLowerCase()}.`,
      shortDescription: `${cleanSubject} — ${cleanMessage}`.slice(0, 240),
      suggestedThumbnailText: cleanSubject.split(' ').slice(0, 4).join(' ').toUpperCase().slice(0, 40),
      platformMetadata: {
        instagram: { shareToFeed: true, altText: fixture.visualScenesSummary.slice(0, 300) },
        youtube: {
          categoryId: '22',
          tags: subjectKeywords.slice(0, 10),
          privacyStatus: 'public',
          isShort,
        },
        facebook: { description: instagramCaption },
        linkedin: { commentary: `${openingHook}\n\n${cleanMessage}` },
        tiktok: { title: contentTitle.slice(0, 140), privacyLevel: 'PUBLIC_TO_EVERYONE' },
      },
      brandFactRefsUsed: chosenFact ? [chosenFact.id] : [],
      editedByUser: false,
    };

    const generatedMetadata: AutopilotGeneratedMetadata = {
      ...baseMeta,
      metadataFingerprint: computeMetadataFingerprint(baseMeta),
    };

    const analysis: AutopilotVideoAnalysis = {
      analyzedAt: nowIso,
      provider: 'test_multimodal_analyzer',
      model: 'test-multimodal-v1',
      sourceMethod: 'test_multimodal_fixture',
      representativeFrames: fixture.visualScenes,
      visualScenesSummary: fixture.visualScenesSummary,
      transcript: fixture.transcript,
      detectedLanguage: fixture.detectedLanguage || input.policy.language,
      subject: cleanSubject,
      context: fixture.context,
      centralMessage: cleanMessage,
      misleadingOrUnsupportedClaims: fixture.misleadingOrUnsupportedClaims || [],
      sensitiveOrUnsuitableFlags: fixture.sensitiveOrUnsuitableFlags || [],
      platformFormatIssues: [],
      safeToPublish:
        (fixture.misleadingOrUnsupportedClaims || []).length === 0 &&
        (fixture.sensitiveOrUnsuitableFlags || []).length === 0,
      inputTokens: 1200,
      outputTokens: 480,
      estimatedCostUsd: 0.000924,
    };

    return { analysis, generatedMetadata };
  };
}
