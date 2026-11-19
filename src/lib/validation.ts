import { z } from 'zod';

export const DEFAULT_WORKSPACE_TIMEZONE = 'Asia/Kolkata';

const safeIdRegex = /^[a-zA-Z0-9_-]{1,128}$/;
const slugRegex = /^[a-z0-9-]{2,80}$/;
const hexColorRegex = /^#[0-9a-fA-F]{6}$/;

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

export const idSchema = z
  .string()
  .trim()
  .regex(safeIdRegex, 'Identifier must use alphanumeric characters, hyphens, or underscores.');

export const timezoneSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .default(DEFAULT_WORKSPACE_TIMEZONE);

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  jobTitle: z.string().trim().max(100).optional(),
  photoUrl: z
    .string()
    .trim()
    .max(1024)
    .refine(
      (val) => !val || val.startsWith('https://') || val.startsWith('http://'),
      'Photo URL must use http or https.',
    )
    .optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
  locale: z.string().trim().max(24).optional(),
  defaultWorkspaceId: z.string().trim().max(128).optional(),
  onboardingCompleted: z.boolean().optional(),
});

export const onboardingCompleteSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  workspaceName: z.string().trim().min(2, 'Workspace name must be at least 2 characters.').max(120),
  workspaceSlug: z.string().trim().regex(slugRegex).optional(),
  timezone: z.string().trim().min(2).max(64).default(DEFAULT_WORKSPACE_TIMEZONE),
  starterBrands: z
    .array(z.enum(['saket_personal', 'magnarc', 'greenweld', 'sapphire']))
    .max(4)
    .default(['saket_personal', 'magnarc', 'greenweld', 'sapphire']),
});

export const workspaceCreateSchema = z.object({
  name: z.string().trim().min(2, 'Workspace name must be at least 2 characters.').max(120),
  slug: z
    .string()
    .trim()
    .regex(slugRegex, 'Slug must contain only lowercase letters, numbers, and hyphens.')
    .optional(),
  description: z.string().trim().max(500).optional(),
  timezone: z.string().trim().min(2).max(64).default(DEFAULT_WORKSPACE_TIMEZONE),
  includeStarterBrands: z.boolean().optional().default(false),
});

export const workspaceUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  slug: z.string().trim().regex(slugRegex).optional(),
  description: z.string().trim().max(500).optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
});

export const brandCreateSchema = z.object({
  name: z.string().trim().min(2, 'Brand name must be at least 2 characters.').max(100),
  slug: z.string().trim().regex(slugRegex).optional(),
  description: z.string().trim().max(600).optional(),
  industry: z.string().trim().max(80).optional(),
  websiteUrl: z
    .string()
    .trim()
    .max(300)
    .refine(
      (val) => !val || val.startsWith('https://') || val.startsWith('http://'),
      'Website URL must begin with http:// or https://.',
    )
    .optional(),
  targetAudience: z.string().trim().max(500).optional(),
  brandVoice: z.string().trim().max(500).optional(),
  contentPillars: z.array(z.string().trim().min(1).max(80)).max(12).optional().default([]),
  primaryColor: z.string().trim().regex(hexColorRegex, 'Primary color must be a hex color like #1D4ED8.'),
  accentColor: z
    .string()
    .trim()
    .refine((v) => !v || hexColorRegex.test(v), 'Accent color must be a valid 6-digit hex color.')
    .optional(),
  restrictions: z.string().trim().max(600).optional(),
  logoPath: z.string().trim().max(512).optional(),
  starterKey: z.enum(['saket_personal', 'magnarc', 'greenweld', 'sapphire', 'custom']).optional().default('custom'),
  status: z.enum(['draft', 'active', 'archived']).default('active'),
});

export const brandUpdateSchema = brandCreateSchema.partial();

export const memberInviteSchema = z.object({
  email: z.string().trim().email('Valid email address is required.').max(254),
  role: z.enum(['admin', 'manager', 'editor', 'viewer']),
});

export const memberRoleUpdateSchema = z.object({
  role: z.enum(['admin', 'manager', 'editor', 'viewer']),
  status: z.enum(['active', 'suspended']).optional(),
});

export const integrationBoundarySchema = z.object({
  provider: z.string().trim().min(2).max(64),
  category: z.enum(['google_workspace', 'apps_script', 'ai_provider', 'social_media', 'analytics', 'creative']),
  requestedScopes: z.array(z.string().trim().max(200)).max(30).optional().default([]),
  disabled: z.boolean().optional(),
});

export const settingCategorySchema = z.enum([
  'general',
  'account',
  'workspace',
  'brands',
  'integrations',
  'ai_configuration',
  'security',
  'encryption_status',
  'automation',
  'notifications',
  'database_health',
  'deployment_health',
]);

export const settingUpdateSchema = z.object({
  category: settingCategorySchema,
  values: z.record(
    z.string().min(1).max(64),
    z.union([z.string().max(1000), z.number(), z.boolean(), z.array(z.string().max(120)).max(20)]),
  ),
});

export const notificationUpdateSchema = z.object({
  read: z.boolean(),
});

