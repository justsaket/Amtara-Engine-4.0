import type {
  ConnectedSocialAccount,
  Phase4ProviderId,
  ProviderReadinessState,
  SocialPlatformId,
} from '@/types/domain';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { CANVA_REQUIRED_SCOPES } from './canva-adapter';
import {
  FACEBOOK_PAGE_REQUIRED_SCOPES,
  INSTAGRAM_REQUIRED_SCOPES_FB_LOGIN,
  META_ADS_REQUIRED_SCOPES,
  MetaFacebookPagesAdapter,
  MetaInstagramAdapter,
} from './meta-adapters';
import {
  GBP_REQUIRED_SCOPES,
  GoogleBusinessProfileAdapter,
  LINKEDIN_MEMBER_SCOPES,
  LinkedInAdapter,
  resolveGbpReadinessState,
  TIKTOK_DRAFT_UPLOAD_SCOPE,
  TikTokAdapter,
  YOUTUBE_REQUIRED_SCOPES,
  YouTubeAdapter,
} from './social-adapters';
import type {
  ProviderCapabilityMatrixEntry,
  ProviderPublishResult,
  ProviderReconcileResult,
  PublishPayloadInput,
  SocialPublishingAdapter,
} from './types';

const ADAPTERS: Record<SocialPlatformId, SocialPublishingAdapter> = {
  instagram: new MetaInstagramAdapter(),
  facebook: new MetaFacebookPagesAdapter(),
  youtube: new YouTubeAdapter(),
  linkedin: new LinkedInAdapter(),
  tiktok: new TikTokAdapter(),
  google_business_profile: new GoogleBusinessProfileAdapter(),
};

export function getSocialPublishingAdapter(platform: SocialPlatformId): SocialPublishingAdapter {
  return ADAPTERS[platform];
}

