import type { AppsScriptFile, DoctorDiagnosticCode } from '@/types/domain';
import { AppError } from '@/lib/server/error-handler';
import type { FetchLike } from './oauth';

const SCRIPT_API_BASE = 'https://script.googleapis.com/v1';

export interface GoogleAppsScriptProjectMetadata {
  scriptId: string;
  title: string;
  parentId?: string;
  createTime?: string;
  updateTime?: string;
}

export interface GoogleAppsScriptVersionResponse {
  scriptId: string;
  versionNumber: number;
  description?: string;
  createTime?: string;
}

export interface GoogleAppsScriptEntryPoint {
  entryPointType?: 'WEB_APP' | 'EXECUTION_API' | 'ADD_ON' | string;
  webApp?: {
    url?: string;
    entryPointConfig?: {
      access?: string;
      executeAs?: string;
    };
  };
  executionApi?: {
    entryPointConfig?: {
      access?: string;
    };
  };
}

export interface GoogleAppsScriptDeploymentResponse {
  deploymentId: string;
  deploymentConfig?: {
    scriptId?: string;
    versionNumber?: number;
    manifestFileName?: string;
    description?: string;
  };
  updateTime?: string;
  entryPoints?: GoogleAppsScriptEntryPoint[];
}

export interface GoogleAppsScriptExecutionResponse {
  done?: boolean;
  response?: {
    '@type'?: string;
    result?: unknown;
  };
  error?: {
    code?: number;
    message?: string;
    details?: Array<Record<string, unknown>>;
  };
}

export interface GoogleAppsScriptProcessItem {
  projectName?: string;
  functionName?: string;
  processType?: string;
  processStatus?: string;
  userAccessLevel?: string;
  startTime?: string;
  duration?: string;
}

export function classifyAppsScriptError(
  status: number,
  rawBody: string,
  operation: 'projects' | 'deployments' | 'execute' | 'processes' = 'projects',
): {
  statusCode: number;
  code: DoctorDiagnosticCode | 'PROVIDER_ERROR';
  message: string;
} {
  const lower = rawBody.toLowerCase();

  if (status === 401) {
    return {
      statusCode: 401,
      code: 'GOOGLE_REAUTH_REQUIRED',
      message:
        'Google OAuth credential expired or was rejected (401). Reauthorize Google access.',
    };
  }

  if (
    lower.includes('user has not enabled the apps script api') ||
    lower.includes('script.google.com/home/usersettings')
  ) {
    return {
      statusCode: 403,
      code: 'SCRIPT_PROJECT_ACCESS_NOT_GRANTED',
      message:
        'The connected Google user has not enabled the Google Apps Script API toggle in their Apps Script User Settings (https://script.google.com/home/usersettings).',
    };
  }

  if (
    status === 403 &&
    (lower.includes('script.googleapis.com') ||
      lower.includes('accessnotconfigured') ||
      lower.includes('has not been used in project') ||
      lower.includes('api has not been used'))
  ) {
    return {
      statusCode: 403,
      code: 'APPS_SCRIPT_API_NOT_ENABLED',
      message:
        'Apps Script API (script.googleapis.com) is not enabled in the configured Google Cloud project.',
    };
  }

  if (
    status === 403 &&
    (lower.includes('insufficient') || lower.includes('scope'))
  ) {
    return {
      statusCode: 403,
      code:
        operation === 'deployments'
          ? 'MISSING_DEPLOYMENT_SCOPE'
          : operation === 'execute'
            ? 'EXECUTION_SCOPE_REQUIRED'
            : 'MISSING_PROJECT_SCOPE',
      message:
        operation === 'deployments'
          ? 'Missing https://www.googleapis.com/auth/script.deployments scope. Authorize deployment permissions.'
          : operation === 'execute'
            ? 'Missing execution or project scopes required by the script manifest.'
            : 'Missing https://www.googleapis.com/auth/script.projects scope.',
    };
  }

  if (
    operation === 'execute' &&
    (status === 404 ||
      lower.includes('requested entity was not found') ||
      lower.includes('cloud project'))
  ) {
    return {
      statusCode: 404,
      code: 'CLOUD_PROJECT_MISMATCH',
      message:
        'Apps Script execution target was not found or the script is not bound to the same standard Google Cloud Project as Antara OAuth client.',
    };
  }

  if (
    status === 429 ||
    lower.includes('ratelimitexceeded') ||
    lower.includes('quota')
  ) {
    return {
      statusCode: 429,
      code: 'QUOTA_LIMITED',
      message: 'Google Apps Script API rate limit or quota exceeded. Retry later.',
    };
  }

  let parsedMsg = '';
  try {
    const parsed = JSON.parse(rawBody) as { error?: { message?: string } };
    if (parsed?.error?.message) parsedMsg = parsed.error.message;
  } catch {
    // plain text body
  }

  return {
    statusCode: status >= 400 && status < 500 ? status : 502,
    code: 'PROVIDER_ERROR',
    message: parsedMsg || `Google Apps Script API returned HTTP ${status}.`,
  };
}

