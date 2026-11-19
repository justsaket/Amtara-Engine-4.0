import type {
  AdCampaignRecord,
  CampaignBudgetPolicy,
  ConnectedSocialAccount,
  ContentFormat,
} from '@/types/domain';
import { classifyProviderHttpError, Phase4ExecutionError } from '@/lib/marketing/errors';
import { checkMediaCompatibilityForPlatform } from '@/lib/marketing/media-pipeline';
import type {
  ProviderPublishResult,
  ProviderReconcileResult,
  PublishPayloadInput,
  SocialPublishingAdapter,
} from './types';

export const META_GRAPH_VERSION = 'v21.0';
export const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
export const INSTAGRAM_GRAPH_BASE = `https://graph.instagram.com/${META_GRAPH_VERSION}`;

export const INSTAGRAM_REQUIRED_SCOPES_FB_LOGIN = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
] as const;

export const INSTAGRAM_REQUIRED_SCOPES_IG_LOGIN = [
  'instagram_business_basic',
  'instagram_business_content_publish',
] as const;

export const FACEBOOK_PAGE_REQUIRED_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
] as const;

export const META_ADS_REQUIRED_SCOPES = ['ads_read', 'ads_management'] as const;

function resolveInstagramHost(account: ConnectedSocialAccount): string {
  return account.authMode === 'instagram_login' ? INSTAGRAM_GRAPH_BASE : META_GRAPH_BASE;
}

export class MetaInstagramAdapter implements SocialPublishingAdapter {
  public readonly provider = 'instagram' as const;
  public readonly supportedFormats: readonly ContentFormat[] = [
    'single_image',
    'carousel',
    'reel',
    'short_video',
  ];
  public readonly requiredScopes: readonly string[] = INSTAGRAM_REQUIRED_SCOPES_FB_LOGIN;
  public readonly unsupportedCapabilities = [
    'text_only_feed_post',
    'personal_account_publishing',
    'cold_dm_outside_messaging_window',
  ] as const;

  validatePayload(account: ConnectedSocialAccount, payload: PublishPayloadInput) {
    const errors: string[] = [];
    if (account.accountType && account.accountType !== 'business' && account.accountType !== 'creator') {
      errors.push('Instagram Graph API supports only Business or Creator professional accounts.');
    }
    if (!this.supportedFormats.includes(payload.format)) {
      return {
        valid: false,
        code: 'CAPABILITY_UNSUPPORTED' as const,
        errors: [`Instagram does not support format "${payload.format}". Use single_image, carousel, or reel.`],
      };
    }
    if (payload.caption.length > 2200) {
      errors.push(`Instagram caption (${payload.caption.length} chars) exceeds 2200 character limit.`);
    }
    if (payload.mediaAssets.length === 0) {
      return {
        valid: false,
        code: 'MEDIA_VALIDATION_FAILED' as const,
        errors: ['Instagram requires at least one validated image or video asset.'],
      };
    }
    for (const asset of payload.mediaAssets) {
      const compat = checkMediaCompatibilityForPlatform(asset, 'instagram');
      if (!compat.compatible && compat.reason) errors.push(compat.reason);
    }
    return {
      valid: errors.length === 0,
      code: errors.length > 0 ? ('MEDIA_VALIDATION_FAILED' as const) : undefined,
      errors,
    };
  }

