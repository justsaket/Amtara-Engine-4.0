import type {
  ConnectedSocialAccount,
  ContentFormat,
  GbpApiAccessState,
  MediaAssetRecord,
  Phase4ErrorCode,
  Phase4ProviderId,
  ProviderReadinessState,
  SocialPlatformId,
} from '@/types/domain';

export interface ProviderOAuthTokenPayload {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
  externalAccountId?: string;
  displayName?: string;
  handle?: string;
  pageAccessToken?: string;
}

export interface PublishPayloadInput {
  workspaceId: string;
  brandId: string;
  contentItemId: string;
  title: string;
  caption: string;
  format: ContentFormat;
  hashtags: string[];
  mediaAssets: MediaAssetRecord[];
  visibility?: 'public' | 'unlisted' | 'private' | 'draft';
  idempotencyKey: string;
  dryRun?: boolean;
}

export interface ProviderPublishResult {
  status: 'published' | 'processing' | 'publish_status_unknown' | 'failed' | 'dry_run_valid';
  providerContainerId?: string;
  externalPostId?: string;
  externalPostUrl?: string;
  errorCode?: Phase4ErrorCode;
  errorMessage?: string;
  retryable?: boolean;
  reconciliationRequired?: boolean;
  rawSummary?: string;
}

export interface ProviderReconcileResult {
  reconciled: boolean;
  existsOnProvider: 'confirmed_published' | 'confirmed_not_published' | 'still_unknown';
  externalPostId?: string;
  externalPostUrl?: string;
  detail: string;
}

export interface ProviderCapabilityMatrixEntry {
  provider: Phase4ProviderId;
  displayName: string;
  category: 'social_publishing' | 'creative' | 'paid_ads' | 'reputation';
  officialApiName: string;
  docsReviewedDate: string;
  readinessState: ProviderReadinessState;
  gbpAccessState?: GbpApiAccessState;
  oauthConfigured: boolean;
  requiredEnvVars: string[];
  requiredScopes: string[];
  supportedCapabilities: string[];
  unsupportedCapabilities: string[];
  appReviewNotes: string;
  callbackPath: string;
}

export interface SocialPublishingAdapter {
  readonly provider: SocialPlatformId;
  readonly supportedFormats: readonly ContentFormat[];
  readonly requiredScopes: readonly string[];
  readonly unsupportedCapabilities: readonly string[];

  validatePayload(
    account: ConnectedSocialAccount,
    payload: PublishPayloadInput,
  ): { valid: boolean; code?: Phase4ErrorCode; errors: string[] };

  publish(
    account: ConnectedSocialAccount,
    accessToken: string,
    payload: PublishPayloadInput,
    fetchImpl?: typeof fetch,
  ): Promise<ProviderPublishResult>;

  reconcilePublishStatus(
    account: ConnectedSocialAccount,
    accessToken: string,
    params: { containerId?: string; idempotencyKey: string; publishedAfterIso?: string },
    fetchImpl?: typeof fetch,
  ): Promise<ProviderReconcileResult>;

  checkUnsupportedCapability(capabilityName: string): {
    supported: boolean;
    code?: Phase4ErrorCode;
    reason?: string;
  };
}