async function scriptApiFetch<T>(
  accessToken: string,
  path: string,
  init: RequestInit,
  operation: 'projects' | 'deployments' | 'execute' | 'processes',
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const res = await fetchImpl(`${SCRIPT_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });

  const rawText = await res.text();
  if (!res.ok) {
    const classified = classifyAppsScriptError(res.status, rawText, operation);
    throw new AppError(classified.statusCode, classified.code, classified.message);
  }

  if (!rawText) return {} as T;
  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new AppError(
      502,
      'APPS_SCRIPT_INVALID_JSON',
      'Received malformed JSON response from Google Apps Script API.',
    );
  }
}

export async function createAppsScriptProject(
  accessToken: string,
  input: { title: string; parentId?: string },
  fetchImpl: FetchLike = fetch,
): Promise<GoogleAppsScriptProjectMetadata> {
  return scriptApiFetch<GoogleAppsScriptProjectMetadata>(
    accessToken,
    '/projects',
    {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        ...(input.parentId ? { parentId: input.parentId } : {}),
      }),
    },
    'projects',
    fetchImpl,
  );
}

export async function getAppsScriptProject(
  accessToken: string,
  scriptId: string,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleAppsScriptProjectMetadata> {
  return scriptApiFetch<GoogleAppsScriptProjectMetadata>(
    accessToken,
    `/projects/${encodeURIComponent(scriptId)}`,
    { method: 'GET' },
    'projects',
    fetchImpl,
  );
}

export async function getAppsScriptContent(
  accessToken: string,
  scriptId: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ scriptId: string; files: AppsScriptFile[] }> {
  return scriptApiFetch<{ scriptId: string; files: AppsScriptFile[] }>(
    accessToken,
    `/projects/${encodeURIComponent(scriptId)}/content`,
    { method: 'GET' },
    'projects',
    fetchImpl,
  );
}

export async function updateAppsScriptContent(
  accessToken: string,
  scriptId: string,
  files: AppsScriptFile[],
  fetchImpl: FetchLike = fetch,
): Promise<{ scriptId: string; files: AppsScriptFile[] }> {
  return scriptApiFetch<{ scriptId: string; files: AppsScriptFile[] }>(
    accessToken,
    `/projects/${encodeURIComponent(scriptId)}/content`,
    {
      method: 'PUT',
      body: JSON.stringify({
        files: files.map((f) => ({
          name: f.name,
          type: f.type,
          source: f.source,
        })),
      }),
    },
    'projects',
    fetchImpl,
  );
}

export async function createAppsScriptVersion(
  accessToken: string,
  scriptId: string,
  description: string,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleAppsScriptVersionResponse> {
  return scriptApiFetch<GoogleAppsScriptVersionResponse>(
    accessToken,
    `/projects/${encodeURIComponent(scriptId)}/versions`,
    {
      method: 'POST',
      body: JSON.stringify({ description }),
    },
    'projects',
    fetchImpl,
  );
}

export async function listAppsScriptVersions(
  accessToken: string,
  scriptId: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ versions: GoogleAppsScriptVersionResponse[]; nextPageToken?: string }> {
  const res = await scriptApiFetch<{
    versions?: GoogleAppsScriptVersionResponse[];
    nextPageToken?: string;
  }>(
    accessToken,
    `/projects/${encodeURIComponent(scriptId)}/versions?pageSize=50`,
    { method: 'GET' },
    'projects',
    fetchImpl,
  );
  return { versions: res.versions || [], nextPageToken: res.nextPageToken };
}

export async function listAppsScriptDeployments(
  accessToken: string,
  scriptId: string,
  fetchImpl: FetchLike = fetch,
): Promise<{
  deployments: GoogleAppsScriptDeploymentResponse[];
  nextPageToken?: string;
}> {
  const res = await scriptApiFetch<{
    deployments?: GoogleAppsScriptDeploymentResponse[];
    nextPageToken?: string;
  }>(
    accessToken,
    `/projects/${encodeURIComponent(scriptId)}/deployments?pageSize=50`,
    { method: 'GET' },
    'deployments',
    fetchImpl,
  );
  return { deployments: res.deployments || [], nextPageToken: res.nextPageToken };
}

export async function getAppsScriptDeployment(
  accessToken: string,
  scriptId: string,
  deploymentId: string,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleAppsScriptDeploymentResponse> {
  return scriptApiFetch<GoogleAppsScriptDeploymentResponse>(
    accessToken,
    `/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`,
    { method: 'GET' },
    'deployments',
    fetchImpl,
  );
}

export async function createAppsScriptDeployment(
  accessToken: string,
  scriptId: string,
  input: {
    versionNumber: number;
    manifestFileName?: string;
    description: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<GoogleAppsScriptDeploymentResponse> {
  return scriptApiFetch<GoogleAppsScriptDeploymentResponse>(
    accessToken,
    `/projects/${encodeURIComponent(scriptId)}/deployments`,
    {
      method: 'POST',
      body: JSON.stringify({
        versionNumber: input.versionNumber,
        manifestFileName: input.manifestFileName || 'appsscript',
        description: input.description,
      }),
    },
    'deployments',
    fetchImpl,
  );
}

export async function updateAppsScriptDeployment(
  accessToken: string,
  scriptId: string,
  deploymentId: string,
  input: {
    versionNumber: number;
    manifestFileName?: string;
    description: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<GoogleAppsScriptDeploymentResponse> {
  return scriptApiFetch<GoogleAppsScriptDeploymentResponse>(
    accessToken,
    `/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        deploymentConfig: {
          scriptId,
          versionNumber: input.versionNumber,
          manifestFileName: input.manifestFileName || 'appsscript',
          description: input.description,
        },
      }),
    },
    'deployments',
    fetchImpl,
  );
}

