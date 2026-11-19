import crypto from 'node:crypto';
import type {
  BrandKnowledgeFact,
  BrandProfile,
  ContentFormat,
  ContentPlatformVariant,
  ContentQualityCheckResult,
  CreativeBriefRecord,
  MarketingContentItem,
  MediaAssetRecord,
  SocialPlatformId,
} from '@/types/domain';

export const PLATFORM_CAPTION_LIMITS: Record<SocialPlatformId, { maxChars: number; maxHashtags: number }> = {
  instagram: { maxChars: 2200, maxHashtags: 30 },
  facebook: { maxChars: 63206, maxHashtags: 15 },
  youtube: { maxChars: 5000, maxHashtags: 15 },
  linkedin: { maxChars: 3000, maxHashtags: 10 },
  tiktok: { maxChars: 2200, maxHashtags: 10 },
  google_business_profile: { maxChars: 1500, maxHashtags: 5 },
};

export interface BrandCreativeIdentityRule {
  brandKey: string;
  visualTone: string;
  mandatoryRules: string[];
  prohibitedPatterns: RegExp[];
  prohibitedSummary: string[];
}

export const STARTER_BRAND_CREATIVE_RULES: Record<string, BrandCreativeIdentityRule> = {
  saket_personal: {
    brandKey: 'saket_personal',
    visualTone: 'Editorial founder minimalism, clean grid typography, real industrial/engineering photography, high contrast.',
    mandatoryRules: [
      'Speak in first-person operational founder perspective grounded in manufacturing and systems.',
      'Avoid hype buzzwords, fake billionaire-coach aesthetics, or unverified revenue claims.',
    ],
    prohibitedPatterns: [
      /\bguaranteed\s+\d+x\s+roi\b/i,
      /\bget\s+rich\s+quick\b/i,
      /\bovernight\s+millionaire\b/i,
    ],
    prohibitedSummary: [
      'No exaggerated income claims or unverified personal revenue numbers',
      'No synthetic testimonials or invented speaking credentials',
    ],
  },
  magnarc: {
    brandKey: 'magnarc',
    visualTone: 'Industrial engineering precision, dark graphite & arc-blue highlights, technical specification callouts only from verified facts.',
    mandatoryRules: [
      'Use only verified technical specifications from Brand Knowledge; never invent amperage, duty-cycle, or ISO certification numbers.',
      'Keep visual layouts clean for industrial buyers, plant engineers, and distributors.',
    ],
    prohibitedPatterns: [
      /\biso\s*9001\s*certified\b/i,
      /\bzero\s+defects?\s+guaranteed\b/i,
      /\bcheapest\s+in\s+india\b/i,
    ],
    prohibitedSummary: [
      'Never invent technical specs, amperage ratings, or unverified ISO/BIS certifications',
      'Never fabricate dealer pricing or discount promises',
    ],
  },
  greenweld: {
    brandKey: 'greenweld',
    visualTone: 'Practical, durable, value-focused industrial visual clarity with high-legibility emerald accents.',
    mandatoryRules: [
      'Highlight practical workshop reliability and honest value without inventing lab efficiency metrics.',
      'Do not fabricate warranty durations or unapproved subsidy/eco-certification claims.',
    ],
    prohibitedPatterns: [
      /\b100%\s+carbon\s+neutral\s+certified\b/i,
      /\blifetime\s+free\s+replacement\b/i,
    ],
    prohibitedSummary: [
      'No unverified sustainability or carbon-neutral certification claims',
      'No unapproved warranty or free replacement promises',
    ],
  },
  sapphire: {
    brandKey: 'sapphire',
    visualTone: 'Precision editorial restraint, clean whitespace, deep sapphire palette, structured product presentation.',
    mandatoryRules: [
      'Maintain refined brand voice and factual product descriptions without exaggerated luxury clichés.',
      'Never invent pricing tiers, material grades, or third-party endorsements.',
    ],
    prohibitedPatterns: [
      /\bworld'?s\s+#?1\s+guaranteed\b/i,
      /\blimited\s+stock\s+ends\s+tonight\b/i,
    ],
    prohibitedSummary: [
      'No false urgency countdowns or fabricated scarcity claims',
      'No invented material grades, pricing, or celebrity endorsements',
    ],
  },
};