export function buildPhase4CapabilityMatrix(
  connectedAccounts: ConnectedSocialAccount[] = [],
): ProviderCapabilityMatrixEntry[] {
  const cfg = resolveAutonomousConfiguration();
  const appUrl = cfg.snapshot.environment.appUrl;

  const metaConfigured = Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
  const linkedinConfigured = Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
  const tiktokConfigured = Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
  const canvaConfigured = Boolean(process.env.CANVA_CLIENT_ID && process.env.CANVA_CLIENT_SECRET);
  const googleConfigured = cfg.snapshot.capabilities.googleOAuthConfigured;
  const gbpState = resolveGbpReadinessState(cfg.gbpApiAccessStatus);

  const resolveState = (
    provider: Phase4ProviderId,
    oauthConfigured: boolean,
    requiresReview = false,
  ): ProviderReadinessState => {
    const matches = connectedAccounts.filter((a) => a.provider === provider);
    if (matches.some((a) => a.status === 'connected')) return 'connected';
    if (matches.some((a) => a.status === 'app_review_required')) return 'app_review_required';
    if (matches.some((a) => a.status === 'reauth_required')) return 'error';
    if (matches.some((a) => a.status === 'disconnected' || a.status === 'revoked')) return 'disconnected';
    if (!oauthConfigured) return 'not_configured';
    return requiresReview ? 'app_review_required' : 'authorization_required';
  };

  return [
    {
      provider: 'instagram',
      displayName: 'Meta Instagram (Graph / Instagram Login)',
      category: 'social_publishing',
      officialApiName: 'Instagram Platform API v21.0',
      docsReviewedDate: '2026-04-01',
      readinessState: resolveState('instagram', metaConfigured),
      oauthConfigured: metaConfigured,
      requiredEnvVars: ['META_APP_ID', 'META_APP_SECRET'],
      requiredScopes: [...INSTAGRAM_REQUIRED_SCOPES_FB_LOGIN],
      supportedCapabilities: [
        'Single image & Reels container publishing',
        'Container status polling & reconciliation',
        'Comments & policy-aware messaging windows',
        'Media & account insights retrieval',
      ],
      unsupportedCapabilities: [
        'Text-only feed posts',
        'Personal (non-Business/Creator) accounts',
        'Cold DMs outside 24h / Click-to-Message ad window',
      ],
      appReviewNotes:
        'Requires Meta App Review for Advanced Access on instagram_content_publish and instagram_manage_messages in Live Mode.',
      callbackPath: `${appUrl}/api/integrations/social/meta/callback`,
    },
    {
      provider: 'facebook',
      displayName: 'Meta Facebook Pages',
      category: 'social_publishing',
      officialApiName: 'Facebook Graph API v21.0 (Pages)',
      docsReviewedDate: '2026-04-01',
      readinessState: resolveState('facebook', metaConfigured),
      oauthConfigured: metaConfigured,
      requiredEnvVars: ['META_APP_ID', 'META_APP_SECRET'],
      requiredScopes: [...FACEBOOK_PAGE_REQUIRED_SCOPES],
      supportedCapabilities: [
        'Page discovery & role check',
        'Text, photo, video, and Reel publishing',
        'Page comments & Messenger policy-aware replies',
        'Page & post insights collection',
      ],
      unsupportedCapabilities: ['Personal timeline posting', 'Deprecated Groups API posting'],
      appReviewNotes:
        'Requires Meta App Review for pages_manage_posts and pages_read_engagement for non-developer workspace users.',
      callbackPath: `${appUrl}/api/integrations/social/meta/callback`,
    },
    {
      provider: 'youtube',
      displayName: 'YouTube Data API v3',
      category: 'social_publishing',
      officialApiName: 'YouTube Data API v3 (Resumable Uploads)',
      docsReviewedDate: '2026-04-01',
      readinessState: resolveState('youtube', googleConfigured),
      oauthConfigured: googleConfigured,
      requiredEnvVars: ['GOOGLE_INTEGRATION_CLIENT_ID', 'GOOGLE_INTEGRATION_CLIENT_SECRET'],
      requiredScopes: [...YOUTUBE_REQUIRED_SCOPES],
      supportedCapabilities: [
        'Channel discovery',
        'Resumable video & Shorts upload',
        'Explicit Private / Unlisted / Public visibility control',
        'Upload vs processing state tracking',
      ],
      unsupportedCapabilities: ['Static image posts', 'Community text posts via API'],
      appReviewNotes:
        'Unaudited Google OAuth apps uploading via YouTube API are locked to Private videos until Google API Compliance Audit passes.',
      callbackPath: `${appUrl}/api/integrations/social/youtube/callback`,
    },
    {
      provider: 'linkedin',
      displayName: 'LinkedIn Posts API',
      category: 'social_publishing',
      officialApiName: `LinkedIn REST Posts API (Version ${cfg.linkedinApiVersion})`,
      docsReviewedDate: '2026-04-01',
      readinessState: resolveState('linkedin', linkedinConfigured),
      oauthConfigured: linkedinConfigured,
      requiredEnvVars: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
      requiredScopes: [...LINKEDIN_MEMBER_SCOPES],
      supportedCapabilities: [
        'Member posts (w_member_social)',
        'Organization Page posts when w_organization_social & admin role granted',
        'Configurable LinkedIn-Version header',
      ],
      unsupportedCapabilities: ['Direct Message inbox automation', 'Posting to org pages without verified admin role'],
      appReviewNotes:
        'Share on LinkedIn grants w_member_social; Community Management API approval is required for w_organization_social.',
      callbackPath: `${appUrl}/api/integrations/social/linkedin/callback`,
    },
    {
      provider: 'tiktok',
      displayName: 'TikTok Content Posting API',
      category: 'social_publishing',
      officialApiName: 'TikTok Content Posting API v2',
      docsReviewedDate: '2026-04-01',
      readinessState: resolveState('tiktok', tiktokConfigured),
      oauthConfigured: tiktokConfigured,
      requiredEnvVars: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
      requiredScopes: [TIKTOK_DRAFT_UPLOAD_SCOPE, 'video.publish'],
      supportedCapabilities: [
        'Draft upload to creator inbox (video.upload)',
        'Direct Post when audited & video.publish granted',
        'Publish status polling & reconciliation',
      ],
      unsupportedCapabilities: [
        'Text-only posts',
        'Public Direct Post on unaudited TikTok apps (forced to Private/Draft)',
        'Automated watermarked reposting',
      ],
      appReviewNotes:
        'TikTok restricts unaudited apps to SELF_ONLY private visibility or Draft Inbox upload until Content Posting API Audit completes.',
      callbackPath: `${appUrl}/api/integrations/social/tiktok/callback`,
    },
    {
      provider: 'google_business_profile',
      displayName: 'Google Business Profile',
      category: 'reputation',
      officialApiName: 'Google Business Profile APIs',
      docsReviewedDate: '2026-04-01',
      readinessState: resolveState(
        'google_business_profile',
        googleConfigured,
        gbpState !== 'approved' && gbpState !== 'connected',
      ),
      gbpAccessState: gbpState,
      oauthConfigured: googleConfigured,
      requiredEnvVars: ['GOOGLE_INTEGRATION_CLIENT_ID', 'GOOGLE_INTEGRATION_CLIENT_SECRET'],
      requiredScopes: [...GBP_REQUIRED_SCOPES],
      supportedCapabilities: [
        'Location discovery & GBP Local Post updates (once GBP API access approved)',
        'Review listing, 8-category classification & human-approved replies',
      ],
      unsupportedCapabilities: ['Deprecated GBP Business Messages chat', 'Short-form video Reels'],
      appReviewNotes:
        'Google Business Profile API requires separate Google Cloud Project API access approval request before non-zero quota is enabled.',
      callbackPath: `${appUrl}/api/integrations/social/gbp/callback`,
    },
    {
      provider: 'canva',
      displayName: 'Canva Connect REST API',
      category: 'creative',
      officialApiName: 'Canva Connect API v1',
      docsReviewedDate: '2026-04-01',
      readinessState: resolveState('canva', canvaConfigured),
      oauthConfigured: canvaConfigured,
      requiredEnvVars: ['CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET'],
      requiredScopes: [...CANVA_REQUIRED_SCOPES],
      supportedCapabilities: [
        'Design listing & metadata',
        'Custom design creation from Creative Briefs',
        'Async export job creation, bounded polling & Firebase Storage persistence',
      ],
      unsupportedCapabilities: [
        'In-editor Canva Content Publisher publishing (requires separate Canva Apps SDK integration)',
      ],
      appReviewNotes:
        'Enterprise Brand Template Autofill requires Canva Enterprise plan + brandtemplate scopes.',
      callbackPath: `${appUrl}/api/integrations/social/canva/callback`,
    },
    {
      provider: 'meta_ads',
      displayName: 'Meta Marketing API (Paid Ads)',
      category: 'paid_ads',
      officialApiName: 'Meta Marketing API v21.0',
      docsReviewedDate: '2026-04-01',
      readinessState: resolveState('meta_ads', metaConfigured),
      oauthConfigured: metaConfigured,
      requiredEnvVars: ['META_APP_ID', 'META_APP_SECRET'],
      requiredScopes: [...META_ADS_REQUIRED_SCOPES],
      supportedCapabilities: [
        'Ad account & campaign read/analysis',
        'Draft campaign plan & dry-run budget cap validation',
        'Owner-authorized budget-capped launch via Central Action Gateway',
      ],
      unsupportedCapabilities: ['Autonomous ad spend without explicit numeric caps & owner authorization'],
      appReviewNotes:
        'Disabled by default per brand until numeric daily/monthly limits and explicit owner authorization are configured.',
      callbackPath: `${appUrl}/api/integrations/social/meta/callback`,
    },
  ];
}