export async function deleteAppsScriptDeployment(
  accessToken: string,
  scriptId: string,
  deploymentId: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  await scriptApiFetch<Record<string, never>>(
    accessToken,
    `/projects/${encodeURIComponent(scriptId)}/deployments/${encodeURIComponent(deploymentId)}`,
    { method: 'DELETE' },
    'deployments',
    fetchImpl,
  );
}

export async function runAppsScriptFunction(
  accessToken: string,
  deploymentId: string,
  input: {
    functionName: string;
    parameters?: unknown[];
    devMode?: boolean;
  },
  fetchImpl: FetchLike = fetch,
): Promise<GoogleAppsScriptExecutionResponse> {
  return scriptApiFetch<GoogleAppsScriptExecutionResponse>(
    accessToken,
    `/scripts/${encodeURIComponent(deploymentId)}:run`,
    {
      method: 'POST',
      body: JSON.stringify({
        function: input.functionName,
        parameters: input.parameters || [],
        devMode: Boolean(input.devMode),
      }),
    },
    'execute',
    fetchImpl,
  );
}

export async function listAppsScriptProcesses(
  accessToken: string,
  scriptId?: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ processes: GoogleAppsScriptProcessItem[] }> {
  const query = scriptId
    ? `/processes:listScriptProcesses?scriptId=${encodeURIComponent(scriptId)}&pageSize=30`
    : '/processes?pageSize=30';
  const res = await scriptApiFetch<{ processes?: GoogleAppsScriptProcessItem[] }>(
    accessToken,
    query,
    { method: 'GET' },
    'processes',
    fetchImpl,
  );
  return { processes: res.processes || [] };
}
