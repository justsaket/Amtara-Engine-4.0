import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AutonomousConfigItem,
  AutonomousConfigSnapshot,
  ConfigurationClassification,
} from '@/types/domain';
import { DEFAULT_WORKSPACE_TIMEZONE } from '@/lib/validation';
import {
  ensureInternalSecrets,
  readPersistedInternalSecrets,
} from '@/lib/server/secret-manager';

export interface FirebaseAppletConfigFile {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  oAuthClientId?: string;
}

export function resolveFirestoreDatabaseId(explicit?: string | null): string {
  const trimmed = (explicit || '').trim();
  return trimmed || '(default)';
}

function maskSecretPreview(value?: string): string | undefined {
  const v = (value || '').trim();
  if (!v) return undefined;
  if (v.length <= 8) return 'Configured (masked)';
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function readAppletConfigFile(): FirebaseAppletConfigFile | null {
  const filePath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(
      fs.readFileSync(filePath, 'utf8'),
    ) as Partial<FirebaseAppletConfigFile>;
    if (parsed.projectId && parsed.apiKey && parsed.authDomain && parsed.appId) {
      return parsed as FirebaseAppletConfigFile;
    }
    return null;
  } catch {
    return null;
  }
}

function extractProjectIdFromServiceAccountJson(rawJson?: string): string | null {
  const raw = (rawJson || '').trim();
  if (!raw.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(raw) as { projectId?: string; project_id?: string };
    return parsed.projectId || parsed.project_id || null;
  } catch {
    return null;
  }
}

function detectAdcHint(): boolean {
  const gac = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (gac && fs.existsSync(gac)) return true;
  const home = process.env.HOME || '';
  if (!home) return false;
  const wellKnownAdc = path.join(home, '.config', 'gcloud', 'application_default_credentials.json');
  return fs.existsSync(wellKnownAdc);
}

let devFallbackSessionSecret: string | null = null;

export interface ResolvedServerConfig {
  snapshot: AutonomousConfigSnapshot;
  firebaseClientConfig: FirebaseAppletConfigFile | null;
  sessionSecret: string;
  sessionCookieName: string;
  enableRealGoogleIntegrationTests: boolean;
  googleOAuthClientId: string;
  googleOAuthClientSecret: string;
  googleOAuthRedirectUri: string;
  cronSecret: string;
  metaWebhookVerifyToken: string;
  linkedinApiVersion: string;
  gbpApiAccessStatus: string;
}