export interface SocialOAuthStartConfig {
  providerKey: 'meta' | 'linkedin' | 'tiktok' | 'canva' | 'youtube' | 'gbp';
  configured: boolean;
  authorizeUrl?: string;
  redirectUri: string;
  missingEnvVars: string[];
  scopes: string[];
}

export function buildSocialOAuthAuthorizationUrl(params: {
  providerKey: 'meta' | 'linkedin' | 'tiktok' | 'canva' | 'youtube' | 'gbp';
  state: string;
  authMode?: 'instagram_login' | 'facebook_login';
  codeChallenge?: string;
}): SocialOAuthStartConfig {
  const cfg = resolveAutonomousConfiguration();
  const appUrl = cfg.snapshot.environment.appUrl;
  const redirectUri = `${appUrl}/api/integrations/social/${params.providerKey}/callback`;

  if (params.providerKey === 'meta') {
    const clientId = (process.env.META_APP_ID || '').trim();
    const secret = (process.env.META_APP_SECRET || '').trim();
    const scopes =
      params.authMode === 'instagram_login'
        ? ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments']
        : [
            'pages_show_list',
            'pages_read_engagement',
            'pages_manage_posts',
            'instagram_basic',
            'instagram_content_publish',
            'ads_read',
          ];
    if (!clientId || !secret) {
      return {
        providerKey: 'meta',
        configured: false,
        redirectUri,
        missingEnvVars: ['META_APP_ID', 'META_APP_SECRET'],
        scopes,
      };
    }
    const base =
      params.authMode === 'instagram_login'
        ? 'https://www.instagram.com/oauth/authorize'
        : 'https://www.facebook.com/v21.0/dialog/oauth';
    const qs = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state: params.state,
      scope: scopes.join(','),
      response_type: 'code',
    });
    return { providerKey: 'meta', configured: true, authorizeUrl: `${base}?${qs.toString()}`, redirectUri, missingEnvVars: [], scopes };
  }

  if (params.providerKey === 'linkedin') {
    const clientId = (process.env.LINKEDIN_CLIENT_ID || '').trim();
    const secret = (process.env.LINKEDIN_CLIENT_SECRET || '').trim();
    const scopes = [...LINKEDIN_MEMBER_SCOPES];
    if (!clientId || !secret) {
      return {
        providerKey: 'linkedin',
        configured: false,
        redirectUri,
        missingEnvVars: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
        scopes,
      };
    }
    const qs = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state: params.state,
      scope: scopes.join(' '),
    });
    return {
      providerKey: 'linkedin',
      configured: true,
      authorizeUrl: `https://www.linkedin.com/oauth/v2/authorization?${qs.toString()}`,
      redirectUri,
      missingEnvVars: [],
      scopes,
    };
  }

  if (params.providerKey === 'tiktok') {
    const clientKey = (process.env.TIKTOK_CLIENT_KEY || '').trim();
    const secret = (process.env.TIKTOK_CLIENT_SECRET || '').trim();
    const scopes = ['user.info.basic', TIKTOK_DRAFT_UPLOAD_SCOPE];
    if (!clientKey || !secret) {
      return {
        providerKey: 'tiktok',
        configured: false,
        redirectUri,
        missingEnvVars: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
        scopes,
      };
    }
    const qs = new URLSearchParams({
      client_key: clientKey,
      redirect_uri: redirectUri,
      state: params.state,
      scope: scopes.join(','),
      response_type: 'code',
    });
    return {
      providerKey: 'tiktok',
      configured: true,
      authorizeUrl: `https://www.tiktok.com/v2/auth/authorize/?${qs.toString()}`,
      redirectUri,
      missingEnvVars: [],
      scopes,
    };
  }

  if (params.providerKey === 'canva') {
    const clientId = (process.env.CANVA_CLIENT_ID || '').trim();
    const secret = (process.env.CANVA_CLIENT_SECRET || '').trim();
    const scopes = [...CANVA_REQUIRED_SCOPES];
    if (!clientId || !secret) {
      return {
        providerKey: 'canva',
        configured: false,
        redirectUri,
        missingEnvVars: ['CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET'],
        scopes,
      };
    }
    const qs = new URLSearchParams({
      code_challenge_method: 'S256',
      code_challenge: params.codeChallenge || 'pending_pkce',
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state: params.state,
      scope: scopes.join(' '),
    });
    return {
      providerKey: 'canva',
      configured: true,
      authorizeUrl: `https://www.canva.com/api/oauth/authorize?${qs.toString()}`,
      redirectUri,
      missingEnvVars: [],
      scopes,
    };
  }

  // youtube or gbp use Google OAuth platform client
  const googleClientId = cfg.googleOAuthClientId;
  const scopes = params.providerKey === 'youtube' ? [...YOUTUBE_REQUIRED_SCOPES] : [...GBP_REQUIRED_SCOPES];
  if (!cfg.snapshot.capabilities.googleOAuthConfigured || !googleClientId) {
    return {
      providerKey: params.providerKey,
      configured: false,
      redirectUri,
      missingEnvVars: ['GOOGLE_INTEGRATION_CLIENT_ID', 'GOOGLE_INTEGRATION_CLIENT_SECRET'],
      scopes,
    };
  }
  const qs = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: params.state,
    scope: ['openid', 'email', 'profile', ...scopes].join(' '),
  });
  return {
    providerKey: params.providerKey,
    configured: true,
    authorizeUrl: `https://accounts.google.com/o/oauth2/v2/auth?${qs.toString()}`,
    redirectUri,
    missingEnvVars: [],
    scopes,
  };
}

