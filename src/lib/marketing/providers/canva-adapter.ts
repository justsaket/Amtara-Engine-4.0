import type { CanvaExportJobRecord, MediaAssetRecord } from '@/types/domain';
import { classifyProviderHttpError, Phase4ExecutionError } from '@/lib/marketing/errors';
import { buildWorkspaceStoragePath, computeSha256Hex, validateMediaAsset } from '@/lib/marketing/media-pipeline';

export const CANVA_REST_BASE = 'https://api.canva.com/rest/v1';

export const CANVA_REQUIRED_SCOPES = [
  'profile:read',
  'design:meta:read',
  'design:content:read',
  'design:content:write',
  'asset:read',
  'asset:write',
] as const;

export const CANVA_CAPABILITY_BOUNDARY = {
  connectRestApi: [
    'User/team profile discovery',
    'Design listing and metadata inspection',
    'Asset upload into Canva',
    'Design creation & brand template autofill (when enterprise autofill scope is granted)',
    'Async export job creation, bounded status polling, and download into Firebase Storage',
  ],
  contentPublisherAppsSdkBoundary:
    'Publishing directly inside Canva editor requires a separate Canva Apps SDK Content Publisher app. Antara integrates via Canva Connect REST APIs and persists exported files into Firebase Storage before publishing.',
};

export interface CanvaDesignSummary {
  id: string;
  title: string;
  editUrl?: string;
  viewUrl?: string;
  thumbnailUrl?: string;
  updatedAt?: string;
}

export async function listCanvaDesigns(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CanvaDesignSummary[]> {
  const res = await fetchImpl(`${CANVA_REST_BASE}/designs?ownership=owned&sort_by=modified_descending`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw classifyProviderHttpError('canva', res.status, text || 'Failed to list Canva designs.');
  }

  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      title?: string;
      urls?: { edit_url?: string; view_url?: string };
      thumbnail?: { url?: string };
      updated_at?: number;
    }>;
  };

  return (data.items || []).map((item) => ({
    id: item.id,
    title: item.title || 'Untitled Canva Design',
    editUrl: item.urls?.edit_url,
    viewUrl: item.urls?.view_url,
    thumbnailUrl: item.thumbnail?.url,
    updatedAt: item.updated_at ? new Date(item.updated_at * 1000).toISOString() : undefined,
  }));
}

export async function createCanvaDesignFromBrief(
  accessToken: string,
  params: { title: string; width: number; height: number },
  fetchImpl: typeof fetch = fetch,
): Promise<CanvaDesignSummary> {
  const res = await fetchImpl(`${CANVA_REST_BASE}/designs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      design_type: { type: 'custom', width: params.width, height: params.height },
      title: params.title,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw classifyProviderHttpError('canva', res.status, text || 'Failed to create Canva design.');
  }

  const data = (await res.json()) as {
    design?: {
      id: string;
      title?: string;
      urls?: { edit_url?: string; view_url?: string };
    };
  };

  if (!data.design?.id) {
    throw new Phase4ExecutionError({
      code: 'CANVA_EXPORT_FAILED',
      provider: 'canva',
      httpStatus: 502,
      retryable: false,
      reconciliationRequired: false,
      message: 'Canva API returned no design ID.',
      nextAction: 'Verify Canva OAuth scopes include design:content:write.',
    });
  }

  return {
    id: data.design.id,
    title: data.design.title || params.title,
    editUrl: data.design.urls?.edit_url,
    viewUrl: data.design.urls?.view_url,
  };
}

export interface CanvaAsyncExportResult {
  providerJobId: string;
  status: CanvaExportJobRecord['status'];
  downloadUrls: string[];
  errorMessage?: string;
}

export async function startAndPollCanvaExportJob(
  accessToken: string,
  params: {
    designId: string;
    format: 'png' | 'jpg' | 'pdf' | 'mp4';
    maxPolls?: number;
    pollIntervalMs?: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<CanvaAsyncExportResult> {
  const formatPayload =
    params.format === 'png'
      ? { type: 'png', export_quality: 'regular' }
      : params.format === 'jpg'
        ? { type: 'jpg', quality: 90 }
        : params.format === 'pdf'
          ? { type: 'pdf' }
          : { type: 'mp4', quality: 'horizontal_1080p' };

  const startRes = await fetchImpl(`${CANVA_REST_BASE}/exports`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      design_id: params.designId,
      format: formatPayload,
    }),
  });

  if (!startRes.ok) {
    const text = await startRes.text().catch(() => '');
    throw classifyProviderHttpError('canva', startRes.status, text || 'Canva export start failed.');
  }

  const startData = (await startRes.json()) as {
    job?: { id: string; status: string; urls?: string[]; error?: { message?: string } };
  };
  const jobId = startData.job?.id;
  if (!jobId) {
    throw new Phase4ExecutionError({
      code: 'CANVA_EXPORT_FAILED',
      provider: 'canva',
      httpStatus: 502,
      retryable: true,
      reconciliationRequired: false,
      message: 'Canva export job did not return a job ID.',
      nextAction: 'Retry export job creation.',
    });
  }

  let currentStatus = startData.job?.status || 'in_progress';
  let urls = startData.job?.urls || [];
  let errMsg = startData.job?.error?.message;

  const maxPolls = Math.min(Math.max(params.maxPolls ?? 5, 1), 10);
  const pollIntervalMs = Math.min(Math.max(params.pollIntervalMs ?? 0, 0), 2000);

  for (let attempt = 0; attempt < maxPolls && currentStatus === 'in_progress'; attempt += 1) {
    if (pollIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    const pollRes = await fetchImpl(`${CANVA_REST_BASE}/exports/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!pollRes.ok) {
      const text = await pollRes.text().catch(() => '');
      throw classifyProviderHttpError('canva', pollRes.status, text || 'Canva export poll failed.');
    }
    const pollData = (await pollRes.json()) as {
      job?: { status: string; urls?: string[]; error?: { message?: string } };
    };
    currentStatus = pollData.job?.status || 'failed';
    urls = pollData.job?.urls || [];
    errMsg = pollData.job?.error?.message;
  }

  if (currentStatus === 'success') {
    return { providerJobId: jobId, status: 'completed', downloadUrls: urls };
  }
  if (currentStatus === 'in_progress') {
    return { providerJobId: jobId, status: 'in_progress', downloadUrls: [] };
  }
  return {
    providerJobId: jobId,
    status: 'failed',
    downloadUrls: [],
    errorMessage: errMsg || 'Canva export job failed.',
  };
}