// =============================================================================
// Phase 2 Validation Schemas
// =============================================================================

export const platformGoogleOAuthSetupSchema = z.object({
  workspaceId: idSchema.optional(),
  clientId: z
    .string()
    .trim()
    .min(10, 'Google OAuth Client ID must be valid.')
    .max(256)
    .refine(
      (v) => v.includes('.apps.googleusercontent.com') || v.length >= 16,
      'Google OAuth Client ID format looks invalid.',
    ),
  clientSecret: z.string().trim().min(8, 'Google OAuth Client Secret is required.').max(512),
  redirectUri: z.string().trim().url().max(400).optional(),
});

export const googleAuthorizeStartSchema = z.object({
  workspaceId: idSchema,
  intent: z.enum(['connect', 'incremental_scope', 'reauthorize']).default('connect'),
  capabilityIds: z
    .array(
      z.enum([
        'google_identity',
        'apps_script_projects',
        'apps_script_deployments',
        'drive_discovery',
        'drive_autopilot_read',
        'apps_script_execution',
        'apps_script_processes',
      ]),
    )
    .min(1)
    .default(['google_identity', 'apps_script_projects']),
  extraScopes: z.array(z.string().trim().max(200)).max(20).optional().default([]),
  returnPath: z
    .string()
    .trim()
    .max(200)
    .refine((p) => p.startsWith('/dashboard'), 'Return path must remain inside /dashboard.')
    .optional()
    .default('/dashboard/integrations'),
});

export const googleConnectionShareSchema = z.object({
  sharedWithWorkspace: z.boolean(),
});

export const appsScriptProjectCreateSchema = z.object({
  connectionId: idSchema.optional(),
  title: z.string().trim().min(2, 'Project title must be at least 2 characters.').max(120),
  parentId: z.string().trim().max(128).optional(),
  templateKey: z.string().trim().max(64).optional(),
  idempotencyKey: z.string().trim().min(6).max(128).optional(),
});

export const appsScriptProjectImportSchema = z.object({
  connectionId: idSchema.optional(),
  scriptId: z.string().trim().min(10, 'Valid Apps Script ID is required.').max(128),
  title: z.string().trim().min(1).max(160).optional(),
  parentId: z.string().trim().max(128).optional(),
  ownershipKind: z.enum(['owned_by_user', 'shared_with_user']).optional().default('owned_by_user'),
});

export const appsScriptFileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine(
      (n) => !n.includes('..') && !n.startsWith('/') && !n.includes('\\'),
      'Invalid Apps Script file name.',
    ),
  type: z.enum(['SERVER_JS', 'HTML', 'JSON']),
  source: z.string().max(400_000),
});

export const appsScriptUpdateContentSchema = z.object({
  connectionId: idSchema.optional(),
  files: z.array(appsScriptFileSchema).min(1, 'At least appsscript.json is required.').max(100),
  changeSummary: z.string().trim().min(2).max(240).default('Updated script files via Antara Studio'),
  confirmDestructiveChanges: z.boolean().default(false),
  acknowledgedDeletions: z.array(z.string().trim().max(120)).max(100).optional().default([]),
});

export const appsScriptManifestSchema = z.object({
  timeZone: z.string().trim().min(2).max(64).default(DEFAULT_WORKSPACE_TIMEZONE),
  runtimeVersion: z.enum(['V8', 'DEPRECATED_ES5']).default('V8'),
  exceptionLogging: z.enum(['STACKDRIVER', 'NONE']).default('STACKDRIVER'),
  oauthScopes: z.array(z.string().trim().min(3).max(200)).max(40).optional(),
  webapp: z
    .object({
      access: z.enum(['MYSELF', 'DOMAIN', 'ANYONE', 'ANYONE_ANONYMOUS']).default('MYSELF'),
      executeAs: z.enum(['USER_ACCESSING', 'USER_DEPLOYING']).default('USER_DEPLOYING'),
    })
    .optional(),
  executionApi: z
    .object({
      access: z.enum(['MYSELF', 'DOMAIN', 'ANYONE']).default('MYSELF'),
    })
    .optional(),
});

export const appsScriptVersionCreateSchema = z.object({
  connectionId: idSchema.optional(),
  description: z.string().trim().min(2, 'Version description is required.').max(200),
  changeSummary: z.string().trim().max(300).optional(),
  idempotencyKey: z.string().trim().min(6).max(128).optional(),
});

export const appsScriptDeploymentCreateSchema = z.object({
  connectionId: idSchema.optional(),
  deploymentType: z.enum(['WEB_APP', 'API_EXECUTABLE']),
  versionNumber: z.number().int().min(1).optional(),
  description: z.string().trim().min(2, 'Deployment description is required.').max(200),
  accessLevel: z.enum(['MYSELF', 'DOMAIN', 'ANYONE', 'ANYONE_ANONYMOUS']).optional(),
  executeAs: z.enum(['USER_ACCESSING', 'USER_DEPLOYING']).optional(),
  confirmPublicAccess: z.boolean().default(false),
});

