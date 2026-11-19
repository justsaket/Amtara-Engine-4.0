import type {
  ConnectedSocialAccount,
  ContentFormat,
  GbpApiAccessState,
} from '@/types/domain';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { classifyProviderHttpError } from '@/lib/marketing/errors';
import { checkMediaCompatibilityForPlatform } from '@/lib/marketing/media-pipeline';
import type {
  ProviderPublishResult,
  ProviderReconcileResult,
  PublishPayloadInput,
  SocialPublishingAdapter,
} from './types';

// =============================================================================
// 1. YouTube Data API v3 Adapter
// =============================================================================

export const YOUTUBE_REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
] as const;

export class YouTubeAdapter implements SocialPublishingAdapter {
  public readonly provider = 'youtube' as const;
  public readonly supportedFormats: readonly ContentFormat[] = ['youtube_video', 'youtube_short', 'short_video'];
  public readonly requiredScopes: readonly string[] = YOUTUBE_REQUIRED_SCOPES;
  public readonly unsupportedCapabilities = [
    'text_only_community_post_api',
    'static_image_post',
  ] as const;

  validatePayload(_account: ConnectedSocialAccount, payload: PublishPayloadInput) {
    const errors: string[] = [];
    if (!this.supportedFormats.includes(payload.format)) {
      return {
        valid: false,
        code: 'CAPABILITY_UNSUPPORTED' as const,
        errors: [`YouTube Data API v3 requires a video format, not "${payload.format}".`],
      };
    }
    const video = payload.mediaAssets.find((a) => a.mediaKind === 'video');
    if (!video) {
      return {
        valid: false,
        code: 'MEDIA_VALIDATION_FAILED' as const,
        errors: ['YouTube upload requires a validated MP4/MOV/WebM video asset.'],
      };
    }
    const compat = checkMediaCompatibilityForPlatform(video, 'youtube');
    if (!compat.compatible && compat.reason) errors.push(compat.reason);
    if (!payload.title.trim()) errors.push('YouTube video requires a title (max 100 chars).');
    if (payload.title.length > 100) errors.push('YouTube video title exceeds 100 characters.');
    if (!payload.visibility || !['private', 'unlisted', 'public'].includes(payload.visibility)) {
      errors.push('Explicit YouTube privacy status (private, unlisted, or public) is required.');
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
        rawSummary: `Validated YouTube resumable upload payload (${payload.visibility || 'private'}) for channel ${account.externalAccountId}.`,
      };
    }

    const video = payload.mediaAssets.find((a) => a.mediaKind === 'video')!;
    const privacyStatus = payload.visibility === 'public' || payload.visibility === 'unlisted' ? payload.visibility : 'private';