  async publish(
    account: ConnectedSocialAccount,
    accessToken: string,
    payload: PublishPayloadInput,
    fetchImpl: typeof fetch = fetch,
  ): Promise<ProviderPublishResult> {
    const check = this.validatePayload(account, payload);
    if (!check.valid) {
      return {
        status: 'failed',
        errorCode: check.code || 'MEDIA_VALIDATION_FAILED',
        errorMessage: check.errors.join(' '),
        retryable: false,
      };
    }
    if (payload.dryRun) {
      return {
        status: 'dry_run_valid',
        rawSummary: `Validated Instagram ${payload.format} payload for ${account.externalAccountId} (${account.authMode || 'facebook_login'}).`,
      };
    }

    const base = resolveInstagramHost(account);
    const primaryAsset = payload.mediaAssets[0];
    const mediaUrl = primaryAsset.publicPreviewUrl;
    if (!mediaUrl) {
      return {
        status: 'failed',
        errorCode: 'MEDIA_VALIDATION_FAILED',
        errorMessage: 'Persisted media asset requires a signed HTTPS URL accessible by Meta servers.',
        retryable: false,
      };
    }

    // Step 1: Create Media Container
    const isVideo = primaryAsset.mediaKind === 'video' || payload.format === 'reel';
    const containerParams = new URLSearchParams({
      caption: payload.caption,
      access_token: accessToken,
    });
    if (isVideo) {
      containerParams.set('media_type', 'REELS');
      containerParams.set('video_url', mediaUrl);
    } else {
      containerParams.set('image_url', mediaUrl);
    }

    let containerId = '';
    try {
      const createRes = await fetchImpl(
        `${base}/${encodeURIComponent(account.externalAccountId)}/media`,
        { method: 'POST', body: containerParams },
      );
      const createJson = (await createRes.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };
      if (!createRes.ok || !createJson.id) {
        const err = classifyProviderHttpError(
          'instagram',
          createRes.status,
          createJson.error?.message || 'Failed to create Instagram media container.',
        );
        return {
          status: 'failed',
          errorCode: err.code,
          errorMessage: err.message,
          retryable: err.retryable,
        };
      }
      containerId = createJson.id;
    } catch (error) {
      const err = classifyProviderHttpError(
        'instagram',
        0,
        error instanceof Error ? error.message : 'Network failure during Instagram container creation.',
      );
      return { status: 'failed', errorCode: err.code, errorMessage: err.message, retryable: true };
    }

    // Step 2: Check Container Readiness (for video/reels)
    if (isVideo) {
      const statusRes = await fetchImpl(
        `${base}/${encodeURIComponent(containerId)}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`,
      ).catch(() => null);
      if (statusRes?.ok) {
        const statusJson = (await statusRes.json().catch(() => ({}))) as { status_code?: string };
        if (statusJson.status_code === 'IN_PROGRESS') {
          return {
            status: 'processing',
            providerContainerId: containerId,
            rawSummary: 'Instagram container is still processing media; poll status before publishing.',
          };
        }
        if (statusJson.status_code === 'ERROR') {
          return {
            status: 'failed',
            providerContainerId: containerId,
            errorCode: 'MEDIA_VALIDATION_FAILED',
            errorMessage: 'Instagram rejected media container during processing.',
            retryable: false,
          };
        }
      }
    }

    // Step 3: Commit Publish — network ambiguity here MUST return PUBLISH_STATUS_UNKNOWN
    try {
      const pubParams = new URLSearchParams({
        creation_id: containerId,
        access_token: accessToken,
      });
      const pubRes = await fetchImpl(
        `${base}/${encodeURIComponent(account.externalAccountId)}/media_publish`,
        { method: 'POST', body: pubParams },
      );
      const pubJson = (await pubRes.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };
      if (!pubRes.ok || !pubJson.id) {
        const err = classifyProviderHttpError(
          'instagram',
          pubRes.status,
          pubJson.error?.message || 'Instagram media_publish failed.',
          { duringCommitPublish: pubRes.status === 504 || pubRes.status === 408 },
        );
        return {
          status: err.reconciliationRequired ? 'publish_status_unknown' : 'failed',
          providerContainerId: containerId,
          errorCode: err.code,
          errorMessage: err.message,
          retryable: err.retryable,
          reconciliationRequired: err.reconciliationRequired,
        };
      }
      return {
        status: 'published',
        providerContainerId: containerId,
        externalPostId: pubJson.id,
        externalPostUrl: `https://www.instagram.com/p/${pubJson.id}/`,
      };
    } catch (error) {
      const err = classifyProviderHttpError(
        'instagram',
        0,
        error instanceof Error ? error.message : 'Timeout during Instagram media_publish.',
        { duringCommitPublish: true },
      );
      return {
        status: 'publish_status_unknown',
        providerContainerId: containerId,
        errorCode: err.code,
        errorMessage: err.message,
        retryable: false,
        reconciliationRequired: true,
      };
    }
  }