export const appsScriptDeploymentUpdateSchema = z.object({
  connectionId: idSchema.optional(),
  versionNumber: z.number().int().min(1),
  description: z.string().trim().min(2).max(200),
  confirmProductionReplacement: z.boolean().default(false),
});

export const executionTargetRegisterSchema = z.object({
  deploymentId: z.string().trim().min(4).max(160),
  functionName: z
    .string()
    .trim()
    .regex(/^[a-zA-Z_$][a-zA-Z0-9_$]{0,80}$/, 'Invalid Apps Script function identifier.'),
  description: z.string().trim().min(2).max(300),
  requiredScopes: z.array(z.string().trim().max(200)).max(25).default([]),
  riskClassification: z.enum(['low', 'medium', 'high']).default('low'),
  requiresHumanApproval: z.boolean().default(true),
  parameterSchemaJson: z.string().max(4096).default('[]'),
  expectedOutputSummary: z.string().trim().max(300).default('JSON response object'),
  timeoutSeconds: z.number().int().min(5).max(360).default(60),
});

export const appsScriptExecuteSchema = z.object({
  connectionId: idSchema.optional(),
  deploymentId: z.string().trim().min(4).max(160),
  functionName: z
    .string()
    .trim()
    .regex(/^[a-zA-Z_$][a-zA-Z0-9_$]{0,80}$/, 'Invalid Apps Script function identifier.'),
  parameters: z.array(z.unknown()).max(15).default([]),
  approvalConfirmed: z.boolean().default(false),
  idempotencyKey: z.string().trim().min(6).max(128).optional(),
});

export const scriptTriggerInstallSchema = z.object({
  connectionId: idSchema.optional(),
  deploymentId: z.string().trim().min(4).max(160).optional(),
  handler: z
    .string()
    .trim()
    .regex(/^[a-zA-Z_$][a-zA-Z0-9_$]{0,80}$/, 'Invalid Apps Script handler function name.'),
  triggerType: z.enum(['time_hourly', 'time_daily', 'time_weekly', 'on_open', 'on_edit', 'on_change']),
  timezone: z.string().trim().min(2).max(64).default(DEFAULT_WORKSPACE_TIMEZONE),
  intervalValue: z.number().int().min(1).max(24).optional().default(6),
  hourOfDay: z.number().int().min(0).max(23).optional().default(9),
  approvalConfirmed: z.boolean().default(false),
});

// =============================================================================
// Phase 3 Validation Schemas
// =============================================================================

export const agentIdSchema = z.enum([
  '01_orchestrator',
  '02_market_radar',
  '03_search_visibility',
  '04_content_engine',
  '05_creative_studio',
  '06_publishing_social',
  '07_reviews_reputation',
  '08_leads_conversations',
  '09_results_roi',
]);

export const modelTaskClassSchema = z.enum([
  'fast_routing',
  'classification',
  'research_synthesis',
  'deep_reasoning',
  'copy_generation',
  'qa_critique',
  'embedding',
]);

export const memoryNamespaceSchema = z.enum([
  'workspace_memory',
  'brand_memory',
  'content_memory',
  'performance_memory',
  'research_memory',
  'decision_memory',
  'rejection_memory',
]);

export const brandFactCategorySchema = z.enum([
  'identity_and_positioning',
  'mission_and_values',
  'products_and_services',
  'technical_capabilities',
  'pricing_and_offers',
  'target_audiences_icp',
  'pain_points_and_objections',
  'value_propositions',
  'differentiators',
  'brand_voice_and_tone',
  'terminology_and_preferred_phrases',
  'prohibited_claims_and_restrictions',
  'compliance_and_legal_constraints',
  'geographic_markets_and_languages',
  'competitor_landscape',
  'proof_points_and_metrics',
  'customer_testimonials_case_studies',
  'visual_identity_and_creative_guidelines',
  'channel_priorities_and_rules',
  'faqs_and_objection_handling',
]);

export const verificationStatusSchema = z.enum([
  'VERIFIED',
  'SUPPORTED',
  'INFERRED',
  'UNVERIFIED',
  'CONTRADICTED',
]);

export const aiCommandRequestSchema = z.object({
  prompt: z.string().trim().min(3, 'Enter an instruction or question at least 3 characters long.').max(6000),
  brandId: idSchema.optional(),
  conversationId: idSchema.optional(),
  preferredAgentIds: z.array(agentIdSchema).max(9).optional(),
  complexityHint: z.enum(['simple', 'standard', 'deep']).optional(),
  idempotencyKey: z.string().trim().min(6).max(128).optional(),
  stream: z.boolean().optional().default(false),
});

export const agentConfigPatchSchema = z.object({
  enabled: z.boolean().optional(),
  preferredTaskClass: modelTaskClassSchema.optional(),
  maxStepsOverride: z.number().int().min(1).max(12).optional(),
  customFocusNote: z.string().trim().max(800).optional(),
});

