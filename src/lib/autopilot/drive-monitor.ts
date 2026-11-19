import crypto from 'node:crypto';
import { AppError } from '@/lib/server/error-handler';
import type { FetchLike } from '@/lib/google/oauth';
import { classifyDriveApiError } from '@/lib/google/drive-client';
import type {
  AutopilotDriveFileRecord,
  AutopilotPolicy,
  AutopilotVideoTechnicalMetadata,
  DriveFolderItem,
} from '@/types/autopilot';

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_CHANGES_API = 'https://www.googleapis.com/drive/v3/changes';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

export const SUPPORTED_AUTOPILOT_VIDEO_MIMES = new Set<string>([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'video/mpeg',
]);

/** Maximum file size eligible for direct server-side retrieval & analysis (500 MB). */
export const MAX_AUTOPILOT_VIDEO_BYTES = 500 * 1024 * 1024;
/** Maximum inline multimodal upload byte size (20 MB direct inline; larger videos require frame/audio extraction). */
export const MAX_INLINE_MULTIMODAL_BYTES = 20 * 1024 * 1024;

export interface RawDriveFileNode {
  id: string;
  name: string;
  mimeType: string;
  size?: string | number;
  md5Checksum?: string;
  modifiedTime?: string;
  createdTime?: string;
  parents?: string[];
  trashed?: boolean;
  webViewLink?: string;
  capabilities?: {
    canDownload?: boolean;
    canListChildren?: boolean;
    canReadRevisions?: boolean;
  };
  videoMediaMetadata?: {
    width?: number;
    height?: number;
    durationMillis?: string | number;
  };
}

export interface DriveScanResult {
  folder: DriveFolderItem;
  files: Array<RawDriveFileNode & { folderPath: string; parentFolderId: string }>;
  subfoldersTraversed: number;
  warnings: string[];
}

export interface DriveReconciliationDiff {
  newFiles: AutopilotDriveFileRecord[];
  modifiedFiles: AutopilotDriveFileRecord[];
  movedFiles: AutopilotDriveFileRecord[];
  deletedFiles: AutopilotDriveFileRecord[];
  duplicateFiles: AutopilotDriveFileRecord[];
  unsupportedFiles: AutopilotDriveFileRecord[];
  inaccessibleFiles: AutopilotDriveFileRecord[];
  unchangedCount: number;
  allUpdatedRecords: AutopilotDriveFileRecord[];
}

function escapeDriveLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function extractVideoMetadataFromDriveNode(
  node: RawDriveFileNode,
): AutopilotVideoTechnicalMetadata {
  const width =
    typeof node.videoMediaMetadata?.width === 'number' && node.videoMediaMetadata.width > 0
      ? node.videoMediaMetadata.width
      : null;
  const height =
    typeof node.videoMediaMetadata?.height === 'number' && node.videoMediaMetadata.height > 0
      ? node.videoMediaMetadata.height
      : null;
  const durationMs = Number(node.videoMediaMetadata?.durationMillis || 0);
  const durationSeconds =
    Number.isFinite(durationMs) && durationMs > 0 ? Number((durationMs / 1000).toFixed(2)) : null;

  let aspectRatio: string | null = null;
  let orientation: AutopilotVideoTechnicalMetadata['orientation'] = 'unknown';

  if (width && height) {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const d = gcd(width, height);
    aspectRatio = `${Math.round(width / d)}:${Math.round(height / d)}`;
    const ratio = width / height;
    if (Math.abs(ratio - 1) <= 0.08) orientation = 'square';
    else if (ratio < 1) orientation = 'vertical';
    else orientation = 'horizontal';
  }

  return {
    durationSeconds,
    width,
    height,
    aspectRatio,
    fps: null,
    codec: null,
    hasAudio: null,
    orientation,
  };
}