  async reconcilePublishStatus(
    account: ConnectedSocialAccount,
    accessToken: string,
    params: { containerId?: string; idempotencyKey: string },
    fetchImpl: typeof fetch = fetch,
  ): Promise<ProviderReconcileResult> {
    if (!params.containerId) {
      return {
        reconciled: false,
        existsOnProvider: 'still_unknown',
        detail: 'No Instagram media container ID recorded; inspect recent Instagram media manually before retrying.',
      };
    }
    const base = resolveInstagramHost(account);
    const res = await fetchImpl(
      `${base}/${encodeURIComponent(params.containerId)}?fields=status_code,id&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!res.ok) {
      return {
        reconciled: false,
        existsOnProvider: 'still_unknown',
        detail: `Unable to query container status (HTTP ${res.status}).`,
      };
    }
    const json = (await res.json().catch(() => ({}))) as { status_code?: string; id?: string };
    if (json.status_code === 'PUBLISHED') {
      return {
        reconciled: true,
        existsOnProvider: 'confirmed_published',
        externalPostId: json.id,
        detail: 'Instagram confirmed container was published. Do not re-publish.',
      };
    }
    if (json.status_code === 'ERROR' || json.status_code === 'EXPIRED') {
      return {
        reconciled: true,
        existsOnProvider: 'confirmed_not_published',
        detail: `Instagram container is "${json.status_code}"; safe to create a fresh publish attempt.`,
      };
    }
    return {
      reconciled: false,
      existsOnProvider: 'still_unknown',
      detail: `Instagram container status is "${json.status_code || 'UNKNOWN'}".`,
    };
  }

  checkUnsupportedCapability(capabilityName: string) {
    if ((this.unsupportedCapabilities as readonly string[]).includes(capabilityName)) {
      return {
        supported: false,
        code: 'CAPABILITY_UNSUPPORTED' as const,
        reason: `Instagram API does not support "${capabilityName}".`,
      };
    }
    return { supported: true };
  }
}

export class MetaFacebookPagesAdapter implements SocialPublishingAdapter {
  public readonly provider = 'facebook' as const;
  public readonly supportedFormats: readonly ContentFormat[] = [
    'text_post',
    'single_image',
    'carousel',
    'short_video',
    'reel',
  ];
  public readonly requiredScopes: readonly string[] = FACEBOOK_PAGE_REQUIRED_SCOPES;
  public readonly unsupportedCapabilities = [
    'personal_profile_posting',
    'group_posting_deprecated',
  ] as const;

  validatePayload(account: ConnectedSocialAccount, payload: PublishPayloadInput) {
    const errors: string[] = [];
    if (account.accountType && account.accountType !== 'page') {
      errors.push('Facebook publishing requires an authorized Facebook Page with Page access token.');
    }
    if (!this.supportedFormats.includes(payload.format)) {
      return {
        valid: false,
        code: 'CAPABILITY_UNSUPPORTED' as const,
        errors: [`Facebook Pages adapter does not support format "${payload.format}".`],
      };
    }
    if (!payload.caption.trim() && payload.mediaAssets.length === 0) {
      errors.push('Facebook Page post requires message text or at least one validated media asset.');
    }
    return { valid: errors.length === 0, code: errors.length > 0 ? ('MEDIA_VALIDATION_FAILED' as const) : undefined, errors };
  }

  async publish(
    account: ConnectedSocialAccount,
    accessToken: string,
    payload: PublishPayloadInput,
    fetchImpl: typeof fetch = fetch,
  ): Promise<ProviderPublishResult> {
    const check = this.validatePayload(account, payload);
    if (!check.valid) {
      return {
        status: 'failed',
        errorCode: check.code || 'MEDIA_VALIDATION_FAILED',
        errorMessage: check.errors.join(' '),
        retryable: false,
      };
    }
    if (payload.dryRun) {
      return {
        status: 'dry_run_valid',
        rawSummary: `Validated Facebook Page ${payload.format} payload for Page ${account.externalAccountId}.`,
      };
    }

    const asset = payload.mediaAssets[0];
    const isPhoto = asset?.mediaKind === 'image' && asset.publicPreviewUrl;
    const isVideo = asset?.mediaKind === 'video' && asset.publicPreviewUrl;
    const endpoint = isPhoto
      ? `${META_GRAPH_BASE}/${encodeURIComponent(account.externalAccountId)}/photos`
      : isVideo
        ? `${META_GRAPH_BASE}/${encodeURIComponent(account.externalAccountId)}/videos`
        : `${META_GRAPH_BASE}/${encodeURIComponent(account.externalAccountId)}/feed`;

    const body = new URLSearchParams({ access_token: accessToken });
    if (isPhoto) {
      body.set('url', asset.publicPreviewUrl!);
      body.set('caption', payload.caption);
    } else if (isVideo) {
      body.set('file_url', asset.publicPreviewUrl!);
      body.set('description', payload.caption);
    } else {
      body.set('message', payload.caption);
    }

    try {
      const res = await fetchImpl(endpoint, { method: 'POST', body });
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        post_id?: string;
        error?: { message?: string };
      };
      if (!res.ok || (!json.id && !json.post_id)) {
        const err = classifyProviderHttpError(
          'facebook',
          res.status,
          json.error?.message || 'Facebook Page publish failed.',
          { duringCommitPublish: res.status === 504 || res.status === 408 },
        );
        return {
          status: err.reconciliationRequired ? 'publish_status_unknown' : 'failed',
          errorCode: err.code,
          errorMessage: err.message,
          retryable: err.retryable,
          reconciliationRequired: err.reconciliationRequired,
        };
      }
      const postId = json.post_id || json.id!;
      return {
        status: 'published',
        externalPostId: postId,
        externalPostUrl: `https://www.facebook.com/${postId}`,
      };
    } catch (error) {
      const err = classifyProviderHttpError(
        'facebook',
        0,
        error instanceof Error ? error.message : 'Network error during Facebook Page publish.',
        { duringCommitPublish: true },
      );
      return {
        status: 'publish_status_unknown',
        errorCode: err.code,
        errorMessage: err.message,
        retryable: false,
        reconciliationRequired: true,
      };
    }
  }

  async reconcilePublishStatus(
    account: ConnectedSocialAccount,
    accessToken: string,
    params: { idempotencyKey: string; publishedAfterIso?: string },
    fetchImpl: typeof fetch = fetch,
  ): Promise<ProviderReconcileResult> {
    const res = await fetchImpl(
      `${META_GRAPH_BASE}/${encodeURIComponent(account.externalAccountId)}/posts?limit=5&fields=id,created_time,permalink_url&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!res.ok) {
      return {
        reconciled: false,
        existsOnProvider: 'still_unknown',
        detail: `Could not fetch recent Facebook Page posts (HTTP ${res.status}).`,
      };
    }
    const json = (await res.json().catch(() => ({}))) as {
      data?: Array<{ id: string; created_time: string; permalink_url?: string }>;
    };
    const cutoff = params.publishedAfterIso ? Date.parse(params.publishedAfterIso) : 0;
    const recent = (json.data || []).find((p) => cutoff > 0 && Date.parse(p.created_time) >= cutoff);
    if (recent) {
      return {
        reconciled: true,
        existsOnProvider: 'confirmed_published',
        externalPostId: recent.id,
        externalPostUrl: recent.permalink_url,
        detail: 'Matching recent Facebook Page post detected; skipping duplicate retry.',
      };
    }
    return {
      reconciled: true,
      existsOnProvider: 'confirmed_not_published',
      detail: 'No matching post created after attempt timestamp on Facebook Page.',
    };
  }

  checkUnsupportedCapability(capabilityName: string) {
    if ((this.unsupportedCapabilities as readonly string[]).includes(capabilityName)) {
      return {
        supported: false,
        code: 'CAPABILITY_UNSUPPORTED' as const,
        reason: `Facebook Pages Graph API does not support "${capabilityName}".`,
      };
    }
    return { supported: true };
  }
}

export function validateMetaAdCampaignDryRun(
  campaign: Pick<AdCampaignRecord, 'name' | 'dailyBudget' | 'totalBudget' | 'currency' | 'audienceSummary'>,
  budgetPolicy: CampaignBudgetPolicy | null | undefined,
): {
  valid: boolean;
  canLaunchLive: boolean;
  warnings: string[];
  blockingReason?: string;
} {
  const warnings: string[] = [];
  if (!campaign.audienceSummary || campaign.audienceSummary.length < 10) {
    warnings.push('Audience summary is very brief; specify geography, industry, and exclusion criteria.');
  }
  if (!budgetPolicy || !budgetPolicy.enabled) {
    return {
      valid: true,
      canLaunchLive: false,
      warnings,
      blockingReason:
        'Paid ad spend is disabled in this brand budget policy. Campaign remains in draft/dry-run mode only.',
    };
  }
  if (budgetPolicy.maxDailySpend === null || budgetPolicy.maxMonthlySpend === null) {
    return {
      valid: true,
      canLaunchLive: false,
      warnings,
      blockingReason: 'Numeric daily and monthly spend limits must be saved before live Meta Ads launch.',
    };
  }
  if (!budgetPolicy.ownerAuthorizedByUid) {
    return {
      valid: true,
      canLaunchLive: false,
      warnings,
      blockingReason: 'Explicit workspace owner authorization is missing on the budget policy.',
    };
  }
  if (campaign.dailyBudget && campaign.dailyBudget > budgetPolicy.maxDailySpend) {
    return {
      valid: false,
      canLaunchLive: false,
      warnings,
      blockingReason: `Daily budget (${campaign.dailyBudget} ${campaign.currency}) exceeds policy cap (${budgetPolicy.maxDailySpend} ${budgetPolicy.currency}).`,
    };
  }
  if (campaign.totalBudget && campaign.totalBudget > budgetPolicy.maxMonthlySpend) {
    return {
      valid: false,
      canLaunchLive: false,
      warnings,
      blockingReason: `Total budget (${campaign.totalBudget} ${campaign.currency}) exceeds monthly cap (${budgetPolicy.maxMonthlySpend} ${budgetPolicy.currency}).`,
    };
  }
  return { valid: true, canLaunchLive: true, warnings };
}

export async function fetchMetaAdAccountSummary(
  adAccountId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  accountId: string;
  currency?: string;
  campaigns: Array<{ id: string; name: string; status: string; objective?: string }>;
}> {
  const normalizedId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const res = await fetchImpl(
    `${META_GRAPH_BASE}/${encodeURIComponent(normalizedId)}/campaigns?fields=id,name,status,objective&limit=25&access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw classifyProviderHttpError('meta_ads', res.status, text || 'Failed to read Meta Ads campaigns.');
  }
  const json = (await res.json().catch(() => ({}))) as {
    data?: Array<{ id: string; name: string; status: string; objective?: string }>;
  };
  return {
    accountId: normalizedId,
    campaigns: json.data || [],
  };
}

export function assertMetaAdsSpendNotBypassed(budgetPolicy: CampaignBudgetPolicy | null | undefined): void {
  if (!budgetPolicy || !budgetPolicy.enabled || !budgetPolicy.ownerAuthorizedByUid) {
    throw new Phase4ExecutionError({
      code: 'PAID_SPEND_NOT_AUTHORIZED',
      provider: 'meta_ads',
      httpStatus: 403,
      retryable: false,
      reconciliationRequired: false,
      message: 'Meta Ads mutation blocked: numeric budget limits and explicit owner authorization are required.',
      nextAction: 'Configure brand budget limits and owner authorization under Paid Campaigns.',
    });
  }
}