    // Initialize resumable upload session (does not load full video file into memory)
    try {
      const initRes = await fetchImpl(
        'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Length': String(video.sizeBytes),
            'X-Upload-Content-Type': video.mimeType,
          },
          body: JSON.stringify({
            snippet: {
              title: payload.title.slice(0, 100),
              description: payload.caption.slice(0, 5000),
              tags: payload.hashtags.map((h) => h.replace(/^#/, '')).slice(0, 15),
            },
            status: {
              privacyStatus,
              selfDeclaredMadeForKids: false,
            },
          }),
        },
      );

      if (!initRes.ok) {
        const text = await initRes.text().catch(() => '');
        const err = classifyProviderHttpError('youtube', initRes.status, text || 'YouTube resumable upload init failed.');
        return { status: 'failed', errorCode: err.code, errorMessage: err.message, retryable: err.retryable };
      }

      const uploadLocation = initRes.headers.get('location');
      if (!uploadLocation) {
        return {
          status: 'failed',
          errorCode: 'PROVIDER_PERMANENT_ERROR',
          errorMessage: 'YouTube did not return a resumable upload Location header.',
          retryable: false,
        };
      }

      if (!video.publicPreviewUrl) {
        return {
          status: 'processing',
          providerContainerId: uploadLocation,
          rawSummary: 'YouTube resumable upload session initialized; awaiting chunked media stream from Firebase Storage.',
        };
      }

      // Stream transfer from storage signed URL to YouTube resumable endpoint
      const mediaStreamRes = await fetchImpl(video.publicPreviewUrl);
      if (!mediaStreamRes.ok) {
        return {
          status: 'failed',
          errorCode: 'MEDIA_VALIDATION_FAILED',
          errorMessage: `Failed to stream video from storage (HTTP ${mediaStreamRes.status}).`,
          retryable: true,
        };
      }

      const uploadRes = await fetchImpl(uploadLocation, {
        method: 'PUT',
        headers: {
          'Content-Type': video.mimeType,
          'Content-Length': String(video.sizeBytes),
        },
        body: await mediaStreamRes.arrayBuffer(),
      });

      const uploadJson = (await uploadRes.json().catch(() => ({}))) as {
        id?: string;
        status?: { uploadStatus?: string };
        error?: { message?: string };
      };

      if (!uploadRes.ok || !uploadJson.id) {
        const err = classifyProviderHttpError(
          'youtube',
          uploadRes.status,
          uploadJson.error?.message || 'YouTube video upload failed.',
          { duringCommitPublish: uploadRes.status === 504 || uploadRes.status === 408 },
        );
        return {
          status: err.reconciliationRequired ? 'publish_status_unknown' : 'failed',
          providerContainerId: uploadLocation,
          errorCode: err.code,
          errorMessage: err.message,
          retryable: err.retryable,
          reconciliationRequired: err.reconciliationRequired,
        };
      }

      // Separate upload completion from YouTube server processing state
      const isProcessing = uploadJson.status?.uploadStatus === 'uploaded';
      return {
        status: isProcessing ? 'processing' : 'published',
        externalPostId: uploadJson.id,
        externalPostUrl: `https://www.youtube.com/watch?v=${uploadJson.id}`,
        rawSummary: isProcessing
          ? `Video uploaded to YouTube (${privacyStatus}) and currently processing.`
          : `Video published to YouTube (${privacyStatus}).`,
      };
    } catch (error) {
      const err = classifyProviderHttpError(
        'youtube',
        0,
        error instanceof Error ? error.message : 'Network interruption during YouTube upload.',
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
    _account: ConnectedSocialAccount,
    accessToken: string,
    params: { containerId?: string },
    fetchImpl: typeof fetch = fetch,
  ): Promise<ProviderReconcileResult> {
    if (!params.containerId) {
      return {
        reconciled: false,
        existsOnProvider: 'still_unknown',
        detail: 'No YouTube upload session or video ID recorded. Inspect YouTube Studio before re-uploading.',
      };
    }
    const res = await fetchImpl(
      `https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(params.containerId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      return { reconciled: false, existsOnProvider: 'still_unknown', detail: `YouTube status query returned HTTP ${res.status}.` };
    }
    const json = (await res.json().catch(() => ({}))) as {
      items?: Array<{ id: string; status?: { uploadStatus?: string } }>;
    };
    const item = json.items?.[0];
    if (item) {
      return {
        reconciled: true,
        existsOnProvider: 'confirmed_published',
        externalPostId: item.id,
        externalPostUrl: `https://www.youtube.com/watch?v=${item.id}`,
        detail: `YouTube confirmed video exists (uploadStatus: ${item.status?.uploadStatus || 'processed'}).`,
      };
    }
    return {
      reconciled: true,
      existsOnProvider: 'confirmed_not_published',
      detail: 'No YouTube video found for recorded ID.',
    };
  }

  checkUnsupportedCapability(capabilityName: string) {
    if ((this.unsupportedCapabilities as readonly string[]).includes(capabilityName)) {
      return {
        supported: false,
        code: 'CAPABILITY_UNSUPPORTED' as const,
        reason: `YouTube Data API v3 does not support "${capabilityName}".`,
      };
    }
    return { supported: true };
  }
}

// =============================================================================
// 2. LinkedIn Posts API Adapter
// =============================================================================

export const LINKEDIN_MEMBER_SCOPES = ['openid', 'profile', 'w_member_social'] as const;
export const LINKEDIN_ORG_SCOPES = ['w_organization_social', 'r_organization_social'] as const;

export class LinkedInAdapter implements SocialPublishingAdapter {
  public readonly provider = 'linkedin' as const;
  public readonly supportedFormats: readonly ContentFormat[] = [
    'text_post',
    'single_image',
    'carousel',
    'short_video',
    'blog_article',
  ];
  public readonly requiredScopes: readonly string[] = ['w_member_social'];
  public readonly unsupportedCapabilities = [
    'direct_message_inbox_api',
    'unauthorized_org_posting_without_admin_role',
  ] as const;