export function computeContentPayloadHash(payload: {
  title: string;
  hook?: string;
  body: string;
  cta?: string;
  hashtags?: string[];
  mediaAssetIds?: string[];
  targetPlatforms?: SocialPlatformId[];
  targetAccountId?: string;
  visibility?: string;
}): string {
  const canonical = JSON.stringify({
    title: payload.title.trim(),
    hook: (payload.hook || '').trim(),
    body: payload.body.trim(),
    cta: (payload.cta || '').trim(),
    hashtags: [...(payload.hashtags || [])].map((h) => h.trim().toLowerCase()).sort(),
    mediaAssetIds: [...(payload.mediaAssetIds || [])].sort(),
    targetPlatforms: [...(payload.targetPlatforms || [])].sort(),
    targetAccountId: payload.targetAccountId || '',
    visibility: payload.visibility || '',
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function normalizeHashtags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of raw) {
    const cleaned = tag.trim().replace(/^#+/, '').replace(/[^a-zA-Z0-9_]/g, '');
    if (!cleaned) continue;
    const formatted = `#${cleaned}`;
    const key = formatted.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(formatted);
    }
  }
  return out;
}

export function buildPlatformVariants(params: {
  title: string;
  hook?: string;
  body: string;
  cta?: string;
  hashtags: string[];
  mediaAssetIds: string[];
  targetPlatforms: SocialPlatformId[];
  existingVariants?: ContentPlatformVariant[];
}): ContentPlatformVariant[] {
  const now = new Date().toISOString();
  const existingMap = new Map(
    (params.existingVariants || []).map((v) => [v.platform, v]),
  );
  const cleanTags = normalizeHashtags(params.hashtags);

  return params.targetPlatforms.map((platform) => {
    const prev = existingMap.get(platform);
    const limit = PLATFORM_CAPTION_LIMITS[platform];
    const tags = cleanTags.slice(0, Math.min(limit.maxHashtags, platform === 'linkedin' ? 5 : 8));
    const segments = [
      params.hook?.trim(),
      params.body.trim(),
      params.cta?.trim(),
      tags.length > 0 ? tags.join(' ') : '',
    ].filter(Boolean);

    let caption = segments.join('\n\n');
    if (caption.length > limit.maxChars) {
      caption = `${caption.slice(0, limit.maxChars - 1).trimEnd()}…`;
    }

    const visibility =
      prev?.visibility ||
      (platform === 'youtube' ? 'private' : platform === 'tiktok' ? 'draft' : 'public');

    const payloadHash = computeContentPayloadHash({
      title: params.title,
      hook: params.hook,
      body: caption,
      cta: params.cta,
      hashtags: tags,
      mediaAssetIds: params.mediaAssetIds,
      targetPlatforms: [platform],
      targetAccountId: prev?.targetAccountId,
      visibility,
    });

    return {
      platform,
      title: platform === 'youtube' ? params.title.slice(0, 100) : params.title,
      caption,
      hashtags: tags,
      cta: params.cta,
      mediaAssetIds: [...params.mediaAssetIds],
      targetAccountId: prev?.targetAccountId,
      visibility,
      payloadHash,
      updatedAt: now,
    };
  });
}

const GENERIC_MISLEADING_PATTERNS: Array<{ code: string; pattern: RegExp; message: string }> = [
  {
    code: 'UNSUPPORTED_GUARANTEE',
    pattern: /\b100%\s+guaranteed\b|\bguaranteed\s+results\b/i,
    message: 'Contains an absolute guarantee claim that violates advertising policy and factual accuracy standards.',
  },
  {
    code: 'UNVERIFIED_RANKING',
    pattern: /\b(india'?s|world'?s)\s+(best|#1|number\s+one)\b/i,
    message: 'Contains unverified superlative ranking claim ("#1" / "best") without verifiable citation.',
  },
  {
    code: 'FAKE_PRICE_PROMISE',
    pattern: /\bflat\s+90%\s+off\b|\bfree\s+forever\s+no\s+conditions\b/i,
    message: 'Contains promotional pricing language requiring verified offer documentation.',
  },
];

export function evaluateContentQualityGate(params: {
  brand: BrandProfile;
  brandFacts: BrandKnowledgeFact[];
  title: string;
  hook?: string;
  body: string;
  cta?: string;
  hashtags: string[];
  format: ContentFormat;
  targetPlatforms: SocialPlatformId[];
  variants: ContentPlatformVariant[];
  mediaAssets: MediaAssetRecord[];
  existingItems?: Array<Pick<MarketingContentItem, 'id' | 'title' | 'body' | 'payloadHash'>>;
  currentContentId?: string;
}): ContentQualityCheckResult {
  const warnings: ContentQualityCheckResult['warnings'] = [];
  const prohibitedTermsMatched: string[] = [];
  const platformLimitViolations: ContentQualityCheckResult['platformLimitViolations'] = [];

  const fullText = [params.title, params.hook || '', params.body, params.cta || ''].join('\n');

  // 1. Check generic misleading/policy patterns
  for (const rule of GENERIC_MISLEADING_PATTERNS) {
    const match = fullText.match(rule.pattern);
    if (match) {
      prohibitedTermsMatched.push(match[0]);
      warnings.push({ code: rule.code, message: rule.message, severity: 'error' });
    }
  }

  // 2. Check starter brand specific identity & claim rules
  const starterRule = params.brand.starterKey
    ? STARTER_BRAND_CREATIVE_RULES[params.brand.starterKey]
    : undefined;
  if (starterRule) {
    for (const regex of starterRule.prohibitedPatterns) {
      const m = fullText.match(regex);
      if (m) {
        prohibitedTermsMatched.push(m[0]);
        warnings.push({
          code: 'BRAND_IDENTITY_VIOLATION',
          message: `Matched prohibited claim pattern "${m[0]}" for ${params.brand.name}.`,
          severity: 'error',
        });
      }
    }
  }

  // 3. Check custom brand restrictions & prohibited_claims_and_restrictions facts
  const restrictionFacts = params.brandFacts.filter(
    (f) => f.category === 'prohibited_claims_and_restrictions' && f.approvalStatus === 'approved',
  );
  const restrictionText = [
    params.brand.restrictions || '',
    ...restrictionFacts.map((f) => f.statement),
  ]
    .join(' ')
    .toLowerCase();

  // Extract explicit quoted prohibited phrases e.g. "never say X" or quoted terms
  const quotedRestrictions = Array.from(restrictionText.matchAll(/"([^"]{3,60})"/g)).map((m) => m[1]);
  for (const phrase of quotedRestrictions) {
    if (fullText.toLowerCase().includes(phrase)) {
      prohibitedTermsMatched.push(phrase);
      warnings.push({
        code: 'PROHIBITED_BRAND_TERM',
        message: `Draft contains restricted phrase "${phrase}" defined in ${params.brand.name} brand knowledge.`,
        severity: 'error',
      });
    }
  }

  // 4. Platform caption & hashtag limit checks
  for (const platform of params.targetPlatforms) {
    const limit = PLATFORM_CAPTION_LIMITS[platform];
    const variant = params.variants.find((v) => v.platform === platform);
    const captionLen = (variant?.caption || fullText).length;
    if (captionLen > limit.maxChars) {
      platformLimitViolations.push({ platform, limit: limit.maxChars, actual: captionLen });
      warnings.push({
        code: 'CAPTION_LIMIT_EXCEEDED',
        message: `${platform} caption length (${captionLen}) exceeds maximum ${limit.maxChars} characters.`,
        severity: 'error',
      });
    }
    const hashtagCount = (variant?.hashtags || params.hashtags).length;
    if (hashtagCount > limit.maxHashtags) {
      warnings.push({
        code: 'HASHTAG_LIMIT_EXCEEDED',
        message: `${platform} hashtag count (${hashtagCount}) exceeds limit (${limit.maxHashtags}).`,
        severity: 'warning',
      });
    }
  }

  // 5. Media requirement checks for visual/video platforms & formats
  const visualRequiredFormats: ContentFormat[] = [
    'single_image',
    'carousel',
    'short_video',
    'reel',
    'youtube_video',
    'youtube_short',
  ];
  const needsMedia =
    visualRequiredFormats.includes(params.format) ||
    params.targetPlatforms.includes('instagram') ||
    params.targetPlatforms.includes('youtube') ||
    params.targetPlatforms.includes('tiktok');

  if (needsMedia && params.mediaAssets.length === 0) {
    warnings.push({
      code: 'MEDIA_REQUIRED',
      message: `Format "${params.format}" or selected visual platforms require at least one validated media asset before publishing.`,
      severity: 'error',
    });
  }

  const invalidAssets = params.mediaAssets.filter((a) => a.processingState !== 'validated');
  if (invalidAssets.length > 0) {
    warnings.push({
      code: 'MEDIA_NOT_VALIDATED',
      message: `${invalidAssets.length} attached media asset(s) have not passed media validation.`,
      severity: 'error',
    });
  }

  // 6. Duplicate risk check against existing content items
  let duplicateRisk: ContentQualityCheckResult['duplicateRisk'] = 'none';
  const currentHash = computeContentPayloadHash({
    title: params.title,
    hook: params.hook,
    body: params.body,
    cta: params.cta,
    hashtags: params.hashtags,
    mediaAssetIds: params.mediaAssets.map((a) => a.id),
    targetPlatforms: params.targetPlatforms,
  });

  const others = (params.existingItems || []).filter((i) => i.id !== params.currentContentId);
  if (others.some((i) => i.payloadHash === currentHash)) {
    duplicateRisk = 'high';
    warnings.push({
      code: 'DUPLICATE_CONTENT_DETECTED',
      message: 'An identical content payload already exists in this workspace.',
      severity: 'error',
    });
  } else {
    const normalizedTitle = params.title.trim().toLowerCase();
    if (others.some((i) => i.title.trim().toLowerCase() === normalizedTitle)) {
      duplicateRisk = 'possible';
      warnings.push({
        code: 'SIMILAR_TITLE_DETECTED',
        message: 'Another content item shares this exact title; verify uniqueness before scheduling.',
        severity: 'warning',
      });
    }
  }

  // 7. Readability & minimum substance
  if (params.body.trim().length < 20) {
    warnings.push({
      code: 'BODY_TOO_SHORT',
      message: 'Content body is under 20 characters; add concrete brand value before review.',
      severity: 'warning',
    });
  }

  const errorCount = warnings.filter((w) => w.severity === 'error').length;
  const warningCount = warnings.filter((w) => w.severity === 'warning').length;
  const score = Math.max(0, 100 - errorCount * 30 - warningCount * 10);

  return {
    passed: errorCount === 0,
    checkedAt: new Date().toISOString(),
    score,
    warnings,
    brandFactsChecked: params.brandFacts.length,
    prohibitedTermsMatched,
    platformLimitViolations,
    duplicateRisk,
  };
}

export function buildBrandCreativeBriefDefaults(
  brand: BrandProfile,
  brandFacts: BrandKnowledgeFact[],
): Pick<CreativeBriefRecord, 'brandColorHex' | 'accentColorHex' | 'mandatoryRules' | 'prohibitedClaims'> {
  const starterRule = brand.starterKey ? STARTER_BRAND_CREATIVE_RULES[brand.starterKey] : undefined;
  const factRestrictions = brandFacts
    .filter((f) => f.category === 'prohibited_claims_and_restrictions')
    .map((f) => f.statement);

  const mandatoryRules = [
    ...(starterRule ? starterRule.mandatoryRules : []),
    `Keep visual identity aligned to ${brand.name} primary palette (${brand.primaryColor}).`,
    'Use only verified brand facts from Phase 3 Brand Knowledge; never invent certifications or pricing.',
  ];

  const prohibitedClaims = [
    ...(starterRule ? starterRule.prohibitedSummary : []),
    ...(brand.restrictions ? [brand.restrictions] : []),
    ...factRestrictions,
  ];

  return {
    brandColorHex: brand.primaryColor || '#1D4ED8',
    accentColorHex: brand.accentColor || '#0F172A',
    mandatoryRules,
    prohibitedClaims,
  };
}

export function doesEditInvalidateApproval(
  previous: Pick<MarketingContentItem, 'status' | 'approvedPayloadHash' | 'payloadHash'>,
  newPayloadHash: string,
): boolean {
  if (!previous.approvedPayloadHash) return false;
  return previous.approvedPayloadHash !== newPayloadHash;
}