export const brandFactCreateSchema = z.object({
  brandId: idSchema,
  category: brandFactCategorySchema,
  title: z.string().trim().min(2).max(160),
  statement: z.string().trim().min(4).max(2000),
  verificationStatus: verificationStatusSchema.default('UNVERIFIED'),
  sourceUrl: z
    .string()
    .trim()
    .max(512)
    .refine((v) => !v || v.startsWith('https://') || v.startsWith('http://'), 'URL must start with http:// or https://')
    .optional(),
  publishedAt: z.string().trim().max(64).optional(),
});

export const memoryItemCreateSchema = z.object({
  brandId: idSchema.optional(),
  namespace: memoryNamespaceSchema,
  title: z.string().trim().min(2).max(180),
  content: z.string().trim().min(4).max(4000),
  tags: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  verificationStatus: verificationStatusSchema.default('INFERRED'),
  provenanceRef: z.string().trim().min(2).max(300).default('manual_entry'),
});

export const memoryDecisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'supersede']),
  reason: z.string().trim().max(400).optional(),
  replacementContent: z.string().trim().max(4000).optional(),
});

export const researchRunRequestSchema = z.object({
  brandId: idSchema.optional(),
  query: z.string().trim().min(3).max(2000),
  urlsToInspect: z
    .array(
      z
        .string()
        .trim()
        .max(512)
        .refine((u) => u.startsWith('https://') || u.startsWith('http://'), 'Only http(s) URLs are supported.'),
    )
    .max(6)
    .optional()
    .default([]),
  includeSeoAudit: z.boolean().optional().default(true),
});

export const claimActionSchema = z.object({
  action: z.enum(['promote_to_memory', 'reject', 'create_brief']),
  brandId: idSchema.optional(),
  note: z.string().trim().max(400).optional(),
});

export const strategyGenerateSchema = z.object({
  brandId: idSchema,
  horizonDays: z.union([z.literal(7), z.literal(14), z.literal(30)]).default(14),
  objective: z.string().trim().min(4).max(1200),
  focusChannels: z
    .array(z.enum(['linkedin', 'instagram', 'blog', 'email', 'short_video_script', 'ad_copy']))
    .min(1)
    .max(6)
    .default(['linkedin', 'blog']),
});

export const contentDraftCreateSchema = z.object({
  brandId: idSchema,
  strategyId: idSchema.optional(),
  channel: z.enum(['linkedin', 'instagram', 'blog', 'email', 'short_video_script', 'ad_copy', 'general']),
  title: z.string().trim().min(2).max(180),
  topic: z.string().trim().min(3).max(1200),
});

export const playbookIdSchema = z.enum([
  '01_search_demand_spikes',
  '02_competitor_drops_promo',
  '03_one_star_review_lands',
  '04_content_calendar_thin',
  '05_post_goes_viral',
  '06_ranking_drops_page',
  '07_ad_creative_fatigues',
  '08_dm_lead_arrives_night',
]);

export const normalizedEventTriggerSchema = z.object({
  eventType: playbookIdSchema,
  brandId: idSchema.optional(),
  source: z.enum(['manual_test', 'webhook', 'scheduled_check', 'internal']).default('manual_test'),
  isTestFixture: z.boolean().default(true),
  dedupeKey: z.string().trim().min(4).max(160).optional(),
  occurredAt: z.string().trim().max(64).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const aiStructuredAgentOutputSchema = z.object({
  summary: z.string().min(1).max(2500),
  findings: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        summary: z.string().min(1).max(1200),
        verificationStatus: verificationStatusSchema.default('INFERRED'),
        confidence: z.number().min(0).max(1).default(0.6),
        sourceUrls: z.array(z.string().max(512)).max(10).default([]),
      }),
    )
    .max(12)
    .default([]),
  recommendations: z
    .array(
      z.object({
        action: z.string().min(1).max(400),
        rationale: z.string().min(1).max(800),
        priority: z.enum(['high', 'medium', 'low']).default('medium'),
        requiresApproval: z.boolean().default(true),
      }),
    )
    .max(10)
    .default([]),
  claims: z
    .array(
      z.object({
        claimText: z.string().min(2).max(600),
        verificationStatus: verificationStatusSchema.default('UNVERIFIED'),
        confidence: z.number().min(0).max(1).default(0.5),
        sourceUrls: z.array(z.string().max(512)).max(8).default([]),
      }),
    )
    .max(15)
    .default([]),
  artifactTitle: z.string().min(1).max(200).optional(),
  artifactMarkdown: z.string().max(15000).optional(),
  structuredData: z.record(z.string(), z.unknown()).optional(),
  assumptions: z.array(z.string().max(400)).max(10).default([]),
  uncertaintyNotes: z.array(z.string().max(400)).max(10).default([]),
  memoryCandidates: z
    .array(
      z.object({
        namespace: memoryNamespaceSchema,
        title: z.string().min(2).max(180),
        content: z.string().min(4).max(2000),
        tags: z.array(z.string().max(40)).max(10).default([]),
      }),
    )
    .max(6)
    .default([]),
});

// =============================================================================
// Phase 4 Validation Schemas
// =============================================================================

export const socialPlatformSchema = z.enum([
  'instagram',
  'facebook',
  'youtube',
  'linkedin',
  'tiktok',
  'google_business_profile',
]);

