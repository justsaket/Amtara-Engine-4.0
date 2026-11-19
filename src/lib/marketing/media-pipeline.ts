import crypto from 'node:crypto';
import type { MediaAssetRecord, SocialPlatformId } from '@/types/domain';

export interface MediaValidationInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface MediaValidationOutcome {
  valid: boolean;
  mediaKind: 'image' | 'video' | 'document';
  aspectRatio?: string;
  errors: string[];
  compatiblePlatforms: SocialPlatformId[];
  requiresResumableUpload: boolean;
}

const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const ALLOWED_DOC_MIME = new Set(['application/pdf']);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_BYTES = 512 * 1024 * 1024; // 512 MB (resumable above 10 MB)
const MAX_DOC_BYTES = 50 * 1024 * 1024; // 50 MB
const RESUMABLE_THRESHOLD_BYTES = 10 * 1024 * 1024;

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function formatAspectRatio(width?: number, height?: number): string | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  const divisor = gcd(width, height);
  const w = Math.round(width / divisor);
  const h = Math.round(height / divisor);
  if (w > 20 || h > 20) {
    const ratio = width / height;
    return `${ratio.toFixed(2)}:1`;
  }
  return `${w}:${h}`;
}

export function computeSha256Hex(bufferOrString: Buffer | string): string {
  return crypto.createHash('sha256').update(bufferOrString).digest('hex');
}

export function buildWorkspaceStoragePath(params: {
  workspaceId: string;
  brandId?: string;
  assetId: string;
  fileName: string;
}): string {
  const safeName = params.fileName
    .trim()
    .replace(/\.\.+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[._-]+/, '')
    .slice(0, 100);
  const scope = params.brandId ? `brands/${params.brandId}` : 'shared';
  return `workspaces/${params.workspaceId}/media/${scope}/${params.assetId}_${safeName || 'asset.bin'}`;
}

export function validateMediaAsset(input: MediaValidationInput): MediaValidationOutcome {
  const errors: string[] = [];
  const mime = input.mimeType.trim().toLowerCase();

  let mediaKind: 'image' | 'video' | 'document' = 'image';
  if (ALLOWED_IMAGE_MIME.has(mime)) {
    mediaKind = 'image';
  } else if (ALLOWED_VIDEO_MIME.has(mime)) {
    mediaKind = 'video';
  } else if (ALLOWED_DOC_MIME.has(mime)) {
    mediaKind = 'document';
  } else {
    errors.push(
      `Unsupported MIME type "${input.mimeType}". Allowed: JPEG, PNG, WebP, MP4, MOV, WebM, PDF.`,
    );
  }

  if (input.sizeBytes <= 0) {
    errors.push('File size must be greater than 0 bytes.');
  }

  if (mediaKind === 'image' && input.sizeBytes > MAX_IMAGE_BYTES) {
    errors.push(
      `Image size (${(input.sizeBytes / (1024 * 1024)).toFixed(1)} MB) exceeds maximum 10 MB limit.`,
    );
  }
  if (mediaKind === 'video' && input.sizeBytes > MAX_VIDEO_BYTES) {
    errors.push(
      `Video size (${(input.sizeBytes / (1024 * 1024)).toFixed(1)} MB) exceeds maximum 512 MB limit.`,
    );
  }
  if (mediaKind === 'document' && input.sizeBytes > MAX_DOC_BYTES) {
    errors.push(
      `Document size (${(input.sizeBytes / (1024 * 1024)).toFixed(1)} MB) exceeds maximum 50 MB limit.`,
    );
  }

  if (mediaKind === 'image' && input.width && input.height) {
    if (input.width < 320 || input.height < 320) {
      errors.push(`Image resolution (${input.width}x${input.height}) is below minimum 320x320px.`);
    }
  }

  if (mediaKind === 'video') {
    if (input.durationSeconds !== undefined && input.durationSeconds <= 0) {
      errors.push('Video duration must be greater than 0 seconds.');
    }
    if (input.width && input.height && (input.width < 360 || input.height < 360)) {
      errors.push(`Video resolution (${input.width}x${input.height}) is below minimum 360px dimension.`);
    }
  }

  const aspectRatio = formatAspectRatio(input.width, input.height);
  const compatiblePlatforms: SocialPlatformId[] = [];

  if (errors.length === 0) {
    const ratio = input.width && input.height ? input.width / input.height : null;

    if (mediaKind === 'image') {
      // Instagram requires JPEG/PNG and aspect ratio between 4:5 (0.8) and 1.91:1 (1.91)
      const igRatioOk = ratio === null || (ratio >= 0.8 && ratio <= 1.92);
      if ((mime === 'image/jpeg' || mime === 'image/png') && input.sizeBytes <= 8 * 1024 * 1024 && igRatioOk) {
        compatiblePlatforms.push('instagram');
      }
      compatiblePlatforms.push('facebook', 'linkedin', 'google_business_profile');
    } else if (mediaKind === 'video') {
      if (mime === 'video/mp4' || mime === 'video/quicktime') {
        if ((input.durationSeconds || 30) <= 900 && input.sizeBytes <= 300 * 1024 * 1024) {
          compatiblePlatforms.push('instagram');
        }
        if ((input.durationSeconds || 30) <= 600) {
          compatiblePlatforms.push('tiktok');
        }
      }
      compatiblePlatforms.push('facebook', 'youtube', 'linkedin');
    } else if (mediaKind === 'document') {
      compatiblePlatforms.push('linkedin');
    }
  }

  return {
    valid: errors.length === 0,
    mediaKind,
    aspectRatio,
    errors,
    compatiblePlatforms,
    requiresResumableUpload: input.sizeBytes > RESUMABLE_THRESHOLD_BYTES,
  };
}

export function findDuplicateMediaAsset(
  existingAssets: MediaAssetRecord[],
  sha256: string,
): MediaAssetRecord | undefined {
  const normalized = sha256.trim().toLowerCase();
  return existingAssets.find((asset) => asset.sha256.toLowerCase() === normalized);
}

export function checkMediaCompatibilityForPlatform(
  asset: MediaAssetRecord,
  platform: SocialPlatformId,
): { compatible: boolean; reason?: string } {
  if (asset.processingState !== 'validated') {
    return {
      compatible: false,
      reason: `Asset "${asset.fileName}" is in state "${asset.processingState}" and not validated for publishing.`,
    };
  }
  if (!asset.compatiblePlatforms.includes(platform)) {
    return {
      compatible: false,
      reason: `Asset "${asset.fileName}" (${asset.mimeType}, ${asset.aspectRatio || 'unknown ratio'}) is not compatible with ${platform}.`,
    };
  }
  return { compatible: true };
}
