import { AppError } from '@/lib/server/error-handler';
import type { FetchLike } from './oauth';

export interface DiscoveredAppsScriptFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  createdTime?: string;
  owners: Array<{ displayName?: string; emailAddress?: string }>;
  webViewLink?: string;
  canEdit?: boolean;
  parents?: string[];
}

export interface DriveDiscoveryResult {
  files: DiscoveredAppsScriptFile[];
  nextPageToken?: string;
}

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const APPS_SCRIPT_MIME = 'application/vnd.google-apps.script';

function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function classifyDriveApiError(
  status: number,
  bodyText: string,
): { code: string; message: string; statusCode: number } {
  const lower = bodyText.toLowerCase();

  if (status === 401) {
    return {
      statusCode: 401,
      code: 'GOOGLE_REAUTH_REQUIRED',
      message: 'Google OAuth token expired or invalid while listing Drive Apps Script files.',
    };
  }

  if (
    status === 403 &&
    (lower.includes('drive.googleapis.com') ||
      lower.includes('accessnotconfigured') ||
      lower.includes('has not been used in project') ||
      lower.includes('api is not enabled'))
  ) {
    return {
      statusCode: 403,
      code: 'DRIVE_API_NOT_ENABLED',
      message:
        'Google Drive API (drive.googleapis.com) is not enabled in the configured Google Cloud project.',
    };
  }

  if (
    status === 403 &&
    (lower.includes('insufficient') ||
      lower.includes('scope') ||
      lower.includes('insufficientpermissions'))
  ) {
    return {
      statusCode: 403,
      code: 'DRIVE_DISCOVERY_NOT_AUTHORIZED',
      message:
        'Drive metadata discovery scope (drive.metadata.readonly) has not been granted. Use incremental authorization to enable discovery.',
    };
  }

  if (status === 429 || lower.includes('ratelimitexceeded') || lower.includes('userratelimitexceeded')) {
    return {
      statusCode: 429,
      code: 'QUOTA_LIMITED',
      message: 'Google Drive API rate limit reached. Retry after a short interval.',
    };
  }

  return {
    statusCode: status >= 400 && status < 500 ? status : 502,
    code: 'DRIVE_PROVIDER_ERROR',
    message: `Google Drive API request failed (${status}).`,
  };
}

export async function discoverAppsScriptProjects(params: {
  accessToken: string;
  query?: string;
  pageToken?: string;
  pageSize?: number;
  fetchImpl?: FetchLike;
}): Promise<DriveDiscoveryResult> {
  const fetcher = params.fetchImpl || fetch;

  const queryParts = [
    `mimeType = '${APPS_SCRIPT_MIME}'`,
    'trashed = false',
  ];

  const search = params.query?.trim();
  if (search) {
    queryParts.push(`name contains '${escapeDriveQueryLiteral(search)}'`);
  }

  const url = new URL(DRIVE_FILES_API);
  url.searchParams.set('q', queryParts.join(' and '));
  url.searchParams.set(
    'fields',
    'nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,owners(displayName,emailAddress),webViewLink,parents,capabilities(canEdit))',
  );
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', String(Math.min(Math.max(params.pageSize || 25, 1), 100)));
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');
  if (params.pageToken) {
    url.searchParams.set('pageToken', params.pageToken);
  }

  const res = await fetcher(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    },
  });

  const rawText = await res.text();
  if (!res.ok) {
    const classified = classifyDriveApiError(res.status, rawText);
    throw new AppError(classified.statusCode, classified.code, classified.message);
  }

  let parsed: {
    nextPageToken?: string;
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
      createdTime?: string;
      owners?: Array<{ displayName?: string; emailAddress?: string }>;
      webViewLink?: string;
      parents?: string[];
      capabilities?: { canEdit?: boolean };
    }>;
  } = {};

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new AppError(502, 'DRIVE_RESPONSE_INVALID', 'Invalid JSON returned from Google Drive API.');
  }

  return {
    nextPageToken: parsed.nextPageToken,
    files: (parsed.files || [])
      .filter((f) => f.mimeType === APPS_SCRIPT_MIME)
      .map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
        createdTime: f.createdTime,
        owners: f.owners || [],
        webViewLink: f.webViewLink,
        parents: f.parents,
        canEdit: f.capabilities?.canEdit,
      })),
  };
}