export const phase4ProviderSchema = z.enum([
  'instagram',
  'facebook',
  'youtube',
  'linkedin',
  'tiktok',
  'google_business_profile',
  'canva',
  'meta_ads',
]);

export const contentFormatSchema = z.enum([
  'text_post',
  'single_image',
  'carousel',
  'short_video',
  'reel',
  'youtube_video',
  'youtube_short',
  'blog_article',
  'email_newsletter',
  'ad_creative',
  'gbp_update',
]);

export const contentLifecycleStatusSchema = z.enum([
  'IDEA',
  'RESEARCHED',
  'BRIEF_CREATED',
  'DRAFTED',
  'CREATIVE_IN_PROGRESS',
  'ASSET_READY',
  'VALIDATION_PENDING',
  'READY_FOR_REVIEW',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHING',
  'PROCESSING',
  'PUBLISHED',
  'ANALYTICS_PENDING',
  'ANALYZED',
  'REJECTED',
  'CANCELLED',
  'FAILED',
  'BLOCKED_BY_PERMISSION',
  'BLOCKED_BY_POLICY',
  'NEEDS_REVISION',
]);

export const growthObjectiveCreateSchema = z.object({
  brandId: idSchema,
  period: z.enum(['weekly', 'monthly', 'quarterly']).default('monthly'),
  title: z.string().trim().min(3).max(180),
  targetMetric: z.string().trim().min(2).max(80),
  targetValue: z.number().finite().positive(),
  currentValue: z.number().finite().nonnegative().nullable().optional().default(null),
  unit: z.string().trim().min(1).max(32).default('count'),
  priority: z.enum(['high', 'medium', 'low']).default('high'),
  notes: z.string().trim().max(500).optional(),
});

export const marketingContentCreateSchema = z.object({
  brandId: idSchema,
  title: z.string().trim().min(2).max(200),
  format: contentFormatSchema.default('text_post'),
  objective: z.string().trim().max(300).optional(),
  campaignTag: z.string().trim().max(80).optional(),
  hook: z.string().trim().max(300).optional(),
  body: z.string().trim().min(5).max(15000),
  cta: z.string().trim().max(300).optional(),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(30).optional().default([]),
  targetPlatforms: z.array(socialPlatformSchema).min(1).max(6),
  mediaAssetIds: z.array(idSchema).max(10).optional().default([]),
  creativeBriefId: idSchema.optional(),
  sourcePhase3RunId: idSchema.optional(),
  generatePlatformVariants: z.boolean().optional().default(true),
});

export const marketingContentUpdateSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  format: contentFormatSchema.optional(),
  status: contentLifecycleStatusSchema.optional(),
  objective: z.string().trim().max(300).optional(),
  campaignTag: z.string().trim().max(80).optional(),
  hook: z.string().trim().max(300).optional(),
  body: z.string().trim().min(5).max(15000).optional(),
  cta: z.string().trim().max(300).optional(),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  targetPlatforms: z.array(socialPlatformSchema).min(1).max(6).optional(),
  mediaAssetIds: z.array(idSchema).max(10).optional(),
  changeNote: z.string().trim().max(240).optional().default('Content updated'),
  runQualityCheck: z.boolean().optional().default(true),
  submitForReview: z.boolean().optional().default(false),
});

export const creativeBriefCreateSchema = z.object({
  brandId: idSchema,
  contentItemId: idSchema.optional(),
  title: z.string().trim().min(2).max(180),
  format: contentFormatSchema.default('single_image'),
  targetPlatform: socialPlatformSchema.default('instagram'),
  visualDirection: z.string().trim().min(5).max(1500),
  headlineText: z.string().trim().min(2).max(180),
  supportingCopy: z.string().trim().max(600).optional().default(''),
  aspectRatio: z.enum(['1:1', '4:5', '9:16', '16:9', '1.91:1']).default('4:5'),
  canvaTemplateId: z.string().trim().max(128).optional(),
});

export const canvaExportRequestSchema = z.object({
  brandId: idSchema.optional(),
  creativeBriefId: idSchema.optional(),
  canvaDesignId: z.string().trim().min(3).max(128),
  format: z.enum(['png', 'jpg', 'pdf', 'mp4']).default('png'),
});

export const mediaAssetRegisterSchema = z.object({
  brandId: idSchema.optional(),
  contentItemId: idSchema.optional(),
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(3).max(120),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive().max(16384).optional(),
  height: z.number().int().positive().max(16384).optional(),
  durationSeconds: z.number().nonnegative().max(43200).optional(),
  sha256: z.string().trim().regex(/^[a-fA-F0-9]{64}$/, 'SHA-256 checksum must be 64 hex chars.').optional(),
  storagePath: z.string().trim().min(3).max(500).optional(),
  source: z.enum(['upload', 'canva_export', 'google_drive', 'external_import']).default('upload'),
});