export async function verifyDriveFolderAccess(params: {
  accessToken: string;
  folderId: string;
  fetchImpl?: FetchLike;
}): Promise<DriveFolderItem> {
  const fetcher = params.fetchImpl || fetch;
  const url = new URL(`${DRIVE_FILES_API}/${encodeURIComponent(params.folderId.trim())}`);
  url.searchParams.set(
    'fields',
    'id,name,mimeType,modifiedTime,webViewLink,parents,trashed,capabilities(canListChildren)',
  );
  url.searchParams.set('supportsAllDrives', 'true');

  const res = await fetcher(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    },
  });

  const bodyText = await res.text();
  if (!res.ok) {
    const classified = classifyDriveApiError(res.status, bodyText);
    throw new AppError(classified.statusCode, classified.code, classified.message);
  }

  const parsed = JSON.parse(bodyText) as RawDriveFileNode;
  if (parsed.trashed) {
    throw new AppError(400, 'DRIVE_FOLDER_TRASHED', 'The selected Google Drive folder is in Trash.');
  }
  if (parsed.mimeType !== DRIVE_FOLDER_MIME) {
    throw new AppError(
      400,
      'DRIVE_NOT_A_FOLDER',
      `Drive item "${parsed.name}" is not a folder (mimeType: ${parsed.mimeType}).`,
    );
  }

  return {
    id: parsed.id,
    name: parsed.name,
    modifiedTime: parsed.modifiedTime,
    webViewLink: parsed.webViewLink,
    parents: parsed.parents,
    canListChildren: parsed.capabilities?.canListChildren !== false,
  };
}

export async function listDriveFolders(params: {
  accessToken: string;
  query?: string;
  parentFolderId?: string;
  pageSize?: number;
  fetchImpl?: FetchLike;
}): Promise<DriveFolderItem[]> {
  const fetcher = params.fetchImpl || fetch;
  const qParts = [`mimeType = '${DRIVE_FOLDER_MIME}'`, 'trashed = false'];
  if (params.parentFolderId) {
    qParts.push(`'${escapeDriveLiteral(params.parentFolderId)}' in parents`);
  }
  if (params.query?.trim()) {
    qParts.push(`name contains '${escapeDriveLiteral(params.query.trim())}'`);
  }

  const url = new URL(DRIVE_FILES_API);
  url.searchParams.set('q', qParts.join(' and '));
  url.searchParams.set(
    'fields',
    'files(id,name,mimeType,modifiedTime,webViewLink,parents,capabilities(canListChildren))',
  );
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', String(Math.min(Math.max(params.pageSize || 30, 1), 100)));
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');

  const res = await fetcher(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    },
  });

  const bodyText = await res.text();
  if (!res.ok) {
    const classified = classifyDriveApiError(res.status, bodyText);
    throw new AppError(classified.statusCode, classified.code, classified.message);
  }

  const parsed = JSON.parse(bodyText) as { files?: RawDriveFileNode[] };
  return (parsed.files || [])
    .filter((f) => f.mimeType === DRIVE_FOLDER_MIME)
    .map((f) => ({
      id: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink,
      parents: f.parents,
      canListChildren: f.capabilities?.canListChildren !== false,
    }));
}