  validatePayload(account: ConnectedSocialAccount, payload: PublishPayloadInput) {
    const errors: string[] = [];
    if (!this.supportedFormats.includes(payload.format)) {
      return {
        valid: false,
        code: 'CAPABILITY_UNSUPPORTED' as const,
        errors: [`LinkedIn adapter does not support format "${payload.format}".`],
      };
    }
    if (payload.caption.length > 3000) {
      errors.push(`LinkedIn post commentary (${payload.caption.length}) exceeds 3000 character limit.`);
    }
    const isOrg = account.accountType === 'organization';
    const requiredScope = isOrg ? 'w_organization_social' : 'w_member_social';
    if (!account.grantedScopes.includes(requiredScope)) {
      return {
        valid: false,
        code: 'PERMISSION_MISSING' as const,
        errors: [`LinkedIn ${isOrg ? 'organization' : 'member'} posting requires "${requiredScope}" scope.`],
      };
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

    const { linkedinApiVersion } = resolveAutonomousConfiguration();
    const authorUrn = account.externalAccountId.startsWith('urn:li:')
      ? account.externalAccountId
      : account.accountType === 'organization'
        ? `urn:li:organization:${account.externalAccountId}`
        : `urn:li:person:${account.externalAccountId}`;

    if (payload.dryRun) {
      return {
        status: 'dry_run_valid',
        rawSummary: `Validated LinkedIn Posts API (${linkedinApiVersion}) payload for ${authorUrn}.`,
      };
    }

    try {
      const res = await fetchImpl('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': linkedinApiVersion,
        },
        body: JSON.stringify({
          author: authorUrn,
          commentary: payload.caption,
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        }),
      });

      const restliId = res.headers.get('x-restli-id') || undefined;
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = classifyProviderHttpError('linkedin', res.status, text || 'LinkedIn post creation failed.', {
          duringCommitPublish: res.status === 504 || res.status === 408,
        });
        return {
          status: err.reconciliationRequired ? 'publish_status_unknown' : 'failed',
          errorCode: err.code,
          errorMessage: err.message,
          retryable: err.retryable,
          reconciliationRequired: err.reconciliationRequired,
        };
      }

      return {
        status: 'published',
        externalPostId: restliId,
        externalPostUrl: restliId ? `https://www.linkedin.com/feed/update/${encodeURIComponent(restliId)}/` : undefined,
      };
    } catch (error) {
      const err = classifyProviderHttpError(
        'linkedin',
        0,
        error instanceof Error ? error.message : 'LinkedIn request timed out.',
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
    _account: ConnectedSocialAccount,
    _accessToken: string,
    _params: { containerId?: string; idempotencyKey: string },
  ): Promise<ProviderReconcileResult> {
    return {
      reconciled: false,
      existsOnProvider: 'still_unknown',
      detail: 'Verify latest LinkedIn feed posts before manually retrying to prevent duplicate publications.',
    };
  }

  checkUnsupportedCapability(capabilityName: string) {
    if ((this.unsupportedCapabilities as readonly string[]).includes(capabilityName)) {
      return {
        supported: false,
        code: 'CAPABILITY_UNSUPPORTED' as const,
        reason: `LinkedIn Posts API does not support "${capabilityName}".`,
      };
    }
    return { supported: true };
  }
}

// =============================================================================
// 3. TikTok Content Posting API Adapter
// =============================================================================

export const TIKTOK_DIRECT_PUBLISH_SCOPE = 'video.publish';
export const TIKTOK_DRAFT_UPLOAD_SCOPE = 'video.upload';

export class TikTokAdapter implements SocialPublishingAdapter {
  public readonly provider = 'tiktok' as const;
  public readonly supportedFormats: readonly ContentFormat[] = ['short_video', 'reel'];
  public readonly requiredScopes: readonly string[] = [TIKTOK_DRAFT_UPLOAD_SCOPE];
  public readonly unsupportedCapabilities = [
    'text_only_post',
    'public_post_on_unaudited_app',
    'watermarked_repost_automation',
  ] as const;