export const schedulePostCreateSchema = z.object({
  brandId: idSchema,
  contentItemId: idSchema,
  platform: socialPlatformSchema,
  accountId: idSchema,
  scheduledForUtc: z.string().trim().datetime({ offset: true }),
  timezone: z.string().trim().min(2).max(64).default(DEFAULT_WORKSPACE_TIMEZONE),
  approvalRequestId: idSchema.optional(),
  idempotencyKey: z.string().trim().min(6).max(128).optional(),
});

export const schedulePostUpdateSchema = z.object({
  action: z.enum(['reschedule', 'cancel', 'duplicate', 'reconcile_check']),
  scheduledForUtc: z.string().trim().datetime({ offset: true }).optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
  reason: z.string().trim().max(300).optional(),
});

export const publishExecuteSchema = z.object({
  brandId: idSchema,
  contentItemId: idSchema,
  platform: socialPlatformSchema,
  accountId: idSchema,
  scheduledPostId: idSchema.optional(),
  approvalRequestId: idSchema.optional(),
  idempotencyKey: z.string().trim().min(6).max(128).optional(),
  dryRun: z.boolean().optional().default(false),
});

export const approvalDecisionSchema = z.object({
  action: z.enum(['approve', 'reject', 'hold', 'cancel']),
  note: z.string().trim().max(500).optional(),
});

export const autonomyPolicyUpsertSchema = z.object({
  brandId: idSchema,
  publishingMode: z.enum(['DRAFT_ONLY', 'APPROVAL_REQUIRED', 'AUTHORIZED_AUTO_PUBLISHING']),
  allowedAutoPlatforms: z.array(socialPlatformSchema).max(6).default([]),
  allowedAutoFormats: z.array(contentFormatSchema).max(11).default([]),
  maxAutoPostsPerDay: z.number().int().min(0).max(50).default(2),
  commentReplyPolicy: z.enum(['draft_only', 'approval_required', 'auto_non_sensitive']).default('approval_required'),
  dmReplyPolicy: z.enum(['draft_only', 'approval_required']).default('approval_required'),
  reviewReplyPolicy: z.enum(['draft_only', 'approval_required', 'auto_positive_only']).default('approval_required'),
  leadOutreachPolicy: z.enum(['internal_tasks_only', 'approval_required']).default('internal_tasks_only'),
  paidAdsPolicy: z.enum(['disabled', 'analysis_and_draft_only', 'approved_cap_only']).default('disabled'),
  requireQualityGatePass: z.boolean().default(true),
  blockSensitiveTopicsAuto: z.boolean().default(true),
  policyExpiresAt: z.string().trim().datetime({ offset: true }).optional(),
  paused: z.boolean().default(false),
  pausedPlatforms: z.array(socialPlatformSchema).max(6).default([]),
});

export const emergencyStopUpdateSchema = z.object({
  globalStopped: z.boolean().optional(),
  reason: z.string().trim().max(300).optional(),
  pausedBrandIds: z.array(idSchema).max(50).optional(),
  pausedPlatforms: z.array(socialPlatformSchema).max(6).optional(),
});

export const inboxActionSchema = z.object({
  action: z.enum(['draft_reply', 'request_approval', 'send_reply', 'assign', 'resolve', 'escalate', 'ingest_message']),
  conversationId: idSchema.optional(),
  brandId: idSchema.optional(),
  platform: socialPlatformSchema.optional(),
  accountId: idSchema.optional(),
  channelType: z.enum(['comment', 'dm', 'mention']).optional(),
  participantName: z.string().trim().max(120).optional(),
  messageText: z.string().trim().max(4000).optional(),
  replyText: z.string().trim().max(4000).optional(),
  approvalRequestId: idSchema.optional(),
  assignedToUid: z.string().trim().max(128).optional(),
  messagingWindowType: z.enum(['standard_24h', 'click_to_message_ad', 'comment_public', 'not_applicable']).optional(),
  messagingWindowExpiresAt: z.string().trim().datetime({ offset: true }).optional(),
});

export const reviewActionSchema = z.object({
  action: z.enum(['ingest_review', 'draft_reply', 'request_approval', 'publish_reply', 'escalate']),
  reviewId: idSchema.optional(),
  brandId: idSchema.optional(),
  platform: z.enum(['google_business_profile', 'facebook']).optional(),
  accountId: idSchema.optional(),
  locationName: z.string().trim().max(160).optional(),
  reviewerName: z.string().trim().max(120).optional(),
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  comment: z.string().trim().max(4000).optional(),
  replyText: z.string().trim().max(4000).optional(),
  approvalRequestId: idSchema.optional(),
});

export const leadCreateSchema = z.object({
  brandId: idSchema,
  fullName: z.string().trim().min(2).max(140),
  companyName: z.string().trim().max(140).optional(),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().max(40).optional(),
  sourceChannel: z.enum(['instagram', 'facebook', 'youtube', 'linkedin', 'tiktok', 'google_business_profile', 'website', 'manual', 'apps_script']).default('manual'),
  consentStatus: z.enum(['explicit_opt_in', 'inbound_inquiry_only', 'unconfirmed', 'opted_out']).default('inbound_inquiry_only'),
  consentProvenance: z.string().trim().min(3).max(300),
  notes: z.string().trim().max(2000).optional(),
});