/**
 * TEST ONLY isolated mock adapter for automated test suites.
 * Never registered in production ADAPTERS map.
 */
export function createTestOnlyMockPublishingAdapter(
  platform: SocialPlatformId,
  behavior: {
    mode:
      | 'success'
      | 'processing'
      | 'rate_limited'
      | 'temp_error'
      | 'perm_error'
      | 'publish_status_unknown';
    reconcileResult?: ProviderReconcileResult;
  },
): SocialPublishingAdapter & { callCount: number } {
  let callCount = 0;
  return {
    provider: platform,
    supportedFormats: ['text_post', 'single_image', 'carousel', 'short_video', 'reel', 'youtube_video', 'gbp_update'],
    requiredScopes: [],
    unsupportedCapabilities: ['unsupported_test_cap'],
    get callCount() {
      return callCount;
    },
    validatePayload(_account, payload) {
      if (!payload.caption.trim()) {
        return { valid: false, code: 'MEDIA_VALIDATION_FAILED', errors: ['Caption required.'] };
      }
      return { valid: true, errors: [] };
    },
    async publish(_account, _accessToken, payload): Promise<ProviderPublishResult> {
      callCount += 1;
      if (payload.dryRun) return { status: 'dry_run_valid' };
      switch (behavior.mode) {
        case 'success':
          return {
            status: 'published',
            externalPostId: `test_post_${platform}_${callCount}`,
            externalPostUrl: `https://example.test/${platform}/${callCount}`,
          };
        case 'processing':
          return {
            status: 'processing',
            providerContainerId: `test_container_${callCount}`,
          };
        case 'rate_limited':
          return {
            status: 'failed',
            errorCode: 'RATE_LIMITED',
            errorMessage: 'Simulated 429 rate limit.',
            retryable: true,
          };
        case 'temp_error':
          return {
            status: 'failed',
            errorCode: 'PROVIDER_TEMPORARY_ERROR',
            errorMessage: 'Simulated 503 temporary provider error.',
            retryable: true,
          };
        case 'perm_error':
          return {
            status: 'failed',
            errorCode: 'PROVIDER_PERMANENT_ERROR',
            errorMessage: 'Simulated 400 permanent payload error.',
            retryable: false,
          };
        case 'publish_status_unknown':
          return {
            status: 'publish_status_unknown',
            providerContainerId: `test_ambiguous_${callCount}`,
            errorCode: 'PUBLISH_STATUS_UNKNOWN',
            errorMessage: 'Simulated timeout after publish commit.',
            retryable: false,
            reconciliationRequired: true,
          };
      }
    },
    async reconcilePublishStatus(): Promise<ProviderReconcileResult> {
      return (
        behavior.reconcileResult || {
          reconciled: true,
          existsOnProvider: 'confirmed_published',
          externalPostId: `reconciled_${platform}_1`,
          detail: 'Confirmed published during reconciliation.',
        }
      );
    },
    checkUnsupportedCapability(capabilityName: string) {
      if (capabilityName === 'unsupported_test_cap') {
        return { supported: false, code: 'CAPABILITY_UNSUPPORTED', reason: 'Unsupported test capability.' };
      }
      return { supported: true };
    },
  };
}