  validatePayload(account: ConnectedSocialAccount, payload: PublishPayloadInput) {
    const errors: string[] = [];
    if (!this.supportedFormats.includes(payload.format)) {
      return {
        valid: false,
        code: 'CAPABILITY_UNSUPPORTED' as const,
        errors: [`TikTok Content Posting API requires short video format, not "${payload.format}".`],
      };
    }
    const video = payload.mediaAssets.find((a) => a.mediaKind === 'video');
    if (!video) {
      return {
        valid: false,
        code: 'MEDIA_VALIDATION_FAILED' as const,
        errors: ['TikTok publishing requires a validated MP4/MOV video asset.'],
      };
    }
    const isDirectPublic = payload.visibility === 'public';
    if (isDirectPublic && account.unauditedAppWarning) {
      return {
        valid: false,
        code: 'APP_REVIEW_REQUIRED' as const,
        errors: [
          'TikTok app is unaudited: public Direct Post is restricted by TikTok policy. Switch visibility to "private" or "draft" (video.upload) until TikTok Audit passes.',
        ],
      };
    }
    if (isDirectPublic && !account.grantedScopes.includes(TIKTOK_DIRECT_PUBLISH_SCOPE)) {
      return {
        valid: false,
        code: 'PERMISSION_MISSING' as const,
        errors: ['TikTok Direct Post requires "video.publish" scope; otherwise publish as Draft using "video.upload".'],
      };
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

    const isDirect = payload.visibility === 'public' || payload.visibility === 'private';
    if (payload.dryRun) {
      return {
        status: 'dry_run_valid',
        rawSummary: `Validated TikTok ${isDirect ? 'Direct Post' : 'Draft Upload (Inbox)'} payload for ${account.displayName}.`,
      };
    }

    const video = payload.mediaAssets.find((a) => a.mediaKind === 'video')!;
    if (!video.publicPreviewUrl) {
      return {
        status: 'failed',
        errorCode: 'MEDIA_VALIDATION_FAILED',
        errorMessage: 'TikTok PULL_FROM_URL requires a verified HTTPS media URL.',
        retryable: false,
      };
    }

    const endpoint = isDirect
      ? 'https://open.tiktokapis.com/v2/post/publish/video/init/'
      : 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';

    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          ...(isDirect
            ? {
                post_info: {
                  title: payload.caption.slice(0, 2200),
                  privacy_level: payload.visibility === 'public' ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY',
                  disable_duet: false,
                  disable_comment: false,
                  disable_stitch: false,
                },
              }
            : {}),
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: video.publicPreviewUrl,
          },
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        data?: { publish_id?: string };
        error?: { code?: string; message?: string };
      };
      if (!res.ok || !json.data?.publish_id) {
        const err = classifyProviderHttpError(
          'tiktok',
          res.status,
          json.error?.message || 'TikTok publish init failed.',
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

      return {
        status: 'processing',
        providerContainerId: json.data.publish_id,
        rawSummary: `TikTok ${isDirect ? 'Direct Post' : 'Draft Upload'} accepted (publish_id: ${json.data.publish_id}); polling required.`,
      };
    } catch (error) {
      const err = classifyProviderHttpError(
        'tiktok',
        0,
        error instanceof Error ? error.message : 'Network error during TikTok publish.',
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
    _account: ConnectedSocialAccount,
    accessToken: string,
    params: { containerId?: string },
    fetchImpl: typeof fetch = fetch,
  ): Promise<ProviderReconcileResult> {
    if (!params.containerId) {
      return { reconciled: false, existsOnProvider: 'still_unknown', detail: 'No TikTok publish_id recorded.' };
    }
    const res = await fetchImpl('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ publish_id: params.containerId }),
    });
    if (!res.ok) {
      return { reconciled: false, existsOnProvider: 'still_unknown', detail: `TikTok status fetch HTTP ${res.status}.` };
    }
    const json = (await res.json().catch(() => ({}))) as {
      data?: { status?: string; publicaly_available_post_id?: string[] };
    };
    const st = json.data?.status;
    if (st === 'PUBLISH_COMPLETE' || st === 'SEND_TO_USER_INBOX') {
      return {
        reconciled: true,
        existsOnProvider: 'confirmed_published',
        externalPostId: json.data?.publicaly_available_post_id?.[0] || params.containerId,
        detail: `TikTok confirmed status "${st}".`,
      };
    }
    if (st === 'FAILED') {
      return { reconciled: true, existsOnProvider: 'confirmed_not_published', detail: 'TikTok reported publish FAILED.' };
    }
    return { reconciled: false, existsOnProvider: 'still_unknown', detail: `TikTok status is "${st || 'PROCESSING'}".` };
  }

  checkUnsupportedCapability(capabilityName: string) {
    if ((this.unsupportedCapabilities as readonly string[]).includes(capabilityName)) {
      return {
        supported: false,
        code: 'CAPABILITY_UNSUPPORTED' as const,
        reason: `TikTok Content Posting API does not support "${capabilityName}".`,
      };
    }
    return { supported: true };
  }
}

// =============================================================================
// 4. Google Business Profile (GBP) Adapter
// =============================================================================

export const GBP_REQUIRED_SCOPES = ['https://www.googleapis.com/auth/business.manage'] as const;

export function resolveGbpReadinessState(configuredStatus?: string): GbpApiAccessState {
  const valid: GbpApiAccessState[] = [
    'access_not_requested',
    'access_under_review',
    'approved',
    'api_not_enabled',
    'account_permission_missing',
    'connected',
  ];
  return valid.includes(configuredStatus as GbpApiAccessState)
    ? (configuredStatus as GbpApiAccessState)
    : 'access_not_requested';
}

export class GoogleBusinessProfileAdapter implements SocialPublishingAdapter {
  public readonly provider = 'google_business_profile' as const;
  public readonly supportedFormats: readonly ContentFormat[] = ['gbp_update', 'text_post', 'single_image'];
  public readonly requiredScopes: readonly string[] = GBP_REQUIRED_SCOPES;
  public readonly unsupportedCapabilities = [
    'direct_message_chat_deprecated',
    'video_reels_publishing',
  ] as const;