export async function scanDriveFolderRecursive(params: {
  accessToken: string;
  folderId: string;
  includeSubfolders: boolean;
  maxSubfolderDepth?: number;
  maxFoldersToVisit?: number;
  fetchImpl?: FetchLike;
}): Promise<DriveScanResult> {
  const fetcher = params.fetchImpl || fetch;
  const maxDepth = Math.min(Math.max(params.maxSubfolderDepth ?? 3, 0), 6);
  const maxFolders = Math.min(Math.max(params.maxFoldersToVisit ?? 40, 1), 100);

  const rootFolder = await verifyDriveFolderAccess({
    accessToken: params.accessToken,
    folderId: params.folderId,
    fetchImpl: fetcher,
  });

  const warnings: string[] = [];
  if (!rootFolder.canListChildren) {
    throw new AppError(
      403,
      'DRIVE_FOLDER_INACCESSIBLE',
      `Connected Google account does not have read/list permission for folder "${rootFolder.name}".`,
    );
  }

  const queue: Array<{ id: string; path: string; depth: number }> = [
    { id: rootFolder.id, path: `/${rootFolder.name}`, depth: 0 },
  ];
  const visited = new Set<string>([rootFolder.id]);
  const collected: Array<RawDriveFileNode & { folderPath: string; parentFolderId: string }> = [];
  let subfoldersTraversed = 0;

  while (queue.length > 0 && visited.size <= maxFolders) {
    const current = queue.shift()!;
    let pageToken: string | undefined;
    let pages = 0;

    do {
      pages += 1;
      const url = new URL(DRIVE_FILES_API);
      url.searchParams.set('q', `'${escapeDriveLiteral(current.id)}' in parents`);
      url.searchParams.set(
        'fields',
        'nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime,createdTime,parents,trashed,webViewLink,capabilities(canDownload,canListChildren),videoMediaMetadata(width,height,durationMillis))',
      );
      url.searchParams.set('orderBy', 'createdTime asc');
      url.searchParams.set('pageSize', '100');
      url.searchParams.set('supportsAllDrives', 'true');
      url.searchParams.set('includeItemsFromAllDrives', 'true');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await fetcher(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          Accept: 'application/json',
        },
      });
      const rawText = await res.text();
      if (!res.ok) {
        if (current.depth > 0 && (res.status === 403 || res.status === 404)) {
          warnings.push(`Skipped inaccessible subfolder ${current.path} (HTTP ${res.status}).`);
          break;
        }
        const classified = classifyDriveApiError(res.status, rawText);
        throw new AppError(classified.statusCode, classified.code, classified.message);
      }

      const parsed = JSON.parse(rawText) as {
        nextPageToken?: string;
        files?: RawDriveFileNode[];
      };

      for (const node of parsed.files || []) {
        if (node.mimeType === DRIVE_FOLDER_MIME) {
          if (
            params.includeSubfolders &&
            !node.trashed &&
            current.depth < maxDepth &&
            !visited.has(node.id)
          ) {
            if (visited.size < maxFolders) {
              visited.add(node.id);
              subfoldersTraversed += 1;
              queue.push({
                id: node.id,
                path: `${current.path}/${node.name}`,
                depth: current.depth + 1,
              });
            } else {
              warnings.push(`Subfolder traversal cap (${maxFolders}) reached at ${current.path}/${node.name}.`);
            }
          }
          continue;
        }

        collected.push({
          ...node,
          folderPath: current.path,
          parentFolderId: current.id,
        });
      }

      pageToken = parsed.nextPageToken;
    } while (pageToken && pages < 10);
  }

  return {
    folder: rootFolder,
    files: collected,
    subfoldersTraversed,
    warnings,
  };
}