export function resolveAutonomousConfiguration(options?: {
  autoGenerateLocalSecrets?: boolean;
  secretsFileOverride?: string;
}): ResolvedServerConfig {
  const isVercel = process.env.VERCEL === '1';
  const vercelEnv = process.env.VERCEL_ENV || undefined;
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  const inferredVercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : undefined;

  const appUrl = (
    process.env.APP_URL ||
    inferredVercelUrl ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');

  // Ensure local internal secrets exist stably without changing per request/deployment
  if (options?.autoGenerateLocalSecrets !== false && !isVercel) {
    ensureInternalSecrets({
      overridePath: options?.secretsFileOverride,
      autoPersistLocal: true,
    });
  }

  const persisted = readPersistedInternalSecrets(options?.secretsFileOverride);

  // 1. Firebase Client Inspection
  const appletConfig = readAppletConfigFile();
  const envClientProjectId = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
  const envClientApiKey = (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '').trim();
  const envClientAuthDomain = (process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '').trim();
  const envClientAppId = (process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '').trim();
  const envClientBucket = (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '').trim();
  const envClientSenderId = (process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '').trim();
  const envClientDbId = (process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID || '').trim();

  const resolvedProjectId =
    envClientProjectId ||
    appletConfig?.projectId ||
    (process.env.FIREBASE_PROJECT_ID || '').trim() ||
    null;

  const resolvedDatabaseId = resolveFirestoreDatabaseId(
    process.env.FIREBASE_DATABASE_ID ||
      envClientDbId ||
      appletConfig?.firestoreDatabaseId,
  );

  const clientApiKey = envClientApiKey || appletConfig?.apiKey || '';
  const clientAuthDomain = envClientAuthDomain || appletConfig?.authDomain || '';
  const clientAppId = envClientAppId || appletConfig?.appId || '';
  const clientConfigured = Boolean(
    resolvedProjectId && clientApiKey && clientAuthDomain && clientAppId,
  );

  const hasEnvClient = Boolean(envClientProjectId && envClientApiKey && envClientAuthDomain && envClientAppId);
  const clientSource =
    hasEnvClient && appletConfig
      ? 'env_and_applet_config'
      : hasEnvClient
        ? 'env'
        : appletConfig
          ? 'firebase_applet_config'
          : 'missing';

  const firebaseClientConfig: FirebaseAppletConfigFile | null = clientConfigured
    ? {
        projectId: resolvedProjectId!,
        apiKey: clientApiKey,
        authDomain: clientAuthDomain,
        appId: clientAppId,
        firestoreDatabaseId: resolvedDatabaseId,
        storageBucket: envClientBucket || appletConfig?.storageBucket || undefined,
        messagingSenderId: envClientSenderId || appletConfig?.messagingSenderId || undefined,
        oAuthClientId: appletConfig?.oAuthClientId || undefined,
      }
    : null;

  // 2. Firebase Admin Inspection & Conflicting Project Detection
  const saJsonProjectId = extractProjectIdFromServiceAccountJson(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  );
  const envAdminProjectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
  const envClientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const envPrivateKey = (process.env.FIREBASE_PRIVATE_KEY || '').trim();

  const hasJsonSa = Boolean(saJsonProjectId);
  const hasFieldSa = Boolean(envAdminProjectId && envClientEmail && envPrivateKey);
  const hasAdc = detectAdcHint();

  const adminCredentialMode = hasJsonSa
    ? 'service_account_json'
    : hasFieldSa
      ? 'service_account_fields'
      : 'adc_or_none';

  const adminAvailable = hasJsonSa || hasFieldSa || hasAdc;

  const distinctProjectIds = new Set<string>();
  if (appletConfig?.projectId) distinctProjectIds.add(appletConfig.projectId);
  if (envClientProjectId) distinctProjectIds.add(envClientProjectId);
  if (saJsonProjectId) distinctProjectIds.add(saJsonProjectId);
  if (envAdminProjectId) distinctProjectIds.add(envAdminProjectId);

  const projectConflict = distinctProjectIds.size > 1;
  const projectConflictDetail = projectConflict
    ? `Multiple distinct Firebase project IDs detected (${Array.from(distinctProjectIds).join(', ')}). Align client and Admin credentials to the same Firebase project.`
    : undefined;

  // 3. Internal Secrets Inspection
  const envSessionSecret = (process.env.SESSION_SECRET || '').trim();
  let sessionSecret = '';
  let sessionSecretSource: AutonomousConfigSnapshot['secrets']['sessionSecretSource'] = 'missing';
  if (envSessionSecret.length >= 16) {
    sessionSecret = envSessionSecret;
    sessionSecretSource = 'env';
  } else if (persisted?.sessionSecret && persisted.sessionSecret.length >= 16) {
    sessionSecret = persisted.sessionSecret;
    sessionSecretSource = 'local_file';
  } else if (!isProduction) {
    if (!devFallbackSessionSecret) {
      devFallbackSessionSecret = crypto.randomBytes(32).toString('hex');
    }
    sessionSecret = devFallbackSessionSecret;
    sessionSecretSource = 'ephemeral_dev';
  }

  const envEncKey = (process.env.ENCRYPTION_KEY || '').trim();
  const persistedEncKey = (persisted?.encryptionKey || '').trim();
  const encryptionKeyConfigured = envEncKey.length >= 32 || persistedEncKey.length >= 32;
  const encryptionKeySource: AutonomousConfigSnapshot['secrets']['encryptionKeySource'] =
    envEncKey.length >= 32
      ? 'env'
      : persistedEncKey.length >= 32
        ? 'local_file'
        : 'missing';
  const encryptionKeyVersion =
    (process.env.ENCRYPTION_KEY_VERSION || '').trim() ||
    persisted?.encryptionKeyVersion ||
    'v1';
  const prevEncKey = (
    process.env.ENCRYPTION_KEY_PREVIOUS ||
    persisted?.previousEncryptionKey ||
    ''
  ).trim();
  const rotationActive = prevEncKey.length >= 32;
  const previousKeyVersion = rotationActive
    ? (process.env.ENCRYPTION_KEY_PREVIOUS_VERSION || '').trim() ||
      persisted?.previousEncryptionKeyVersion ||
      'v0'
    : undefined;

  const serverlessWarning =
    isVercel && (!envSessionSecret || !envEncKey)
      ? 'Stateless Vercel runtime detected: set SESSION_SECRET and ENCRYPTION_KEY once in Vercel Project Environment Variables for durable key persistence.'
      : undefined;

  // 4. External Providers & Optional Adapters
  const envGoogleClientId = (
    process.env.GOOGLE_INTEGRATION_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID ||
    ''
  ).trim();
  const envGoogleClientSecret = (
    process.env.GOOGLE_INTEGRATION_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    ''
  ).trim();
  const hasEnvGoogleOAuth = Boolean(envGoogleClientId && envGoogleClientSecret);
  const hasPersistedGoogleOAuth = Boolean(
    persisted?.googlePlatformOAuth?.clientId &&
      persisted?.googlePlatformOAuth?.encryptedClientSecret,
  );
  const googleClientId =
    envGoogleClientId || persisted?.googlePlatformOAuth?.clientId || '';
  const googleClientSecret = envGoogleClientSecret;
  const googleOAuthConfigured = hasEnvGoogleOAuth || hasPersistedGoogleOAuth;
  const googleOAuthSource = hasEnvGoogleOAuth
    ? process.env.GOOGLE_INTEGRATION_CLIENT_ID
      ? 'GOOGLE_INTEGRATION_CLIENT_ID'
      : 'GOOGLE_CLIENT_ID'
    : hasPersistedGoogleOAuth
      ? 'encrypted_platform_vault'
      : 'unset';
  const googleRedirectUri = (
    process.env.GOOGLE_INTEGRATION_REDIRECT_URI ||
    persisted?.googlePlatformOAuth?.redirectUri ||
    `${appUrl}/api/integrations/google/callback`
  ).trim();

  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
  const geminiConfigured = Boolean(geminiKey && geminiKey !== 'MY_GEMINI_API_KEY');
  const aiGatewayKey = (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_AI_GATEWAY_API_KEY || '').trim();
  const aiGatewayConfigured = Boolean(aiGatewayKey && aiGatewayKey.length >= 8);
  const openAiKey = (process.env.OPENAI_API_KEY || '').trim();
  const openAiConfigured = Boolean(openAiKey && openAiKey.length >= 8);
  const anthropicKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const anthropicConfigured = Boolean(anthropicKey && anthropicKey.length >= 8);
  const tavilyKey = (process.env.TAVILY_API_KEY || process.env.SEARCH_API_KEY || '').trim();
  const searchConfigured = Boolean(tavilyKey && tavilyKey.length >= 8) || geminiConfigured;

  const activeAiProviders: string[] = [];
  if (geminiConfigured) activeAiProviders.push('gemini');
  if (aiGatewayConfigured) activeAiProviders.push('vercel_ai_gateway');
  if (openAiConfigured) activeAiProviders.push('openai');
  if (anthropicConfigured) activeAiProviders.push('anthropic');
  const aiConfigured = activeAiProviders.length > 0;

  const metaConfigured = Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
  const linkedinConfigured = Boolean(
    process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET,
  );
  const tiktokConfigured = Boolean(
    process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET,
  );
  const canvaConfigured = Boolean(process.env.CANVA_CLIENT_ID && process.env.CANVA_CLIENT_SECRET);
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const metaWebhookVerifyToken = (process.env.META_WEBHOOK_VERIFY_TOKEN || '').trim();
  const linkedinApiVersion = (process.env.LINKEDIN_API_VERSION || '202501').trim();
  const gbpApiAccessStatus = (process.env.GBP_API_ACCESS_STATUS || 'access_not_requested').trim();
  const realGoogleTestsEnabled = process.env.ENABLE_REAL_GOOGLE_INTEGRATION_TESTS === 'true';

  const classifyOptionalProvider = (configured: boolean): ConfigurationClassification =>
    configured ? 'requires_external_authorization' : 'optional_unused';

  const items: AutonomousConfigItem[] = [
    {
      id: 'core_runtime',
      label: 'Next.js App Router Runtime & Timezone',
      domain: 'core',
      classification: 'automatically_configured',
      configured: true,
      source: isVercel ? 'Vercel Runtime' : 'Local Port 3000 Runtime',
      summary: `Listening on ${appUrl} with default workspace timezone ${DEFAULT_WORKSPACE_TIMEZONE}.`,
    },
    {
      id: 'firebase_client',
      label: 'Firebase Client SDK & Auth',
      domain: 'firebase',
      classification: hasEnvClient ? 'already_available' : clientConfigured ? 'automatically_configured' : 'requires_external_authorization',
      configured: clientConfigured,
      source: clientSource,
      summary: clientConfigured
        ? `Project ${resolvedProjectId} (${resolvedDatabaseId === '(default)' ? 'default database' : `database ${resolvedDatabaseId}`}).`
        : 'Supply NEXT_PUBLIC_FIREBASE_* or firebase-applet-config.json to enable live client authentication.',
      maskedPreview: clientConfigured ? maskSecretPreview(clientApiKey) : undefined,
    },
    {
      id: 'firebase_admin',
      label: 'Firebase Admin & Firestore Access',
      domain: 'firebase',
      classification:
        adminCredentialMode !== 'adc_or_none'
          ? 'already_available'
          : clientConfigured
            ? 'automatically_configured'
            : 'requires_external_authorization',
      configured: adminAvailable || clientConfigured,
      source:
        adminCredentialMode !== 'adc_or_none'
          ? adminCredentialMode
          : clientConfigured
            ? 'Bearer ID Token Firestore REST + Rules'
            : 'unconfigured',
      summary:
        adminCredentialMode !== 'adc_or_none'
          ? 'Server-side Admin SDK initialized via explicit service account.'
          : clientConfigured
            ? 'Using verified Firebase ID Token + Firestore REST bounded by security rules; supply service-account credentials for privileged background workers.'
            : 'Database backend unavailable until Firebase credentials are supplied.',
    },
    {
      id: 'session_secret',
      label: 'Session Signing Secret',
      domain: 'auth',
      classification:
        sessionSecretSource === 'env'
          ? 'already_available'
          : sessionSecretSource === 'local_file' || sessionSecretSource === 'ephemeral_dev'
            ? 'generated_internally'
            : 'requires_external_authorization',
      configured: sessionSecret.length >= 16,
      source: sessionSecretSource,
      summary:
        sessionSecretSource === 'env'
          ? 'Loaded from environment configuration.'
          : sessionSecretSource === 'local_file'
            ? 'Persistently generated via CSPRNG into git-ignored .antara/internal-secrets.json.'
            : 'Active in development memory.',
    },
    {
      id: 'encryption_key',
      label: 'Credential Vault Master Key (AES-256-GCM)',
      domain: 'encryption',
      classification:
        encryptionKeySource === 'env'
          ? 'already_available'
          : encryptionKeySource === 'local_file'
            ? 'generated_internally'
            : 'requires_external_authorization',
      configured: encryptionKeyConfigured,
      source: encryptionKeySource,
      summary: encryptionKeyConfigured
        ? `Active version ${encryptionKeyVersion}${rotationActive ? ` (rotating from ${previousKeyVersion})` : ''}; strictly separated from Firestore.`
        : 'Initialize key locally or set ENCRYPTION_KEY in Vercel before storing encrypted OAuth tokens.',
    },
    {
      id: 'gemini_provider',
      label: 'Autonomous AI & Research Model Providers',
      domain: 'ai',
      classification: aiConfigured ? 'already_available' : 'optional_unused',
      configured: aiConfigured,
      source: activeAiProviders.length > 0 ? activeAiProviders.join(', ') : 'unset',
      summary: aiConfigured
        ? `Server-side AI providers active: ${activeAiProviders.join(', ')}.${searchConfigured ? ' Grounded web search enabled.' : ''}`
        : 'AI inference providers are not configured in server environment (AI_PROVIDER_NOT_CONFIGURED). Other workspace modules continue operating normally.',
      maskedPreview: geminiConfigured ? maskSecretPreview(geminiKey) : undefined,
    },
    {
      id: 'google_workspace_oauth',
      label: 'Google Workspace & Apps Script OAuth Boundary',
      domain: 'google',
      classification: classifyOptionalProvider(googleOAuthConfigured),
      configured: googleOAuthConfigured,
      source: googleOAuthSource,
      summary: googleOAuthConfigured
        ? `OAuth client configured (${maskSecretPreview(googleClientId) || 'masked'}; callback: ${googleRedirectUri}). Ready for explicit user consent.`
        : 'Optional until an admin connects a Google OAuth 2.0 Web Client ID & Secret (one-time setup) or configures env variables.',
    },
    {
      id: 'meta_social',
      label: 'Meta Platforms (Instagram / Facebook / Marketing API)',
      domain: 'social',
      classification: classifyOptionalProvider(metaConfigured),
      configured: metaConfigured,
      source: metaConfigured ? 'META_APP_ID' : 'unset',
      summary: metaConfigured
        ? `Meta OAuth credentials present (callback: ${appUrl}/api/integrations/social/meta/callback). Ready for workspace account connection and Meta App Review verification.`
        : 'Optional provider adapter; configure META_APP_ID and META_APP_SECRET to connect Instagram, Facebook Pages, and Meta Ads.',
    },
    {
      id: 'linkedin_social',
      label: 'LinkedIn Posts API Adapter',
      domain: 'social',
      classification: classifyOptionalProvider(linkedinConfigured),
      configured: linkedinConfigured,
      source: linkedinConfigured ? 'LINKEDIN_CLIENT_ID' : 'unset',
      summary: linkedinConfigured
        ? `LinkedIn OAuth configured (API version ${linkedinApiVersion}, callback: ${appUrl}/api/integrations/social/linkedin/callback).`
        : 'Optional provider adapter; configure LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to connect LinkedIn Member or Organization publishing.',
    },
    {
      id: 'tiktok_social',
      label: 'TikTok Content Posting API Adapter',
      domain: 'social',
      classification: classifyOptionalProvider(tiktokConfigured),
      configured: tiktokConfigured,
      source: tiktokConfigured ? 'TIKTOK_CLIENT_KEY' : 'unset',
      summary: tiktokConfigured
        ? `TikTok OAuth configured (callback: ${appUrl}/api/integrations/social/tiktok/callback). Unaudited apps remain restricted to private/draft modes.`
        : 'Optional provider adapter; configure TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET to connect TikTok Content Posting.',
    },
    {
      id: 'canva_creative',
      label: 'Canva Connect REST API Adapter',
      domain: 'social',
      classification: classifyOptionalProvider(canvaConfigured),
      configured: canvaConfigured,
      source: canvaConfigured ? 'CANVA_CLIENT_ID' : 'unset',
      summary: canvaConfigured
        ? `Canva OAuth configured (callback: ${appUrl}/api/integrations/social/canva/callback) for design discovery and async export persistence.`
        : 'Optional creative adapter; configure CANVA_CLIENT_ID and CANVA_CLIENT_SECRET to enable Canva design and export jobs.',
    },
    {
      id: 'live_google_tests',
      label: 'Real Google Integration Test Suite',
      domain: 'testing',
      classification: realGoogleTestsEnabled ? 'already_available' : 'disabled',
      configured: realGoogleTestsEnabled,
      source: 'ENABLE_REAL_GOOGLE_INTEGRATION_TESTS',
      summary: realGoogleTestsEnabled
        ? 'Real Google integration test opt-in is enabled.'
        : 'Safely disabled by default (ENABLE_REAL_GOOGLE_INTEGRATION_TESTS=false).',
    },
  ];

  const snapshot: AutonomousConfigSnapshot = {
    environment: {
      nodeEnv,
      appUrl,
      isVercel,
      vercelEnv,
      defaultTimezone: DEFAULT_WORKSPACE_TIMEZONE,
    },
    firebase: {
      clientConfigured,
      clientSource,
      projectId: resolvedProjectId,
      databaseId: resolvedDatabaseId,
      isDefaultDatabase: resolvedDatabaseId === '(default)',
      adminAvailable,
      adminCredentialMode,
      restFallbackSupported: clientConfigured,
      projectConflict,
      ...(projectConflictDetail ? { projectConflictDetail } : {}),
      storageBucketConfigured: Boolean(firebaseClientConfig?.storageBucket),
    },
    secrets: {
      sessionSecretConfigured:
        sessionSecretSource === 'env' || sessionSecretSource === 'local_file',
      sessionSecretSource,
      encryptionKeyConfigured,
      encryptionKeyVersion,
      encryptionKeySource,
      rotationActive,
      ...(previousKeyVersion ? { previousKeyVersion } : {}),
      ...(serverlessWarning ? { serverlessWarning } : {}),
    },
    capabilities: {
      authReady: clientConfigured,
      databaseReady: clientConfigured || adminAvailable,
      encryptedVaultReady: encryptionKeyConfigured,
      geminiConfigured,
      aiConfigured,
      activeAiProviders,
      searchConfigured,
      googleOAuthConfigured,
      appsScriptReadyForPhase2: googleOAuthConfigured && encryptionKeyConfigured,
      realGoogleTestsEnabled,
    },
    items,
    generatedAt: new Date().toISOString(),
  };

  return {
    snapshot,
    firebaseClientConfig,
    sessionSecret,
    sessionCookieName: 'antara_session',
    enableRealGoogleIntegrationTests: realGoogleTestsEnabled,
    googleOAuthClientId: googleClientId,
    googleOAuthClientSecret: googleClientSecret,
    googleOAuthRedirectUri: googleRedirectUri,
    cronSecret,
    metaWebhookVerifyToken,
    linkedinApiVersion,
    gbpApiAccessStatus,
  };
}