export const leadUpdateSchema = z.object({
  leadId: idSchema,
  stage: z.enum(['NEW', 'IDENTIFIED', 'QUALIFICATION_PENDING', 'QUALIFIED', 'FOLLOW_UP', 'CONVERTED', 'LOST', 'ARCHIVED']).optional(),
  assignedToUid: z.string().trim().max(128).optional(),
  nextFollowUpAt: z.string().trim().datetime({ offset: true }).optional(),
  activityNote: z.string().trim().max(1000).optional(),
  activityType: z.enum(['note', 'stage_change', 'internal_followup_task', 'approved_outreach']).optional(),
});

export const campaignBudgetPolicySchema = z.object({
  brandId: idSchema,
  currency: z.enum(['INR', 'USD']).default('INR'),
  enabled: z.boolean().default(false),
  maxDailySpend: z.number().positive().max(10_000_000).nullable(),
  maxMonthlySpend: z.number().positive().max(100_000_000).nullable(),
  ownerExplicitAuthorization: z.boolean().default(false),
});

export const adCampaignCreateSchema = z.object({
  brandId: idSchema,
  accountId: idSchema.optional(),
  name: z.string().trim().min(3).max(160),
  objective: z.enum(['awareness', 'traffic', 'engagement', 'leads', 'sales']).default('leads'),
  dailyBudget: z.number().positive().max(10_000_000).nullable(),
  totalBudget: z.number().positive().max(100_000_000).nullable(),
  currency: z.enum(['INR', 'USD']).default('INR'),
  audienceSummary: z.string().trim().min(5).max(800),
  creativeBriefIds: z.array(idSchema).max(10).optional().default([]),
  requestLaunchApproval: z.boolean().optional().default(false),
});

export const analyticsSnapshotIngestSchema = z.object({
  brandId: idSchema,
  platform: z.enum(['instagram', 'facebook', 'youtube', 'linkedin', 'tiktok', 'google_business_profile', 'meta_ads']),
  accountId: idSchema.optional(),
  contentItemId: idSchema.optional(),
  externalObjectId: z.string().trim().max(160).optional(),
  periodStart: z.string().trim().datetime({ offset: true }),
  periodEnd: z.string().trim().datetime({ offset: true }),
  timezone: z.string().trim().min(2).max(64).default(DEFAULT_WORKSPACE_TIMEZONE),
  sourceApi: z.string().trim().min(2).max(120),
  attributionNote: z.string().trim().min(3).max(300),
  currency: z.enum(['INR', 'USD']).optional(),
  engagementDefinition: z.string().trim().min(2).max(160).default('likes + comments + shares + saves'),
  metrics: z.object({
    impressions: z.number().nonnegative().nullable().optional().default(null),
    reach: z.number().nonnegative().nullable().optional().default(null),
    engagements: z.number().nonnegative().nullable().optional().default(null),
    clicks: z.number().nonnegative().nullable().optional().default(null),
    videoViews: z.number().nonnegative().nullable().optional().default(null),
    followersDelta: z.number().nullable().optional().default(null),
    leadsAttributed: z.number().nonnegative().nullable().optional().default(null),
    spendAmount: z.number().nonnegative().nullable().optional().default(null),
    revenueAmount: z.number().nonnegative().nullable().optional().default(null),
  }),
});

export const experimentCreateSchema = z.object({
  brandId: idSchema,
  title: z.string().trim().min(3).max(180),
  hypothesis: z.string().trim().min(5).max(800),
  platform: socialPlatformSchema,
  primaryMetric: z.enum(['engagements', 'clicks', 'videoViews', 'leadsAttributed']).default('engagements'),
  controlContentId: idSchema.optional(),
  variantContentId: idSchema.optional(),
  minSampleSize: z.number().int().min(10).max(1_000_000).default(100),
});

// =============================================================================
// Phase 5.1 — Drive-to-Social Autopilot Validation Schemas
// =============================================================================

export const autopilotTimeWindowSchema = z
  .object({
    startHour: z.number().int().min(0).max(23),
    startMinute: z.number().int().min(0).max(59).default(0),
    endHour: z.number().int().min(0).max(23),
    endMinute: z.number().int().min(0).max(59).default(59),
  })
  .refine(
    (w) => w.endHour * 60 + w.endMinute > w.startHour * 60 + w.startMinute,
    'Time window end must be after start.',
  );

