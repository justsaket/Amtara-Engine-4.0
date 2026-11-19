export type WorkspaceRole = 'owner' | 'admin' | 'manager' | 'editor' | 'viewer';

export type MemberStatus = 'active' | 'invited' | 'suspended';

export type PlanTier = 'foundation' | 'growth' | 'enterprise';

export type BrandStatus = 'draft' | 'active' | 'archived';

export type StarterBrandKey =
  | 'saket_personal'
  | 'magnarc'
  | 'greenweld'
  | 'sapphire'
  | 'custom';

export type ConfigurationClassification =
  | 'automatically_configured'
  | 'already_available'
  | 'generated_internally'
  | 'connected_via_oauth'
  | 'requires_external_authorization'
  | 'optional_unused'
  | 'disabled';

export type IntegrationStatus =
  | 'not_configured'
  | 'authorization_required'
  | 'connected'
  | 'expired'
  | 'error'
  | 'disabled';

export type IntegrationCategory =
  | 'google_workspace'
  | 'apps_script'
  | 'ai_provider'
  | 'social_media'
  | 'analytics'
  | 'creative';

export type SettingCategory =
  | 'general'
  | 'account'
  | 'workspace'
  | 'brands'
  | 'integrations'
  | 'ai_configuration'
  | 'security'
  | 'encryption_status'
  | 'automation'
  | 'notifications'
  | 'database_health'
  | 'deployment_health';