  validatePayload(account: ConnectedSocialAccount, payload: PublishPayloadInput) {
    if (account.gbpAccessState && account.gbpAccessState !== 'connected' && account.gbpAccessState !== 'approved') {
      return {
        valid: false,
        code: 'APP_REVIEW_REQUIRED' as const,
        errors: [
          `Google Business Profile API access is currently "${account.gbpAccessState}". Complete GBP API access approval in Google Cloud before publishing local posts or replies.`,
        ],
      };
    }
    if (!this.supportedFormats.includes(payload.format)) {
      return {
        valid: false,
        code: 'CAPABILITY_UNSUPPORTED' as const,
        errors: [`Google Business Profile does not support format "${payload.format}".`],
      };
    }
    if (payload.caption.length > 1500) {
      return {
        valid: false,
        code: 'MEDIA_VALIDATION_FAILED' as const,
        errors: ['Google Business Profile local post summary exceeds 1500 characters.'],
      };
    }
    return { valid: true, errors: [] };
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
        errorCode: check.code || 'APP_REVIEW_REQUIRED',
        errorMessage: check.errors.join(' '),
        retryable: false,
      };
    }
    if (payload.dryRun) {
      return {
        status: 'dry_run_valid',
        rawSummary: `Validated GBP Local Post for location ${account.externalAccountId}.`,
      };
    }

    try {
      const res = await fetchImpl(
        `https://mybusiness.googleapis.com/v4/${account.externalAccountId}/localPosts`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            languageCode: 'en',
            summary: payload.caption.slice(0, 1500),
            topicType: 'STANDARD',
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        name?: string;
        searchUrl?: string;
        error?: { message?: string };
      };
      if (!res.ok || !json.name) {
        const err = classifyProviderHttpError(
          'google_business_profile',
          res.status,
          json.error?.message || 'GBP localPost creation failed.',
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
      return {
        status: 'published',
        externalPostId: json.name,
        externalPostUrl: json.searchUrl,
      };
    } catch (error) {
      const err = classifyProviderHttpError(
        'google_business_profile',
        0,
        error instanceof Error ? error.message : 'GBP request interrupted.',
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

  async reconcilePublishStatus(): Promise<ProviderReconcileResult> {
    return {
      reconciled: false,
      existsOnProvider: 'still_unknown',
      detail: 'Inspect Google Business Profile updates before retrying.',
    };
  }

  checkUnsupportedCapability(capabilityName: string) {
    if ((this.unsupportedCapabilities as readonly string[]).includes(capabilityName)) {
      return {
        supported: false,
        code: 'CAPABILITY_UNSUPPORTED' as const,
        reason: `Google Business Profile API does not support "${capabilityName}".`,
      };
    }
    return { supported: true };
  }
}

export async function publishGbpReviewReply(
  reviewResourceName: string,
  replyComment: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ replied: boolean; updateTime?: string }> {
  const res = await fetchImpl(
    `https://mybusiness.googleapis.com/v4/${reviewResourceName}/reply`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ comment: replyComment }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw classifyProviderHttpError('google_business_profile', res.status, text || 'GBP review reply failed.');
  }
  const json = (await res.json().catch(() => ({}))) as { updateTime?: string };
  return { replied: true, updateTime: json.updateTime };
}