export const autopilotPolicyCreateSchema = z.object({
  brandId: idSchema,
  name: z.string().trim().min(2, 'Policy name must be at least 2 characters.').max(140),
  googleConnectionId: idSchema,
  sourceFolderId: z.string().trim().min(2, 'Google Drive folder ID is required.').max(180),
  sourceFolderName: z.string().trim().min(1).max(200).optional(),
  includeSubfolders: z.boolean().default(true),
  maxSubfolderDepth: z.number().int().min(0).max(6).default(3),
  destinationAccountIds: z.array(idSchema).max(20).default([]),
  allowedFormats: z
    .array(contentFormatSchema)
    .min(1)
    .max(6)
    .default(['reel', 'youtube_short', 'short_video']),
  maxPostsPerDay: z.number().int().min(1).max(20).default(2),
  minGapMinutes: z.number().int().min(15).max(1440).default(180),
  publishingDays: z
    .array(z.number().int().min(0).max(6))
    .min(1, 'Select at least one publishing day.')
    .max(7)
    .default([1, 2, 3, 4, 5, 6]),
  dailyTimeWindows: z
    .array(autopilotTimeWindowSchema)
    .min(1, 'Configure at least one daily publishing window.')
    .max(6)
    .default([{ startHour: 10, startMinute: 0, endHour: 20, endMinute: 0 }]),
  timezone: timezoneSchema,
  orderingMode: z.enum(['chronological', 'priority_first']).default('chronological'),
  language: z.string().trim().min(2).max(40).default('English'),
  captionStyle: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .default('Clear, engaging, grounded in the actual video without hype'),
  hashtagStrategy: z.enum(['focused', 'balanced', 'discovery']).default('balanced'),
  maxHashtags: z.number().int().min(0).max(25).default(8),
  executionMode: z
    .enum(['DRAFT_ONLY', 'APPROVAL_REQUIRED', 'AUTOMATIC_PUBLISHING'])
    .default('APPROVAL_REQUIRED'),
  authorizedAutoPublishAccountIds: z.array(idSchema).max(20).default([]),
  duplicatePrevention: z
    .object({
      byDriveFileId: z.boolean().default(true),
      byContentHash: z.boolean().default(true),
      allowExplicitReprocess: z.boolean().default(true),
    })
    .default({ byDriveFileId: true, byContentHash: true, allowExplicitReprocess: true }),
  maxProcessingCostUsdPerDay: z.number().min(0.1).max(500).default(5),
  failurePolicy: z
    .object({
      maxRetries: z.number().int().min(0).max(6).default(3),
      pauseOnAuthExpired: z.boolean().default(true),
      pauseOnPolicyViolation: z.boolean().default(true),
      pauseOnCostExceeded: z.boolean().default(true),
    })
    .default({
      maxRetries: 3,
      pauseOnAuthExpired: true,
      pauseOnPolicyViolation: true,
      pauseOnCostExceeded: true,
    }),
});

export const autopilotPolicyUpdateSchema = z.object({
  action: z.enum(['update', 'pause', 'resume']).optional().default('update'),
  pauseReason: z.string().trim().max(300).optional(),
  name: z.string().trim().min(2).max(140).optional(),
  includeSubfolders: z.boolean().optional(),
  maxSubfolderDepth: z.number().int().min(0).max(6).optional(),
  destinationAccountIds: z.array(idSchema).max(20).optional(),
  allowedFormats: z.array(contentFormatSchema).min(1).max(6).optional(),
  maxPostsPerDay: z.number().int().min(1).max(20).optional(),
  minGapMinutes: z.number().int().min(15).max(1440).optional(),
  publishingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  dailyTimeWindows: z.array(autopilotTimeWindowSchema).min(1).max(6).optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
  orderingMode: z.enum(['chronological', 'priority_first']).optional(),
  language: z.string().trim().min(2).max(40).optional(),
  captionStyle: z.string().trim().min(2).max(160).optional(),
  hashtagStrategy: z.enum(['focused', 'balanced', 'discovery']).optional(),
  maxHashtags: z.number().int().min(0).max(25).optional(),
  executionMode: z.enum(['DRAFT_ONLY', 'APPROVAL_REQUIRED', 'AUTOMATIC_PUBLISHING']).optional(),
  authorizedAutoPublishAccountIds: z.array(idSchema).max(20).optional(),
  maxProcessingCostUsdPerDay: z.number().min(0.1).max(500).optional(),
  failurePolicy: z
    .object({
      maxRetries: z.number().int().min(0).max(6),
      pauseOnAuthExpired: z.boolean(),
      pauseOnPolicyViolation: z.boolean(),
      pauseOnCostExceeded: z.boolean(),
    })
    .optional(),
});

export const autopilotFileActionSchema = z.object({
  action: z.enum([
    'edit_metadata',
    'approve',
    'skip',
    'unskip',
    'retry_failed_jobs',
    'request_reprocess',
    'set_priority',
  ]),
  priority: z.number().int().min(0).max(100).optional(),
  note: z.string().trim().max(400).optional(),
  metadata: z
    .object({
      contentTitle: z.string().trim().min(2).max(160).optional(),
      openingHook: z.string().trim().min(2).max(280).optional(),
      instagramCaption: z.string().trim().min(2).max(2200).optional(),
      youtubeTitle: z.string().trim().min(2).max(100).optional(),
      youtubeDescription: z.string().trim().min(2).max(5000).optional(),
      hashtags: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
      keywords: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
      cta: z.string().trim().max(300).optional(),
      shortDescription: z.string().trim().max(400).optional(),
      suggestedThumbnailText: z.string().trim().max(80).optional(),
    })
    .optional(),
});