export async function getDriveStartPageToken(params: {
  accessToken: string;
  fetchImpl?: FetchLike;
}): Promise<string> {
  const fetcher = params.fetchImpl || fetch;
  const url = new URL(`${DRIVE_CHANGES_API}/startPageToken`);
  url.searchParams.set('supportsAllDrives', 'true');
  const res = await fetcher(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${params.accessToken}`, Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) {
    const classified = classifyDriveApiError(res.status, text);
    throw new AppError(classified.statusCode, classified.code, classified.message);
  }
  const parsed = JSON.parse(text) as { startPageToken?: string };
  if (!parsed.startPageToken) {
    throw new AppError(502, 'DRIVE_TOKEN_MISSING', 'Google Drive did not return a startPageToken.');
  }
  return parsed.startPageToken;
}

export async function registerDriveChangesWatch(params: {
  accessToken: string;
  pageToken: string;
  webhookAddress: string;
  channelId: string;
  channelToken: string;
  ttlSeconds?: number;
  fetchImpl?: FetchLike;
}): Promise<{ channelId: string; resourceId: string; expirationIso: string }> {
  const fetcher = params.fetchImpl || fetch;
  const url = new URL(`${DRIVE_CHANGES_API}/watch`);
  url.searchParams.set('pageToken', params.pageToken);
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');

  const expirationMs = Date.now() + Math.min(Math.max(params.ttlSeconds ?? 86_400, 300), 604_800) * 1000;
  const res = await fetcher(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: params.channelId,
      type: 'web_hook',
      address: params.webhookAddress,
      token: params.channelToken,
      expiration: String(expirationMs),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    const classified = classifyDriveApiError(res.status, text);
    throw new AppError(classified.statusCode, classified.code, classified.message);
  }
  const parsed = JSON.parse(text) as { id?: string; resourceId?: string; expiration?: string };
  return {
    channelId: parsed.id || params.channelId,
    resourceId: parsed.resourceId || '',
    expirationIso: parsed.expiration
      ? new Date(Number(parsed.expiration)).toISOString()
      : new Date(expirationMs).toISOString(),
  };
}

export async function fetchDriveChangesPage(params: {
  accessToken: string;
  pageToken: string;
  fetchImpl?: FetchLike;
}): Promise<{
  changes: Array<{ fileId: string; removed?: boolean; file?: RawDriveFileNode }>;
  nextPageToken?: string;
  newStartPageToken?: string;
}> {
  const fetcher = params.fetchImpl || fetch;
  const url = new URL(DRIVE_CHANGES_API);
  url.searchParams.set('pageToken', params.pageToken);
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');
  url.searchParams.set(
    'fields',
    'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,size,md5Checksum,modifiedTime,createdTime,parents,trashed,webViewLink,capabilities(canDownload),videoMediaMetadata(width,height,durationMillis)))',
  );
  const res = await fetcher(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${params.accessToken}`, Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) {
    const classified = classifyDriveApiError(res.status, text);
    throw new AppError(classified.statusCode, classified.code, classified.message);
  }
  const parsed = JSON.parse(text) as {
    changes?: Array<{ fileId: string; removed?: boolean; file?: RawDriveFileNode }>;
    nextPageToken?: string;
    newStartPageToken?: string;
  };
  return {
    changes: parsed.changes || [],
    nextPageToken: parsed.nextPageToken,
    newStartPageToken: parsed.newStartPageToken,
  };
}