export type Permission =
  | 'workspace:read'
  | 'workspace:update'
  | 'workspace:delete'
  | 'members:read'
  | 'members:invite'
  | 'members:update_role'
  | 'members:remove'
  | 'brands:read'
  | 'brands:create'
  | 'brands:update'
  | 'brands:delete'
  | 'integrations:read'
  | 'integrations:configure'
  | 'google:read'
  | 'google:connect'
  | 'google:disconnect'
  | 'apps_script:read'
  | 'apps_script:write'
  | 'apps_script:deploy'
  | 'apps_script:execute'
  | 'apps_script:approve'
  | 'settings:read'
  | 'settings:update'
  | 'security:manage'
  | 'notifications:read'
  | 'audit:read'
  | 'roadmap:read'
  | 'ai:read'
  | 'ai:run'
  | 'agents:configure'
  | 'memory:read'
  | 'memory:propose'
  | 'memory:approve'
  | 'research:read'
  | 'research:run'
  | 'strategy:write'
  | 'playbooks:trigger'
  | 'marketing:read'
  | 'content:write'
  | 'content:approve'
  | 'assets:write'
  | 'publishing:schedule'
  | 'publishing:execute'
  | 'autonomy:manage'
  | 'inbox:reply'
  | 'reviews:reply'
  | 'leads:manage'
  | 'campaigns:manage'
  | 'analytics:read'
  | 'emergency:stop';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  jobTitle?: string;
  photoUrl?: string;
  timezone: string;
  locale?: string;
  defaultWorkspaceId?: string;
  onboardingCompleted: boolean;
  authProvider: 'password' | 'google.com' | 'unknown';
  accountDeletionStatus?: 'none' | 'requested';
  accountDeletionRequestedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserMembershipIndex {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: WorkspaceRole;
  status: MemberStatus;
  joinedAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description?: string;
  ownerId: string;
  timezone: string;
  planTier: PlanTier;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceWithRole extends Workspace {
  role: WorkspaceRole;
  brandCount: number;
  memberCount: number;
  connectedIntegrationCount: number;
}

export interface WorkspaceMember {
  uid: string;
  workspaceId: string;
  email: string;
  displayName: string;
  role: WorkspaceRole;
  status: MemberStatus;
  invitedBy: string;
  joinedAt: string;
  updatedAt: string;
}

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  status: 'pending' | 'accepted' | 'revoked';
  invitedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrandProfile {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description?: string;
  industry?: string;
  websiteUrl?: string;
  targetAudience?: string;
  brandVoice?: string;
  contentPillars: string[];
  primaryColor: string;
  accentColor?: string;
  restrictions?: string;
  logoPath?: string;
  starterKey?: StarterBrandKey;
  status: BrandStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationRecord {
  id: string;
  workspaceId: string;
  provider: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  capabilityClass: ConfigurationClassification;
  accountEmail?: string;
  accountName?: string;
  grantedScopes: string[];
  requestedScopes?: string[];
  hasRefreshToken?: boolean;
  consentSeparatedFromLogin: true;
  lastVerifiedAt?: string;
  lastErrorMessage?: string;
  configuredBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationSetting {
  id: string;
  workspaceId: string;
  category: SettingCategory;
  values: Record<string, string | number | boolean | string[]>;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  workspaceId: string;
  actorUid: string;
  actorEmail?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  summary?: string;
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  workspaceId: string;
  recipientUid: string;
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  category: string;
  read: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutonomousConfigItem {
  id: string;
  label: string;
  domain: 'core' | 'auth' | 'firebase' | 'encryption' | 'google' | 'ai' | 'social' | 'testing';
  classification: ConfigurationClassification;
  configured: boolean;
  source: string;
  summary: string;
  maskedPreview?: string;
  actionRequired?: string;
}

export interface AutonomousConfigSnapshot {
  environment: {
    nodeEnv: string;
    appUrl: string;
    isVercel: boolean;
    vercelEnv?: string;
    defaultTimezone: string;
  };
  firebase: {
    clientConfigured: boolean;
    clientSource: 'env' | 'firebase_applet_config' | 'env_and_applet_config' | 'missing';
    projectId: string | null;
    databaseId: string;
    isDefaultDatabase: boolean;
    adminAvailable: boolean;
    adminCredentialMode: 'service_account_json' | 'service_account_fields' | 'adc_or_none';
    restFallbackSupported: boolean;
    projectConflict: boolean;
    projectConflictDetail?: string;
    storageBucketConfigured: boolean;
  };
  secrets: {
    sessionSecretConfigured: boolean;
    sessionSecretSource: 'env' | 'local_file' | 'ephemeral_dev' | 'missing';
    encryptionKeyConfigured: boolean;
    encryptionKeyVersion: string;
    encryptionKeySource: 'env' | 'local_file' | 'missing';
    rotationActive: boolean;
    previousKeyVersion?: string;
    serverlessWarning?: string;
  };
  capabilities: {
    authReady: boolean;
    databaseReady: boolean;
    encryptedVaultReady: boolean;
    geminiConfigured: boolean;
    aiConfigured?: boolean;
    activeAiProviders?: string[];
    searchConfigured?: boolean;
    googleOAuthConfigured: boolean;
    appsScriptReadyForPhase2: boolean;
    realGoogleTestsEnabled: boolean;
  };
  items: AutonomousConfigItem[];
  generatedAt: string;
}

export interface ApiSuccessResponse<T> {
  ok: true;
  data: T;
}

export interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, string[] | undefined>;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// =============================================================================
// Phase 2: Google Access Control Plane & Apps Script Engine Types
// =============================================================================

export type GoogleCapabilityId =
  | 'google_identity'
  | 'apps_script_projects'
  | 'apps_script_deployments'
  | 'drive_discovery'
  | 'drive_autopilot_read'
  | 'apps_script_execution'
  | 'apps_script_processes';

export type CapabilityAvailability =
  | 'AVAILABLE'
  | 'PERMISSION_REQUIRED'
  | 'APP_CONFIG_REQUIRED'
  | 'USER_AUTHORIZATION_REQUIRED'
  | 'UNSUPPORTED';

export interface GoogleCapabilityDescriptor {
  id: GoogleCapabilityId;
  name: string;
  requiredApi: string;
  requiredScopes: string[];
  riskCategory: 'low' | 'medium' | 'high';
  explanation: string;
  requiresAppsScriptUserSetting?: boolean;
}

export interface EvaluatedGoogleCapability extends GoogleCapabilityDescriptor {
  availability: CapabilityAvailability;
  grantedScopes: string[];
  missingScopes: string[];
  reauthorizationRequired: boolean;
  reason: string;
}

export type GoogleConnectionStatus =
  | 'connected'
  | 'reauth_required'
  | 'revoked'
  | 'expired'
  | 'disconnected';

export interface GoogleConnectionRecord {
  id: string;
  workspaceId: string;
  userId: string;
  userEmail: string;
  googleAccountId: string;
  googleEmail: string;
  googleName?: string;
  googlePicture?: string;
  status: GoogleConnectionStatus;
  grantedScopes: string[];
  encryptedCredentialId: string;
  accessTokenExpiresAt: string;
  hasRefreshToken: boolean;
  sharedWithWorkspace: boolean;
  consentSeparatedFromLogin: true;
  lastVerifiedAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  connectedAt: string;
  revokedAt?: string;
  updatedAt: string;
}

export interface GoogleOAuthTransactionRecord {
  id: string;
  stateHash: string;
  userId: string;
  workspaceId: string;
  intent: 'connect' | 'incremental_scope' | 'reauthorize';
  requestedScopes: string[];
  redirectUri: string;
  returnPath: string;
  sessionBindingHash: string;
  status: 'pending' | 'completed' | 'denied' | 'failed' | 'expired';
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
}

export type AppsScriptFileType = 'SERVER_JS' | 'HTML' | 'JSON';

export interface AppsScriptFile {
  name: string;
  type: AppsScriptFileType;
  source: string;
  lastModifyUser?: {
    name?: string;
    email?: string;
  };
  createTime?: string;
  updateTime?: string;
}

export interface AppsScriptProjectRecord {
  id: string;
  scriptId: string;
  workspaceId: string;
  ownerUid: string;
  ownerConnectionId: string;
  title: string;
  parentId?: string;
  projectType: 'standalone' | 'bound';
  ownershipKind: 'created_by_antara' | 'owned_by_user' | 'shared_with_user';
  lastKnownContentHash?: string;
  lastSyncAt?: string;
  status: 'active' | 'detached' | 'error';
  templateKey?: string;
  editorUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppsScriptSnapshotRecord {
  id: string;
  workspaceId: string;
  scriptId: string;
  versionNumber?: number;
  files: AppsScriptFile[];
  manifestJson: string;
  contentHash: string;
  changeSummary: string;
  reason: 'pre_update_backup' | 'manual_backup' | 'version_release' | 'restore';
  createdByUid: string;
  createdByEmail: string;
  createdAt: string;
}

export interface AppsScriptVersionRecord {
  id: string;
  workspaceId: string;
  scriptId: string;
  versionNumber: number;
  description: string;
  snapshotId: string;
  manifestJson: string;
  creatorUid: string;
  creatorEmail: string;
  changeSummary: string;
  previousVersionNumber?: number;
  deploymentId?: string;
  deploymentStatus?: string;
  createdAt: string;
}

export type AppsScriptDeploymentType = 'WEB_APP' | 'API_EXECUTABLE';

export type WebAppAccessLevel = 'MYSELF' | 'DOMAIN' | 'ANYONE' | 'ANYONE_ANONYMOUS';

export type WebAppExecuteAs = 'USER_ACCESSING' | 'USER_DEPLOYING';

export interface AppsScriptDeploymentRecord {
  id: string;
  workspaceId: string;
  scriptId: string;
  deploymentId: string;
  deploymentType: AppsScriptDeploymentType;
  versionNumber: number;
  description: string;
  accessLevel?: WebAppAccessLevel;
  executeAs?: WebAppExecuteAs;
  webAppUrl?: string;
  entryPointsJson?: string;
  status: 'active' | 'updating' | 'archived' | 'error';
  verified: boolean;
  lastVerifiedAt?: string;
  lastErrorMessage?: string;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovedExecutionTarget {
  id: string;
  workspaceId: string;
  scriptId: string;
  deploymentId: string;
  functionName: string;
  description: string;
  requiredScopes: string[];
  riskClassification: 'low' | 'medium' | 'high';
  requiresHumanApproval: boolean;
  parameterSchemaJson: string;
  expectedOutputSummary: string;
  timeoutSeconds: number;
  createdByUid: string;
  createdAt: string;
}

export interface ScriptExecutionRecord {
  id: string;
  workspaceId: string;
  scriptId: string;
  deploymentId: string;
  functionName: string;
  parametersJson: string;
  initiatorUid: string;
  initiatorEmail: string;
  riskClassification: 'low' | 'medium' | 'high';
  approvalConfirmed: boolean;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  resultJson?: string;
  errorCode?: string;
  errorMessage?: string;
  idempotencyKey?: string;
}

export interface ScriptTriggerRecord {
  id: string;
  workspaceId: string;
  scriptId: string;
  deploymentId?: string;
  googleTriggerId?: string;
  handler: string;
  triggerType: 'time_hourly' | 'time_daily' | 'time_weekly' | 'on_open' | 'on_edit' | 'on_change';
  scheduleDescription: string;
  timezone: string;
  intervalValue?: number;
  hourOfDay?: number;
  ownership: 'antara_managed';
  state: 'active' | 'paused' | 'pending_install' | 'unsupported' | 'error' | 'removed';
  lastExecutionAt?: string;
  nextIntendedRun?: string;
  lastErrorMessage?: string;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppsScriptTriggerInstallInput {
  connectionId?: string;
  deploymentId?: string;
  handler: string;
  triggerType: ScriptTriggerRecord['triggerType'];
  timezone?: string;
  intervalValue?: number;
  hourOfDay?: number;
  approvalConfirmed?: boolean;
}

export interface GoogleIntegrationAuditRecord {
  id: string;
  workspaceId: string;
  actorUid: string;
  actorEmail: string;
  operation: string;
  targetScriptId?: string;
  connectionId?: string;
  approvalReference?: string;
  providerClassification: 'success' | 'denied' | 'reauth_required' | 'quota_limited' | 'error' | 'blocked';
  summary: string;
  createdAt: string;
}

export type DoctorDiagnosticCode =
  | 'PLATFORM_OAUTH_NOT_CONFIGURED'
  | 'GOOGLE_NOT_CONNECTED'
  | 'GOOGLE_REAUTH_REQUIRED'
  | 'CONNECTION_REVOKED'
  | 'APPS_SCRIPT_API_NOT_ENABLED'
  | 'DRIVE_API_NOT_ENABLED'
  | 'MISSING_PROJECT_SCOPE'
  | 'MISSING_DEPLOYMENT_SCOPE'
  | 'DRIVE_DISCOVERY_NOT_AUTHORIZED'
  | 'SCRIPT_PROJECT_ACCESS_NOT_GRANTED'
  | 'PROJECT_MANAGEMENT_READY'
  | 'EXECUTION_SCOPE_REQUIRED'
  | 'API_EXECUTABLE_NOT_DEPLOYED'
  | 'CLOUD_PROJECT_MISMATCH'
  | 'DEPLOYMENT_READY'
  | 'QUOTA_LIMITED'
  | 'PROVIDER_ERROR';

export interface DoctorCheckItem {
  id: string;
  label: string;
  status: 'pass' | 'warning' | 'action_required' | 'error';
  code: DoctorDiagnosticCode;
  detail: string;
  actionUrl?: string;
  actionLabel?: string;
}

export interface GoogleDoctorReport {
  overallReady: boolean;
  platformOAuthConfigured: boolean;
  redirectUri: string;
  connectionStatus: GoogleConnectionStatus | 'not_connected';
  connectedEmail?: string;
  checks: DoctorCheckItem[];
  capabilities: EvaluatedGoogleCapability[];
  checkedAt: string;
}

// =============================================================================
// Phase 3: Autonomous Intelligence Engine Types
// =============================================================================

export type AiProviderId =
  | 'gemini'
  | 'vercel_ai_gateway'
  | 'openai'
  | 'anthropic'
  | 'test_mock';

export type ModelTaskClass =
  | 'fast_routing'
  | 'classification'
  | 'research_synthesis'
  | 'deep_reasoning'
  | 'copy_generation'
  | 'qa_critique'
  | 'embedding';

export type ProviderRuntimeState =
  | 'configured'
  | 'not_configured'
  | 'rate_limited'
  | 'error'
  | 'test_only';

export type AiErrorCode =
  | 'AI_PROVIDER_NOT_CONFIGURED'
  | 'AI_PROVIDER_TIMEOUT'
  | 'AI_RATE_LIMITED'
  | 'AI_BILLING_LIMIT'
  | 'INVALID_STRUCTURED_OUTPUT'
  | 'AGENT_STEP_LIMIT_REACHED'
  | 'WORKSPACE_ACCESS_DENIED'
  | 'BRAND_CONTEXT_UNAVAILABLE'
  | 'RESEARCH_SOURCE_UNAVAILABLE'
  | 'SOURCE_VERIFICATION_FAILED'
  | 'TOOL_PERMISSION_DENIED'
  | 'DUPLICATE_TASK'
  | 'TASK_EXECUTION_FAILED'
  | 'WORKFLOW_PARTIALLY_COMPLETED';

export interface AiProviderStatusDescriptor {
  provider: AiProviderId;
  label: string;
  state: ProviderRuntimeState;
  source: string;
  supportedTaskClasses: ModelTaskClass[];
  defaultModels: Partial<Record<ModelTaskClass, string>>;
  reason: string;
  isMock: boolean;
}

export type AgentId =
  | '01_orchestrator'
  | '02_market_radar'
  | '03_search_visibility'
  | '04_content_engine'
  | '05_creative_studio'
  | '06_publishing_social'
  | '07_reviews_reputation'
  | '08_leads_conversations'
  | '09_results_roi';

export type ToolId =
  | 'brand_knowledge_reader'
  | 'brand_voice_and_restrictions_reader'
  | 'memory_retriever'
  | 'memory_candidate_proposer'
  | 'web_search_adapter'
  | 'web_page_fetcher'
  | 'citation_normalizer'
  | 'keyword_cluster_builder'
  | 'strategy_planner'
  | 'content_draft_writer'
  | 'creative_brief_builder'
  | 'publishing_package_builder'
  | 'review_reply_drafter'
  | 'lead_response_drafter'
  | 'performance_snapshot_reader'
  | 'quality_assurance_checker';

export type MemoryNamespace =
  | 'workspace_memory'
  | 'brand_memory'
  | 'content_memory'
  | 'performance_memory'
  | 'research_memory'
  | 'decision_memory'
  | 'rejection_memory';

export type MemoryPromotionStatus =
  | 'candidate'
  | 'approved'
  | 'rejected'
  | 'superseded';

export type VerificationStatus =
  | 'VERIFIED'
  | 'SUPPORTED'
  | 'INFERRED'
  | 'UNVERIFIED'
  | 'CONTRADICTED';

export const BRAND_FACT_CATEGORIES = [
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
] as const;

export type BrandFactCategory = (typeof BRAND_FACT_CATEGORIES)[number];

export interface BrandKnowledgeFact {
  id: string;
  workspaceId: string;
  brandId: string;
  category: BrandFactCategory;
  title: string;
  statement: string;
  verificationStatus: VerificationStatus;
  approvalStatus: MemoryPromotionStatus;
  confidence: number;
  provenanceType: 'brand_profile' | 'human_entered' | 'research_promoted' | 'starter_baseline';
  sourceIds: string[];
  sourceUrl?: string;
  publishedAt?: string;
  retrievedAt?: string;
  supersededById?: string;
  createdBy: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryItem {
  id: string;
  workspaceId: string;
  brandId?: string;
  namespace: MemoryNamespace;
  title: string;
  content: string;
  tags: string[];
  status: MemoryPromotionStatus;
  verificationStatus: VerificationStatus;
  confidence: number;
  provenanceRef: string;
  sourceRunId?: string;
  sourceAgentId?: AgentId;
  supersededById?: string;
  tokensEstimate: number;
  createdBy: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchSourceRecord {
  id: string;
  workspaceId: string;
  brandId?: string;
  runId?: string;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  sourceType: 'google_grounding' | 'search_api' | 'web_fetch' | 'workspace_input';
  contentHash: string;
  reliabilityScore: number;
  publishedAt?: string;
  retrievedAt: string;
  createdBy: string;
  createdAt: string;
}

export interface ClaimEvidenceRecord {
  id: string;
  workspaceId: string;
  brandId?: string;
  runId?: string;
  claimText: string;
  verificationStatus: VerificationStatus;
  confidence: number;
  supportingSourceIds: string[];
  contradictingSourceIds: string[];
  conflictNote?: string;
  rationale: string;
  reviewState: 'open' | 'promoted_to_memory' | 'rejected';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentFinding {
  id: string;
  title: string;
  summary: string;
  verificationStatus: VerificationStatus;
  confidence: number;
  sourceIds: string[];
}

export interface AgentRecommendation {
  id: string;
  action: string;
  rationale: string;
  priority: 'high' | 'medium' | 'low';
  requiresApproval: boolean;
  targetPhase?: 'phase_3_draft' | 'phase_4_execution';
}

export interface AgentArtifactPayload {
  id: string;
  workspaceId: string;
  runId: string;
  taskId?: string;
  brandId?: string;
  agentId: AgentId;
  kind:
    | 'research_report'
    | 'seo_cluster_plan'
    | 'strategy_plan'
    | 'content_draft'
    | 'creative_brief'
    | 'publishing_package'
    | 'review_reply_draft'
    | 'lead_reply_draft'
    | 'roi_assessment'
    | 'qa_evaluation';
  title: string;
  summary: string;
  contentMarkdown: string;
  structuredDataJson: string;
  verificationStatus: VerificationStatus;
  createdBy: string;
  createdAt: string;
}

export interface AgentResultContract {
  contractVersion: 'v1';
  agentId: AgentId;
  agentVersion: string;
  status: 'completed' | 'partial' | 'needs_configuration' | 'blocked' | 'failed';
  summary: string;
  findings: AgentFinding[];
  recommendations: AgentRecommendation[];
  claims: Array<{
    claimText: string;
    verificationStatus: VerificationStatus;
    confidence: number;
    sourceUrls: string[];
  }>;
  artifacts: Array<{
    kind: AgentArtifactPayload['kind'];
    title: string;
    summary: string;
    contentMarkdown: string;
    structuredData: Record<string, unknown>;
  }>;
  assumptions: string[];
  uncertaintyNotes: string[];
  memoryCandidates: Array<{
    namespace: MemoryNamespace;
    title: string;
    content: string;
    tags: string[];
  }>;
  usage: {
    provider: AiProviderId | 'deterministic_fallback';
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    estimatedCostUsd: number | null;
    isMock: boolean;
  };
  errorCode?: AiErrorCode;
  errorMessage?: string;
}

export interface AgentDefinition {
  id: AgentId;
  number: string;
  name: string;
  roleTitle: string;
  mission: string;
  version: string;
  defaultTaskClass: ModelTaskClass;
  allowedTools: ToolId[];
  allowedMemoryNamespaces: MemoryNamespace[];
  maxSteps: number;
  maxToolCalls: number;
  maxOutputTokens: number;
  timeoutMs: number;
  retryLimit: number;
  systemInstructions: string;
  phaseBoundaryNote: string;
}

export interface AgentWorkspaceConfig {
  id: string;
  workspaceId: string;
  agentId: AgentId;
  enabled: boolean;
  preferredTaskClass?: ModelTaskClass;
  maxStepsOverride?: number;
  customFocusNote?: string;
  updatedBy: string;
  updatedAt: string;
}

export type OrchestratorRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'cancelled'
  | 'needs_configuration';

export type AgentTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'needs_configuration'
  | 'cancelled';

export interface AgentTaskRecord {
  id: string;
  workspaceId: string;
  runId: string;
  agentId: AgentId;
  stageIndex: number;
  dependsOnTaskIds: string[];
  objective: string;
  status: AgentTaskStatus;
  attempt: number;
  maxAttempts: number;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  startedAt?: string;
  finishedAt?: string;
  resultJson?: string;
  errorCode?: AiErrorCode;
  errorMessage?: string;
}

export interface OrchestratorRunRecord {
  id: string;
  workspaceId: string;
  brandId?: string;
  conversationId?: string;
  playbookRunId?: string;
  prompt: string;
  intentCategory:
    | 'market_research'
    | 'seo_audit'
    | 'content_strategy'
    | 'content_drafting'
    | 'creative_direction'
    | 'publishing_package'
    | 'review_reply'
    | 'lead_response'
    | 'roi_analysis'
    | 'full_campaign';
  complexity: 'simple' | 'standard' | 'deep';
  selectedAgents: AgentId[];
  status: OrchestratorRunStatus;
  correlationId: string;
  idempotencyKey?: string;
  finalSummary?: string;
  finalMarkdown?: string;
  qaVerdict?: 'pass' | 'revised_pass' | 'flagged_uncertainty' | 'skipped';
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: number | null;
  errorCode?: AiErrorCode;
  errorMessage?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface AgentExecutionEvent {
  id: string;
  workspaceId: string;
  runId: string;
  taskId?: string;
  agentId?: AgentId;
  eventType:
    | 'run_created'
    | 'plan_compiled'
    | 'task_started'
    | 'tool_invoked'
    | 'claim_evaluated'
    | 'qa_reviewed'
    | 'task_completed'
    | 'task_failed'
    | 'run_completed'
    | 'run_needs_configuration'
    | 'run_cancelled';
  message: string;
  detailJson?: string;
  createdAt: string;
}

export interface StrategyPlanRecord {
  id: string;
  workspaceId: string;
  brandId: string;
  runId?: string;
  title: string;
  horizonDays: 7 | 14 | 30;
  objective: string;
  pillars: string[];
  itemsJson: string;
  status: 'draft' | 'approved' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentDraftRecord {
  id: string;
  workspaceId: string;
  brandId: string;
  strategyId?: string;
  runId?: string;
  channel: 'linkedin' | 'instagram' | 'blog' | 'email' | 'short_video_script' | 'ad_copy' | 'general';
  title: string;
  hook?: string;
  bodyMarkdown: string;
  cta?: string;
  verificationStatus: VerificationStatus;
  qaScore: number;
  status: 'draft' | 'ready_for_phase4_approval' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type PlaybookId =
  | '01_search_demand_spikes'
  | '02_competitor_drops_promo'
  | '03_one_star_review_lands'
  | '04_content_calendar_thin'
  | '05_post_goes_viral'
  | '06_ranking_drops_page'
  | '07_ad_creative_fatigues'
  | '08_dm_lead_arrives_night';

export interface PlaybookDefinition {
  id: PlaybookId;
  code: string;
  title: string;
  triggerType: string;
  description: string;
  agentChain: AgentId[];
  phase3OutputDescription: string;
  phaseBoundaryNote: string;
}

export interface NormalizedEventRecord {
  id: string;
  workspaceId: string;
  brandId?: string;
  eventType: PlaybookId;
  source: 'manual_test' | 'webhook' | 'scheduled_check' | 'internal';
  isTestFixture: boolean;
  dedupeKey: string;
  timezone: string;
  occurredAt: string;
  payloadJson: string;
  status: 'received' | 'processed' | 'duplicate_ignored' | 'failed';
  playbookRunId?: string;
  createdBy: string;
  createdAt: string;
}

export interface PlaybookRunRecord {
  id: string;
  workspaceId: string;
  brandId?: string;
  playbookId: PlaybookId;
  eventId: string;
  orchestratorRunId?: string;
  status: OrchestratorRunStatus;
  summary: string;
  outputArtifactsCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiUsageLedgerRecord {
  id: string;
  workspaceId: string;
  runId: string;
  agentId: AgentId;
  provider: AiProviderId | 'deterministic_fallback';
  model: string;
  taskClass: ModelTaskClass;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
  pricingKnown: boolean;
  isMock: boolean;
  createdAt: string;
}

export interface AiConversationRecord {
  id: string;
  workspaceId: string;
  brandId?: string;
  title: string;
  lastRunId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiConversationMessage {
  id: string;
  workspaceId: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  runId?: string;
  status?: OrchestratorRunStatus;
  createdBy: string;
  createdAt: string;
}

// =============================================================================
// Phase 4: Complete Autonomous Marketing, Content Production, Publishing & Growth Engine
// =============================================================================

export type Phase4SchemaVersion = '4.0.0';

export type SocialPlatformId =
  | 'instagram'
  | 'facebook'
  | 'youtube'
  | 'linkedin'
  | 'tiktok'
  | 'google_business_profile';

export type Phase4ProviderId =
  | SocialPlatformId
  | 'canva'
  | 'meta_ads';

export type ProviderReadinessState =
  | 'not_configured'
  | 'configured'
  | 'authorization_required'
  | 'connected'
  | 'partially_connected'
  | 'app_review_required'
  | 'disconnected'
  | 'error';

export type GbpApiAccessState =
  | 'access_not_requested'
  | 'access_under_review'
  | 'approved'
  | 'api_not_enabled'
  | 'account_permission_missing'
  | 'connected';

export type Phase4ErrorCode =
  | 'PROVIDER_NOT_CONFIGURED'
  | 'ACCOUNT_NOT_CONNECTED'
  | 'TOKEN_EXPIRED'
  | 'PERMISSION_MISSING'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_INVALIDATED'
  | 'AUTONOMY_POLICY_BLOCKED'
  | 'EMERGENCY_STOP_ACTIVE'
  | 'CAPABILITY_UNSUPPORTED'
  | 'APP_REVIEW_REQUIRED'
  | 'MEDIA_VALIDATION_FAILED'
  | 'CANVA_EXPORT_FAILED'
  | 'RATE_LIMITED'
  | 'PROVIDER_TEMPORARY_ERROR'
  | 'PROVIDER_PERMANENT_ERROR'
  | 'PUBLISH_STATUS_UNKNOWN'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'MESSAGING_WINDOW_EXPIRED'
  | 'PAID_SPEND_NOT_AUTHORIZED'
  | 'DUPLICATE_EXECUTION_BLOCKED';

export type ContentLifecycleStatus =
  | 'IDEA'
  | 'RESEARCHED'
  | 'BRIEF_CREATED'
  | 'DRAFTED'
  | 'CREATIVE_IN_PROGRESS'
  | 'ASSET_READY'
  | 'VALIDATION_PENDING'
  | 'READY_FOR_REVIEW'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PROCESSING'
  | 'PUBLISHED'
  | 'ANALYTICS_PENDING'
  | 'ANALYZED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FAILED'
  | 'BLOCKED_BY_PERMISSION'
  | 'BLOCKED_BY_POLICY'
  | 'NEEDS_REVISION';

export type ContentFormat =
  | 'text_post'
  | 'single_image'
  | 'carousel'
  | 'short_video'
  | 'reel'
  | 'youtube_video'
  | 'youtube_short'
  | 'blog_article'
  | 'email_newsletter'
  | 'ad_creative'
  | 'gbp_update';

export type AutonomyMode =
  | 'DRAFT_ONLY'
  | 'APPROVAL_REQUIRED'
  | 'AUTHORIZED_AUTO_PUBLISHING';

export type ExternalActionType =
  | 'publish_post'
  | 'schedule_post'
  | 'reply_comment'
  | 'send_dm'
  | 'reply_review'
  | 'lead_outreach'
  | 'paid_campaign_mutate'
  | 'canva_export'
  | 'apps_script_deploy';

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'held'
  | 'cancelled'
  | 'invalidated'
  | 'expired';

export interface BrandGrowthObjective {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId: string;
  period: 'weekly' | 'monthly' | 'quarterly';
  title: string;
  targetMetric: string;
  targetValue: number;
  currentValue: number | null;
  unit: string;
  priority: 'high' | 'medium' | 'low';
  status: 'active' | 'achieved' | 'paused';
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentQualityCheckResult {
  passed: boolean;
  checkedAt: string;
  score: number;
  warnings: Array<{ code: string; message: string; severity: 'error' | 'warning' }>;
  brandFactsChecked: number;
  prohibitedTermsMatched: string[];
  platformLimitViolations: Array<{ platform: SocialPlatformId; limit: number; actual: number }>;
  duplicateRisk: 'none' | 'possible' | 'high';
}

export interface ContentPlatformVariant {
  platform: SocialPlatformId;
  caption: string;
  title?: string;
  hashtags: string[];
  cta?: string;
  mediaAssetIds: string[];
  targetAccountId?: string;
  visibility?: 'public' | 'unlisted' | 'private' | 'draft';
  payloadHash: string;
  updatedAt: string;
}

export interface ContentVersionSnapshot {
  version: number;
  title: string;
  body: string;
  hook?: string;
  cta?: string;
  mediaAssetIds: string[];
  payloadHash: string;
  changeNote: string;
  editedBy: string;
  editedAt: string;
}

export interface MarketingContentItem {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId: string;
  title: string;
  format: ContentFormat;
  status: ContentLifecycleStatus;
  objective?: string;
  campaignTag?: string;
  sourceOpportunityRef?: string;
  sourcePhase3RunId?: string;
  hook?: string;
  body: string;
  cta?: string;
  hashtags: string[];
  targetPlatforms: SocialPlatformId[];
  variants: ContentPlatformVariant[];
  mediaAssetIds: string[];
  creativeBriefId?: string;
  canvaDesignId?: string;
  currentVersion: number;
  versions: ContentVersionSnapshot[];
  payloadHash: string;
  approvedPayloadHash?: string;
  approvalRequestId?: string;
  qualityCheck?: ContentQualityCheckResult;
  scheduledForUtc?: string;
  scheduledTimezone?: string;
  lastErrorCode?: Phase4ErrorCode;
  lastErrorMessage?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreativeBriefRecord {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId: string;
  contentItemId?: string;
  title: string;
  format: ContentFormat;
  targetPlatform: SocialPlatformId;
  visualDirection: string;
  headlineText: string;
  supportingCopy: string;
  brandColorHex: string;
  accentColorHex?: string;
  aspectRatio: '1:1' | '4:5' | '9:16' | '16:9' | '1.91:1';
  mandatoryRules: string[];
  prohibitedClaims: string[];
  canvaTemplateId?: string;
  canvaDesignId?: string;
  canvaEditUrl?: string;
  status: 'draft' | 'in_canva' | 'exported' | 'approved' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanvaExportJobRecord {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId?: string;
  creativeBriefId?: string;
  canvaDesignId: string;
  providerJobId: string;
  format: 'png' | 'jpg' | 'pdf' | 'mp4';
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'expired';
  exportDownloadUrlExpiresAt?: string;
  persistedAssetId?: string;
  errorCode?: Phase4ErrorCode;
  errorMessage?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaAssetRecord {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId?: string;
  contentItemId?: string;
  fileName: string;
  mimeType: string;
  mediaKind: 'image' | 'video' | 'document';
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  aspectRatio?: string;
  sha256: string;
  storageBucket?: string;
  storagePath: string;
  publicPreviewUrl?: string;
  source: 'upload' | 'canva_export' | 'google_drive' | 'external_import';
  processingState: 'raw_uploaded' | 'validated' | 'processing_failed' | 'rejected';
  validationErrors: string[];
  compatiblePlatforms: SocialPlatformId[];
  resumableSessionId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectedSocialAccount {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId?: string;
  provider: Phase4ProviderId;
  authMode?: 'instagram_login' | 'facebook_login' | 'oauth2_pkce' | 'oauth2_standard' | 'google_oauth';
  externalAccountId: string;
  displayName: string;
  handle?: string;
  accountType?: 'business' | 'creator' | 'page' | 'channel' | 'member' | 'organization' | 'location' | 'ad_account';
  status: 'connected' | 'reauth_required' | 'revoked' | 'disconnected' | 'app_review_required';
  readinessState: ProviderReadinessState;
  gbpAccessState?: GbpApiAccessState;
  grantedScopes: string[];
  capabilities: string[];
  unsupportedCapabilities: string[];
  encryptedCredentialId: string;
  tokenExpiresAt?: string;
  hasRefreshToken: boolean;
  unauditedAppWarning?: boolean;
  lastVerifiedAt?: string;
  lastErrorCode?: Phase4ErrorCode;
  lastErrorMessage?: string;
  connectedBy: string;
  connectedAt: string;
  updatedAt: string;
}

export interface ScheduledPostRecord {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId: string;
  contentItemId: string;
  platform: SocialPlatformId;
  accountId: string;
  scheduledForUtc: string;
  timezone: string;
  status:
    | 'scheduled'
    | 'claimed'
    | 'publishing'
    | 'processing'
    | 'published'
    | 'publish_status_unknown'
    | 'failed'
    | 'cancelled'
    | 'blocked_by_policy'
    | 'dead_letter';
  payloadHash: string;
  approvalRequestId?: string;
  idempotencyKey: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAtUtc?: string;
  externalPostId?: string;
  externalPostUrl?: string;
  reconciliationRequired?: boolean;
  lastErrorCode?: Phase4ErrorCode;
  lastErrorMessage?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublishingAttemptRecord {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId: string;
  scheduledPostId?: string;
  contentItemId: string;
  platform: SocialPlatformId;
  accountId: string;
  attemptNumber: number;
  status: 'started' | 'succeeded' | 'processing' | 'failed' | 'status_unknown' | 'reconciled_published' | 'reconciled_not_published';
  gatewayDecisionId: string;
  idempotencyKey: string;
  providerContainerId?: string;
  externalPostId?: string;
  externalPostUrl?: string;
  errorCode?: Phase4ErrorCode;
  errorMessage?: string;
  httpStatus?: number;
  retryable?: boolean;
  startedAt: string;
  finishedAt?: string;
}

export interface ApprovalRequestRecord {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId: string;
  actionType: ExternalActionType;
  targetResourceType: 'content_item' | 'scheduled_post' | 'conversation' | 'review' | 'lead' | 'campaign';
  targetResourceId: string;
  platform?: Phase4ProviderId;
  accountId?: string;
  payloadHash: string;
  summary: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  estimatedSpendUsd?: number;
  status: ApprovalStatus;
  requestedByUid: string;
  requestedByType: 'human' | 'ai_agent';
  decidedByUid?: string;
  decidedByEmail?: string;
  decisionNote?: string;
  expiresAt: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrandAutonomyPolicy {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId: string;
  publishingMode: AutonomyMode;
  allowedAutoPlatforms: SocialPlatformId[];
  allowedAutoFormats: ContentFormat[];
  maxAutoPostsPerDay: number;
  commentReplyPolicy: 'draft_only' | 'approval_required' | 'auto_non_sensitive';
  dmReplyPolicy: 'draft_only' | 'approval_required';
  reviewReplyPolicy: 'draft_only' | 'approval_required' | 'auto_positive_only';
  leadOutreachPolicy: 'internal_tasks_only' | 'approval_required';
  paidAdsPolicy: 'disabled' | 'analysis_and_draft_only' | 'approved_cap_only';
  requireQualityGatePass: boolean;
  blockSensitiveTopicsAuto: boolean;
  policyExpiresAt?: string;
  paused: boolean;
  pausedPlatforms: SocialPlatformId[];
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceEmergencyStopState {
  id: 'emergency_stop';
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  globalStopped: boolean;
  reason?: string;
  stoppedByUid?: string;
  stoppedByEmail?: string;
  stoppedAt?: string;
  pausedBrandIds: string[];
  pausedPlatforms: SocialPlatformId[];
  updatedAt: string;
}

export interface SocialConversationRecord {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId: string;
  platform: SocialPlatformId;
  accountId: string;
  externalThreadId: string;
  channelType: 'comment' | 'dm' | 'mention';
  participantName: string;
  participantHandle?: string;
  messagingWindowType: 'standard_24h' | 'click_to_message_ad' | 'comment_public' | 'not_applicable';
  messagingWindowExpiresAt?: string;
  sensitiveTopicDetected: boolean;
  sensitiveTopicReason?: string;
  status: 'open' | 'pending_approval' | 'replied' | 'escalated' | 'resolved';
  assignedToUid?: string;
  aiSummary?: string;
  draftReply?: string;
  lastMessageAt: string;
  messages: Array<{
    id: string;
    sender: 'customer' | 'brand' | 'system';
    senderName: string;
    text: string;
    sentAt: string;
    externalMessageId?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookEventRecord {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId?: string;
  provider: 'meta' | 'tiktok';
  eventType: string;
  dedupeKey: string;
  signatureVerified: boolean;
  payloadHash: string;
  payloadSummary: string;
  status: 'received' | 'processed' | 'duplicate_ignored' | 'rejected_invalid_signature' | 'failed';
  receivedAt: string;
  processedAt?: string;
}

export type ReviewCategory =
  | 'praise'
  | 'product_quality'
  | 'service_issue'
  | 'delivery_delay'
  | 'pricing_concern'
  | 'technical_support'
  | 'spam_or_irrelevant'
  | 'escalation_required';

export interface ReviewRecord {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId: string;
  platform: 'google_business_profile' | 'facebook';
  accountId?: string;
  locationName?: string;
  externalReviewId: string;
  reviewerName: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment: string;
  category: ReviewCategory;
  sentiment: 'positive' | 'neutral' | 'negative';
  escalationRequired: boolean;
  aiDraftReply?: string;
  publishedReply?: string;
  replyStatus: 'unanswered' | 'draft_ready' | 'pending_approval' | 'replied' | 'escalated';
  approvalRequestId?: string;
  reviewedAt: string;
  repliedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type LeadStage =
  | 'NEW'
  | 'IDENTIFIED'
  | 'QUALIFICATION_PENDING'
  | 'QUALIFIED'
  | 'FOLLOW_UP'
  | 'CONVERTED'
  | 'LOST'
  | 'ARCHIVED';

export interface LeadRecord {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId: string;
  fullName: string;
  companyName?: string;
  email?: string;
  phone?: string;
  sourceChannel: SocialPlatformId | 'website' | 'manual' | 'apps_script';
  sourceConversationId?: string;
  stage: LeadStage;
  consentStatus: 'explicit_opt_in' | 'inbound_inquiry_only' | 'unconfirmed' | 'opted_out';
  consentProvenance: string;
  assignedToUid?: string;
  notes?: string;
  nextFollowUpAt?: string;
  activities: Array<{
    id: string;
    type: 'note' | 'stage_change' | 'internal_followup_task' | 'approved_outreach';
    summary: string;
    actorUid: string;
    createdAt: string;
  }>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignBudgetPolicy {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId: string;
  currency: 'INR' | 'USD';
  enabled: boolean;
  maxDailySpend: number | null;
  maxMonthlySpend: number | null;
  requireExplicitOwnerApprovalForLaunch: true;
  ownerAuthorizedByUid?: string;
  ownerAuthorizedAt?: string;
  updatedBy: string;
  updatedAt: string;
}

export interface AdCampaignRecord {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId: string;
  provider: 'meta_ads';
  accountId?: string;
  externalCampaignId?: string;
  name: string;
  objective: 'awareness' | 'traffic' | 'engagement' | 'leads' | 'sales';
  status: 'draft_plan' | 'dry_run_validated' | 'pending_owner_approval' | 'active' | 'paused' | 'archived';
  dailyBudget: number | null;
  totalBudget: number | null;
  currency: 'INR' | 'USD';
  audienceSummary: string;
  creativeBriefIds: string[];
  approvalRequestId?: string;
  lastSyncedSpend: number | null;
  lastSyncedImpressions: number | null;
  lastSyncedClicks: number | null;
  lastSyncedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnalyticsSnapshotRecord {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId: string;
  platform: SocialPlatformId | 'meta_ads';
  accountId?: string;
  contentItemId?: string;
  externalObjectId?: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  sourceApi: string;
  attributionNote: string;
  dedupeKey: string;
  metrics: {
    impressions: number | null;
    reach: number | null;
    engagements: number | null;
    clicks: number | null;
    videoViews: number | null;
    followersDelta: number | null;
    leadsAttributed: number | null;
    spendAmount: number | null;
    revenueAmount: number | null;
  };
  units: {
    currency?: 'INR' | 'USD';
    engagementDefinition: string;
  };
  collectedAt: string;
}

export interface PerformanceExperimentRecord {
  id: string;
  schemaVersion: Phase4SchemaVersion;
  workspaceId: string;
  brandId: string;
  title: string;
  hypothesis: string;
  platform: SocialPlatformId;
  primaryMetric: 'engagements' | 'clicks' | 'videoViews' | 'leadsAttributed';
  controlContentId?: string;
  variantContentId?: string;
  status: 'draft' | 'running' | 'inconclusive' | 'completed' | 'archived';
  minSampleSize: number;
  observedControlValue: number | null;
  observedVariantValue: number | null;
  confidenceNote: string;
  proposedMemoryId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MarketingActivityItem {
  id: string;
  workspaceId: string;
  brandId?: string;
  category:
    | 'content'
    | 'creative'
    | 'publishing'
    | 'approval'
    | 'autonomy'
    | 'inbox'
    | 'review'
    | 'lead'
    | 'campaign'
    | 'analytics'
    | 'apps_script'
    | 'webhook';
  action: string;
  summary: string;
  status: 'success' | 'pending' | 'warning' | 'error' | 'blocked';
  resourceType: string;
  resourceId: string;
  actorUid: string;
  createdAt: string;
}