/**
 * Downloads a temporary Canva export URL before expiry and validates + prepares
 * a persisted Firebase Storage MediaAssetRecord (never relies on temporary Canva URLs for publishing).
 */
export async function downloadCanvaExportForStorage(params: {
  workspaceId: string;
  brandId?: string;
  assetId: string;
  designId: string;
  format: 'png' | 'jpg' | 'pdf' | 'mp4';
  temporaryDownloadUrl: string;
  createdBy: string;
  storageBucket?: string;
  persistBytes?: (storagePath: string, bytes: Buffer, contentType: string) => Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<{ asset: MediaAssetRecord; bytesDownloaded: number }> {
  const fetchFn = params.fetchImpl || fetch;
  const res = await fetchFn(params.temporaryDownloadUrl);

  if (res.status === 403 || res.status === 410) {
    throw new Phase4ExecutionError({
      code: 'CANVA_EXPORT_FAILED',
      provider: 'canva',
      httpStatus: res.status,
      retryable: true,
      reconciliationRequired: false,
      message: 'Temporary Canva export URL expired before download completed.',
      nextAction: 'Trigger a fresh Canva export job and immediately persist to Firebase Storage.',
    });
  }
  if (!res.ok) {
    throw new Phase4ExecutionError({
      code: 'CANVA_EXPORT_FAILED',
      provider: 'canva',
      httpStatus: res.status,
      retryable: true,
      reconciliationRequired: false,
      message: `Failed to download Canva export asset (HTTP ${res.status}).`,
      nextAction: 'Retry export download or inspect Canva export status.',
    });
  }

  const arrayBuf = await res.arrayBuffer();
  const bytes = Buffer.from(arrayBuf);
  if (bytes.length === 0) {
    throw new Phase4ExecutionError({
      code: 'MEDIA_VALIDATION_FAILED',
      provider: 'canva',
      httpStatus: 422,
      retryable: false,
      reconciliationRequired: false,
      message: 'Downloaded Canva export file was empty (0 bytes).',
      nextAction: 'Verify the Canva design has rendered pages before exporting.',
    });
  }

  const mimeMap = {
    png: 'image/png',
    jpg: 'image/jpeg',
    pdf: 'application/pdf',
    mp4: 'video/mp4',
  } as const;
  const mimeType = mimeMap[params.format];
  const fileName = `canva_${params.designId}.${params.format}`;
  const validation = validateMediaAsset({
    fileName,
    mimeType,
    sizeBytes: bytes.length,
  });

  const storagePath = buildWorkspaceStoragePath({
    workspaceId: params.workspaceId,
    brandId: params.brandId,
    assetId: params.assetId,
    fileName,
  });

  if (params.persistBytes) {
    try {
      await params.persistBytes(storagePath, bytes, mimeType);
    } catch (err) {
      throw new Phase4ExecutionError({
        code: 'CANVA_EXPORT_FAILED',
        provider: 'canva',
        httpStatus: 503,
        retryable: true,
        reconciliationRequired: false,
        message: `Storage persistence failed for Canva export: ${err instanceof Error ? err.message : 'unknown error'}`,
        nextAction: 'Verify Firebase Storage bucket configuration and retry export persistence.',
      });
    }
  }

  const now = new Date().toISOString();
  const asset: MediaAssetRecord = {
    id: params.assetId,
    schemaVersion: '4.0.0',
    workspaceId: params.workspaceId,
    brandId: params.brandId,
    fileName,
    mimeType,
    mediaKind: validation.mediaKind,
    sizeBytes: bytes.length,
    aspectRatio: validation.aspectRatio,
    sha256: computeSha256Hex(bytes),
    storageBucket: params.storageBucket,
    storagePath,
    source: 'canva_export',
    processingState: validation.valid ? 'validated' : 'rejected',
    validationErrors: validation.errors,
    compatiblePlatforms: validation.compatiblePlatforms,
    createdBy: params.createdBy,
    createdAt: now,
    updatedAt: now,
  };

  return { asset, bytesDownloaded: bytes.length };
}