export async function downloadDriveMediaBytes(params: {
  accessToken: string;
  driveFileId: string;
  maxBytes?: number;
  fetchImpl?: FetchLike;
}): Promise<{ bytes: Buffer; sha256: string; mimeType: string; sizeBytes: number }> {
  const fetcher = params.fetchImpl || fetch;
  const cap = params.maxBytes ?? MAX_AUTOPILOT_VIDEO_BYTES;
  const url = `${DRIVE_FILES_API}/${encodeURIComponent(params.driveFileId)}?alt=media&supportsAllDrives=true`;

  const res = await fetcher(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });

  if (!res.ok) {
    const bodyText = await res.text();
    const classified = classifyDriveApiError(res.status, bodyText);
    throw new AppError(classified.statusCode, classified.code, classified.message);
  }

  const contentLength = Number(res.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > cap) {
    throw new AppError(
      413,
      'DRIVE_MEDIA_TOO_LARGE',
      `Drive media exceeds allowed autopilot processing limit (${Math.round(cap / (1024 * 1024))} MB).`,
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (bytes.byteLength > cap) {
    throw new AppError(
      413,
      'DRIVE_MEDIA_TOO_LARGE',
      `Downloaded Drive media (${bytes.byteLength} bytes) exceeds size cap.`,
    );
  }

  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return {
    bytes,
    sha256,
    mimeType: res.headers.get('content-type') || 'video/mp4',
    sizeBytes: bytes.byteLength,
  };
}

/**
 * Pure, deterministic Drive registry reconciliation.
 * Detects new videos, modified files, moved files, deleted/trashed files,
 * duplicates (by Drive file ID and content hash), unsupported formats, and inaccessible files.
 * Never reprocesses an unchanged video unless explicitly requested via `reprocessRequestedAt`.
 */
export function reconcileDriveSnapshot(params: {
  policy: AutopilotPolicy;
  existingRegistry: AutopilotDriveFileRecord[];
  scannedNodes: Array<RawDriveFileNode & { folderPath: string; parentFolderId: string }>;
  nowIso?: string;
}): DriveReconciliationDiff {
  const nowIso = params.nowIso || new Date().toISOString();
  const existingByDriveId = new Map<string, AutopilotDriveFileRecord>();
  const canonicalByHash = new Map<string, AutopilotDriveFileRecord>();

  for (const rec of params.existingRegistry) {
    if (rec.policyId !== params.policy.id) continue;
    existingByDriveId.set(rec.driveFileId, rec);
    const hashKey = rec.contentSha256 || rec.md5Checksum;
    if (
      hashKey &&
      rec.status !== 'deleted' &&
      rec.status !== 'duplicate_skipped' &&
      !canonicalByHash.has(hashKey)
    ) {
      canonicalByHash.set(hashKey, rec);
    }
  }

  const newFiles: AutopilotDriveFileRecord[] = [];
  const modifiedFiles: AutopilotDriveFileRecord[] = [];
  const movedFiles: AutopilotDriveFileRecord[] = [];
  const deletedFiles: AutopilotDriveFileRecord[] = [];
  const duplicateFiles: AutopilotDriveFileRecord[] = [];
  const unsupportedFiles: AutopilotDriveFileRecord[] = [];
  const inaccessibleFiles: AutopilotDriveFileRecord[] = [];
  const allUpdatedRecords: AutopilotDriveFileRecord[] = [];
  let unchangedCount = 0;

  const seenDriveIds = new Set<string>();

  for (const node of params.scannedNodes) {
    seenDriveIds.add(node.id);
    const sizeBytes = Number(node.size || 0);
    const modifiedTime = node.modifiedTime || nowIso;
    const readable = node.capabilities?.canDownload !== false;
    const isSupportedVideo = SUPPORTED_AUTOPILOT_VIDEO_MIMES.has(node.mimeType);
    const videoMeta = extractVideoMetadataFromDriveNode(node);

    const existing = existingByDriveId.get(node.id);

    // Handle trashed files cleanly
    if (node.trashed) {
      if (existing && existing.status !== 'deleted') {
        const updated: AutopilotDriveFileRecord = {
          ...existing,
          trashed: true,
          status: 'deleted',
          updatedAt: nowIso,
        };
        deletedFiles.push(updated);
        allUpdatedRecords.push(updated);
      }
      continue;
    }

    if (existing) {
      // Check if explicit reprocess was requested by user
      if (
        existing.reprocessRequestedAt &&
        params.policy.duplicatePrevention.allowExplicitReprocess
      ) {
        const updated: AutopilotDriveFileRecord = {
          ...existing,
          name: node.name,
          sizeBytes,
          md5Checksum: node.md5Checksum || existing.md5Checksum,
          driveModifiedTime: modifiedTime,
          parentFolderId: node.parentFolderId,
          folderPath: node.folderPath,
          videoMetadata: videoMeta,
          status: 'discovered',
          reprocessRequestedAt: undefined,
          updatedAt: nowIso,
        };
        modifiedFiles.push(updated);
        allUpdatedRecords.push(updated);
        continue;
      }

      // Check moved (different parent folder / path)
      const moved =
        existing.parentFolderId !== node.parentFolderId || existing.folderPath !== node.folderPath;

      // Check content modification (hash changed or modifiedTime advanced + size changed)
      const hashChanged =
        Boolean(node.md5Checksum) &&
        Boolean(existing.md5Checksum) &&
        node.md5Checksum !== existing.md5Checksum;
      const modified = hashChanged || (existing.driveModifiedTime !== modifiedTime && existing.sizeBytes !== sizeBytes);

      if (modified) {
        const updated: AutopilotDriveFileRecord = {
          ...existing,
          name: node.name,
          sizeBytes,
          md5Checksum: node.md5Checksum || existing.md5Checksum,
          contentSha256: hashChanged ? undefined : existing.contentSha256,
          driveModifiedTime: modifiedTime,
          parentFolderId: node.parentFolderId,
          folderPath: node.folderPath,
          videoMetadata: videoMeta,
          status: !readable
            ? 'inaccessible'
            : !isSupportedVideo || sizeBytes > MAX_AUTOPILOT_VIDEO_BYTES
              ? 'unsupported'
              : 'discovered',
          lastErrorCode: undefined,
          lastErrorMessage: undefined,
          updatedAt: nowIso,
        };
        modifiedFiles.push(updated);
        allUpdatedRecords.push(updated);
      } else if (moved) {
        const updated: AutopilotDriveFileRecord = {
          ...existing,
          name: node.name,
          parentFolderId: node.parentFolderId,
          folderPath: node.folderPath,
          driveModifiedTime: modifiedTime,
          updatedAt: nowIso,
        };
        movedFiles.push(updated);
        allUpdatedRecords.push(updated);
      } else {
        // Unchanged existing Drive file ID -> NEVER process twice!
        unchangedCount += 1;
      }
      continue;
    }

    // New file discovered!
    const fileRecordId = `apf_${crypto.createHash('sha256').update(`${params.policy.id}:${node.id}`).digest('hex').slice(0, 18)}`;

    if (!readable) {
      const rec: AutopilotDriveFileRecord = {
        id: fileRecordId,
        schemaVersion: '5.1.0',
        workspaceId: params.policy.workspaceId,
        policyId: params.policy.id,
        brandId: params.policy.brandId,
        driveFileId: node.id,
        name: node.name,
        mimeType: node.mimeType,
        sizeBytes,
        md5Checksum: node.md5Checksum,
        driveModifiedTime: modifiedTime,
        driveCreatedTime: node.createdTime,
        parentFolderId: node.parentFolderId,
        folderPath: node.folderPath,
        webViewLink: node.webViewLink,
        trashed: false,
        permissionsReadable: false,
        priority: 0,
        status: 'inaccessible',
        videoMetadata: videoMeta,
        analysis: null,
        generatedMetadata: null,
        scheduledJobIds: [],
        estimatedProcessingCostUsd: null,
        actualProcessingCostUsd: null,
        lastErrorCode: 'DRIVE_FILE_INACCESSIBLE',
        lastErrorMessage: 'Drive file download/read permission is denied for the connected Google account.',
        discoveredAt: nowIso,
        updatedAt: nowIso,
      };
      inaccessibleFiles.push(rec);
      allUpdatedRecords.push(rec);
      continue;
    }

    if (!isSupportedVideo || sizeBytes > MAX_AUTOPILOT_VIDEO_BYTES) {
      const rec: AutopilotDriveFileRecord = {
        id: fileRecordId,
        schemaVersion: '5.1.0',
        workspaceId: params.policy.workspaceId,
        policyId: params.policy.id,
        brandId: params.policy.brandId,
        driveFileId: node.id,
        name: node.name,
        mimeType: node.mimeType,
        sizeBytes,
        md5Checksum: node.md5Checksum,
        driveModifiedTime: modifiedTime,
        driveCreatedTime: node.createdTime,
        parentFolderId: node.parentFolderId,
        folderPath: node.folderPath,
        webViewLink: node.webViewLink,
        trashed: false,
        permissionsReadable: true,
        priority: 0,
        status: 'unsupported',
        videoMetadata: videoMeta,
        analysis: null,
        generatedMetadata: null,
        scheduledJobIds: [],
        estimatedProcessingCostUsd: null,
        actualProcessingCostUsd: null,
        lastErrorCode: sizeBytes > MAX_AUTOPILOT_VIDEO_BYTES ? 'VIDEO_EXCEEDS_MAX_SIZE' : 'UNSUPPORTED_MEDIA_TYPE',
        lastErrorMessage:
          sizeBytes > MAX_AUTOPILOT_VIDEO_BYTES
            ? `File exceeds maximum supported size (${Math.round(MAX_AUTOPILOT_VIDEO_BYTES / (1024 * 1024))} MB).`
            : `MIME type "${node.mimeType}" is not a supported autopilot video format.`,
        discoveredAt: nowIso,
        updatedAt: nowIso,
      };
      unsupportedFiles.push(rec);
      allUpdatedRecords.push(rec);
      continue;
    }

    // Duplicate detection by content hash (MD5 from Google Drive or SHA-256)
    const hashMatch =
      params.policy.duplicatePrevention.byContentHash && node.md5Checksum
        ? canonicalByHash.get(node.md5Checksum)
        : undefined;

    if (hashMatch) {
      const rec: AutopilotDriveFileRecord = {
        id: fileRecordId,
        schemaVersion: '5.1.0',
        workspaceId: params.policy.workspaceId,
        policyId: params.policy.id,
        brandId: params.policy.brandId,
        driveFileId: node.id,
        name: node.name,
        mimeType: node.mimeType,
        sizeBytes,
        md5Checksum: node.md5Checksum,
        driveModifiedTime: modifiedTime,
        driveCreatedTime: node.createdTime,
        parentFolderId: node.parentFolderId,
        folderPath: node.folderPath,
        webViewLink: node.webViewLink,
        trashed: false,
        permissionsReadable: true,
        priority: 0,
        status: 'duplicate_skipped',
        duplicateOfFileId: hashMatch.id,
        videoMetadata: videoMeta,
        analysis: null,
        generatedMetadata: null,
        scheduledJobIds: [],
        estimatedProcessingCostUsd: null,
        actualProcessingCostUsd: null,
        lastErrorCode: 'DUPLICATE_CONTENT_HASH',
        lastErrorMessage: `Skipped duplicate video matching existing Drive file "${hashMatch.name}" (${hashMatch.driveFileId}).`,
        discoveredAt: nowIso,
        updatedAt: nowIso,
      };
      duplicateFiles.push(rec);
      allUpdatedRecords.push(rec);
      continue;
    }

    const created: AutopilotDriveFileRecord = {
      id: fileRecordId,
      schemaVersion: '5.1.0',
      workspaceId: params.policy.workspaceId,
      policyId: params.policy.id,
      brandId: params.policy.brandId,
      driveFileId: node.id,
      name: node.name,
      mimeType: node.mimeType,
      sizeBytes,
      md5Checksum: node.md5Checksum,
      driveModifiedTime: modifiedTime,
      driveCreatedTime: node.createdTime,
      parentFolderId: node.parentFolderId,
      folderPath: node.folderPath,
      webViewLink: node.webViewLink,
      trashed: false,
      permissionsReadable: true,
      priority: 0,
      status: 'discovered',
      videoMetadata: videoMeta,
      analysis: null,
      generatedMetadata: null,
      scheduledJobIds: [],
      estimatedProcessingCostUsd: null,
      actualProcessingCostUsd: null,
      discoveredAt: nowIso,
      updatedAt: nowIso,
    };
    if (node.md5Checksum) {
      canonicalByHash.set(node.md5Checksum, created);
    }
    newFiles.push(created);
    allUpdatedRecords.push(created);
  }

  // Detect files previously tracked in this folder that were deleted/removed from the folder
  for (const existing of params.existingRegistry) {
    if (existing.policyId !== params.policy.id) continue;
    if (!seenDriveIds.has(existing.driveFileId) && existing.status !== 'deleted') {
      const updated: AutopilotDriveFileRecord = {
        ...existing,
        trashed: true,
        status: 'deleted',
        updatedAt: nowIso,
      };
      deletedFiles.push(updated);
      allUpdatedRecords.push(updated);
    }
  }

  return {
    newFiles,
    modifiedFiles,
    movedFiles,
    deletedFiles,
    duplicateFiles,
    unsupportedFiles,
    inaccessibleFiles,
    unchangedCount,
    allUpdatedRecords,
  };
}
