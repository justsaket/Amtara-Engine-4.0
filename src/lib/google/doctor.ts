import type {
  AppsScriptDeploymentRecord,
  AppsScriptProjectRecord,
  DoctorCheckItem,
  GoogleConnectionRecord,
  GoogleDoctorReport,
} from '@/types/domain';
import { AppError } from '@/lib/server/error-handler';
import {
  getAppsScriptContent,
  listAppsScriptDeployments,
  listAppsScriptProcesses,
} from './apps-script-client';
import { discoverAppsScriptProjects } from './drive-client';
import { parseAndValidateManifest } from './manifest';
import { verifyGoogleTokenInfo, type FetchLike } from './oauth';
import {
  GOOGLE_SCOPE,
  evaluateCapabilities,
  normalizeGrantedScopeList,
} from './permissions';

export const APPS_SCRIPT_USER_SETTINGS_URL = 'https://script.google.com/home/usersettings';
export const GOOGLE_APPS_SCRIPT_API_CONSOLE_URL =
  'https://console.cloud.google.com/apis/library/script.googleapis.com';
export const GOOGLE_DRIVE_API_CONSOLE_URL =
  'https://console.cloud.google.com/apis/library/drive.googleapis.com';

export async function runGoogleIntegrationDoctor(params: {
  platformOAuthConfigured: boolean;
  encryptionVaultReady: boolean;
  redirectUri: string;
  connection: GoogleConnectionRecord | null;
  accessToken?: string;
  targetProject?: AppsScriptProjectRecord | null;
  targetDeployments?: AppsScriptDeploymentRecord[];
  fetchImpl?: FetchLike;
}): Promise<GoogleDoctorReport> {
  const fetcher = params.fetchImpl || fetch;
  const checks: DoctorCheckItem[] = [];
  const grantedSet = new Set(normalizeGrantedScopeList(params.connection?.grantedScopes));

  // 1. Platform OAuth configured
  checks.push(
    params.platformOAuthConfigured
      ? {
          id: 'platform_oauth',
          label: 'Platform Google OAuth Web Client',
          status: 'pass',
          code: 'DEPLOYMENT_READY',
          detail: `Configured cleanly. Authorized Redirect URI: ${params.redirectUri}`,
        }
      : {
          id: 'platform_oauth',
          label: 'Platform Google OAuth Web Client',
          status: 'action_required',
          code: 'PLATFORM_OAUTH_NOT_CONFIGURED',
          detail:
            'Configure Google OAuth Client ID and Client Secret in Integrations -> Configure Google OAuth App or environment variables.',
        },
  );

  // 2. Encryption Vault Ready
  checks.push({
    id: 'encryption_vault',
    label: 'AES-256-GCM Credential Vault',
    status: params.encryptionVaultReady ? 'pass' : 'error',
    code: params.encryptionVaultReady ? 'DEPLOYMENT_READY' : 'PROVIDER_ERROR',
    detail: params.encryptionVaultReady
      ? 'Master encryption key is active and separated from token storage.'
      : 'Encryption key is unavailable for storing OAuth credentials.',
  });

  // 3. Google Connection Exists
  const hasConn = Boolean(
    params.connection && params.connection.status !== 'disconnected',
  );
  checks.push(
    hasConn
      ? {
          id: 'google_connection',
          label: 'Connected Google Workspace Account',
          status: 'pass',
          code: 'DEPLOYMENT_READY',
          detail: `Authorized as ${params.connection!.googleEmail}.`,
        }
      : {
          id: 'google_connection',
          label: 'Connected Google Workspace Account',
          status: 'action_required',
          code: 'GOOGLE_NOT_CONNECTED',
          detail: 'No external Google account is currently connected to this workspace.',
        },
  );

  // 4. Connection Status
  const statusHealthy = params.connection?.status === 'connected';
  if (params.connection) {
    checks.push(
      statusHealthy
        ? {
            id: 'connection_health',
            label: 'OAuth Token Health',
            status: 'pass',
            code: 'DEPLOYMENT_READY',
            detail: 'Connection status is active.',
          }
        : {
            id: 'connection_health',
            label: 'OAuth Token Health',
            status: 'action_required',
            code:
              params.connection.status === 'revoked'
                ? 'CONNECTION_REVOKED'
                : 'GOOGLE_REAUTH_REQUIRED',
            detail:
              params.connection.lastErrorMessage ||
              `Connection state is "${params.connection.status}". Reauthorize Google access.`,
          },
    );
  } else {
    checks.push({
      id: 'connection_health',
      label: 'OAuth Token Health',
      status: 'action_required',
      code: 'GOOGLE_NOT_CONNECTED',
      detail: 'Authorize a Google account to activate token lifecycle verification.',
    });
  }

  // 5. Refresh Token Durability
  checks.push({
    id: 'refresh_token',
    label: 'Offline Refresh Token',
    status: params.connection?.hasRefreshToken ? 'pass' : 'warning',
    code: params.connection?.hasRefreshToken ? 'DEPLOYMENT_READY' : 'GOOGLE_REAUTH_REQUIRED',
    detail: params.connection?.hasRefreshToken
      ? 'Encrypted offline refresh token persisted in server vault.'
      : 'No offline refresh token cached yet. Reauthorize with consent prompt if sessions expire.',
  });

  // 6. Identity Scope
  const hasIdentityScope =
    grantedSet.has(GOOGLE_SCOPE.OPENID) &&
    grantedSet.has(GOOGLE_SCOPE.EMAIL);
  checks.push({
    id: 'scope_identity',
    label: 'OpenID Identity Scopes (openid, email, profile)',
    status: hasIdentityScope ? 'pass' : 'action_required',
    code: hasIdentityScope ? 'DEPLOYMENT_READY' : 'GOOGLE_NOT_CONNECTED',
    detail: hasIdentityScope
      ? 'Google identity scopes granted cleanly.'
      : 'Connect Google to verify OpenID email and account profile.',
  });

  // 7. Project Management Scope
  const hasProjectScope = grantedSet.has(GOOGLE_SCOPE.SCRIPT_PROJECTS);
  checks.push({
    id: 'scope_projects',
    label: 'Apps Script Projects Scope (script.projects)',
    status: hasProjectScope ? 'pass' : 'action_required',
    code: hasProjectScope ? 'PROJECT_MANAGEMENT_READY' : 'MISSING_PROJECT_SCOPE',
    detail: hasProjectScope
      ? 'Granted read/write access to script project files and immutable versions.'
      : 'Grant script.projects via incremental authorization to manage Apps Script files.',
  });

  // 8. Deployment Management Scope
  const hasDeploymentScope = grantedSet.has(GOOGLE_SCOPE.SCRIPT_DEPLOYMENTS);
  checks.push({
    id: 'scope_deployments',
    label: 'Apps Script Deployments Scope (script.deployments)',
    status: hasDeploymentScope ? 'pass' : 'action_required',
    code: hasDeploymentScope ? 'DEPLOYMENT_READY' : 'MISSING_DEPLOYMENT_SCOPE',
    detail: hasDeploymentScope
      ? 'Granted Web App and API Executable deployment permissions.'
      : 'Grant script.deployments via incremental authorization to publish or update deployments.',
  });

  // 9. Drive Discovery Scope
  const hasDriveScope = grantedSet.has(GOOGLE_SCOPE.DRIVE_METADATA_READONLY);
  checks.push({
    id: 'scope_drive',
    label: 'Drive Metadata Discovery Scope (drive.metadata.readonly)',
    status: hasDriveScope ? 'pass' : 'warning',
    code: hasDriveScope ? 'DEPLOYMENT_READY' : 'DRIVE_DISCOVERY_NOT_AUTHORIZED',
    detail: hasDriveScope
      ? 'Granted minimal metadata-only access to discover Apps Script files.'
      : 'Optional: grant drive.metadata.readonly to list existing Drive Apps Script projects.',
  });

  // 10. Processes Scope
  const hasProcessesScope = grantedSet.has(GOOGLE_SCOPE.SCRIPT_PROCESSES);
  checks.push({
    id: 'scope_processes',
    label: 'Apps Script Processes Scope (script.processes)',
    status: hasProcessesScope ? 'pass' : 'warning',
    code: hasProcessesScope ? 'DEPLOYMENT_READY' : 'EXECUTION_SCOPE_REQUIRED',
    detail: hasProcessesScope
      ? 'Granted process telemetry scope.'
      : 'Optional: grant script.processes to inspect historical Google script runs.',
  });

  // 11. Live TokenInfo Verification
  let tokenVerifiedLive = false;
  if (params.accessToken) {
    try {
      const info = await verifyGoogleTokenInfo(params.accessToken, fetcher);
      tokenVerifiedLive = info.valid;
      checks.push(
        info.valid
          ? {
              id: 'live_tokeninfo',
              label: 'Live Google Token Verification',
              status: 'pass',
              code: 'DEPLOYMENT_READY',
              detail: `Verified active access token${info.expiresInSeconds ? ` (${info.expiresInSeconds}s remaining)` : ''}.`,
            }
          : {
              id: 'live_tokeninfo',
              label: 'Live Google Token Verification',
              status: 'error',
              code: 'GOOGLE_REAUTH_REQUIRED',
              detail: info.reason || 'Access token rejected by Google tokeninfo.',
            },
      );
    } catch {
      checks.push({
        id: 'live_tokeninfo',
        label: 'Live Google Token Verification',
        status: 'warning',
        code: 'PROVIDER_ERROR',
        detail: 'Could not reach oauth2.googleapis.com/tokeninfo from server runtime.',
      });
    }
  } else {
    checks.push({
      id: 'live_tokeninfo',
      label: 'Live Google Token Verification',
      status: 'action_required',
      code: 'GOOGLE_NOT_CONNECTED',
      detail: 'Authorize Google first to run live tokeninfo check.',
    });
  }

  // 12. Live Drive API Probe
  if (params.accessToken && hasDriveScope) {
    try {
      await discoverAppsScriptProjects({
        accessToken: params.accessToken,
        pageSize: 1,
        fetchImpl: fetcher,
      });
      checks.push({
        id: 'live_drive_api',
        label: 'Google Drive API v3 Availability',
        status: 'pass',
        code: 'DEPLOYMENT_READY',
        detail: 'Drive API v3 responded cleanly to Apps Script metadata query.',
      });
    } catch (err) {
      const code =
        err instanceof AppError
          ? (err.code as DoctorCheckItem['code'])
          : 'PROVIDER_ERROR';
      checks.push({
        id: 'live_drive_api',
        label: 'Google Drive API v3 Availability',
        status: 'error',
        code,
        detail: err instanceof Error ? err.message : 'Drive API check failed.',
        actionUrl: GOOGLE_DRIVE_API_CONSOLE_URL,
        actionLabel: 'Enable Drive API in Cloud Console',
      });
    }
  } else {
    checks.push({
      id: 'live_drive_api',
      label: 'Google Drive API v3 Availability',
      status: hasDriveScope ? 'action_required' : 'warning',
      code: 'DRIVE_DISCOVERY_NOT_AUTHORIZED',
      detail: 'Requires connected Google account with drive.metadata.readonly scope.',
    });
  }

  // 13 & 14. Live Apps Script API + User Settings Toggle Check
  let appsScriptApiToggleConfirmed: boolean | undefined;
  if (params.accessToken && (hasProcessesScope || params.targetProject)) {
    try {
      if (params.targetProject) {
        await getAppsScriptContent(
          params.accessToken,
          params.targetProject.scriptId,
          fetcher,
        );
      } else {
        await listAppsScriptProcesses(params.accessToken, undefined, fetcher);
      }
      appsScriptApiToggleConfirmed = true;
      checks.push({
        id: 'live_apps_script_api',
        label: 'Google Apps Script API & User Settings Toggle',
        status: 'pass',
        code: 'PROJECT_MANAGEMENT_READY',
        detail:
          'Google Apps Script API responded cleanly and user Apps Script API toggle is enabled.',
      });
    } catch (err) {
      const code =
        err instanceof AppError
          ? (err.code as DoctorCheckItem['code'])
          : 'PROVIDER_ERROR';
      if (code === 'SCRIPT_PROJECT_ACCESS_NOT_GRANTED') {
        appsScriptApiToggleConfirmed = false;
      }
      checks.push({
        id: 'live_apps_script_api',
        label: 'Google Apps Script API & User Settings Toggle',
        status: 'action_required',
        code,
        detail: err instanceof Error ? err.message : 'Apps Script API check failed.',
        actionUrl:
          code === 'SCRIPT_PROJECT_ACCESS_NOT_GRANTED'
            ? APPS_SCRIPT_USER_SETTINGS_URL
            : GOOGLE_APPS_SCRIPT_API_CONSOLE_URL,
        actionLabel:
          code === 'SCRIPT_PROJECT_ACCESS_NOT_GRANTED'
            ? 'Enable Apps Script API in Google User Settings'
            : 'Enable Apps Script API in Cloud Console',
      });
    }
  } else {
    checks.push({
      id: 'live_apps_script_api',
      label: 'Google Apps Script API & User Settings Toggle',
      status: 'warning',
      code: 'SCRIPT_PROJECT_ACCESS_NOT_GRANTED',
      detail:
        'Ensure each connected Google user turns ON "Google Apps Script API" at https://script.google.com/home/usersettings.',
      actionUrl: APPS_SCRIPT_USER_SETTINGS_URL,
      actionLabel: 'Open Google Apps Script Settings',
    });
  }

  // 15. Target Script Manifest & Execution Scopes
  let manifestScopes: string[] = [];
  if (params.accessToken && params.targetProject) {
    try {
      const content = await getAppsScriptContent(
        params.accessToken,
        params.targetProject.scriptId,
        fetcher,
      );
      const manifestFile = content.files.find(
        (f) => f.type === 'JSON' && (f.name === 'appsscript' || f.name === 'appsscript.json'),
      );
      const parsed = manifestFile ? parseAndValidateManifest(manifestFile.source) : null;
      manifestScopes = parsed?.manifest?.oauthScopes || [];
      const missingExecScopes = manifestScopes.filter((s) => !grantedSet.has(s));
      checks.push(
        parsed?.valid
          ? missingExecScopes.length === 0
            ? {
                id: 'target_manifest_scopes',
                label: 'Target Script Manifest & Execution Scopes',
                status: 'pass',
                code: 'DEPLOYMENT_READY',
                detail: `Manifest verified for "${params.targetProject.title}" (${manifestScopes.length} declared execution scope(s)).`,
              }
            : {
                id: 'target_manifest_scopes',
                label: 'Target Script Manifest & Execution Scopes',
                status: 'action_required',
                code: 'EXECUTION_SCOPE_REQUIRED',
                detail: `Target script manifest requires additional OAuth scope(s): ${missingExecScopes.join(', ')}.`,
              }
          : {
              id: 'target_manifest_scopes',
              label: 'Target Script Manifest & Execution Scopes',
              status: 'error',
              code: 'PROVIDER_ERROR',
              detail: parsed?.errors[0] || 'Manifest file appsscript.json is invalid or missing.',
            },
      );
    } catch (err) {
      checks.push({
        id: 'target_manifest_scopes',
        label: 'Target Script Manifest & Execution Scopes',
        status: 'warning',
        code: 'PROVIDER_ERROR',
        detail: err instanceof Error ? err.message : 'Unable to inspect target manifest.',
      });
    }
  } else {
    checks.push({
      id: 'target_manifest_scopes',
      label: 'Target Script Manifest & Execution Scopes',
      status: 'warning',
      code: 'PROJECT_MANAGEMENT_READY',
      detail: 'Select an Apps Script project in Apps Script Center to audit manifest scopes.',
    });
  }

  // 16. API Executable Deployment & GCP Project Alignment Check
  if (params.accessToken && params.targetProject && hasDeploymentScope) {
    try {
      const liveDeps = await listAppsScriptDeployments(
        params.accessToken,
        params.targetProject.scriptId,
        fetcher,
      );
      const hasApiExec = liveDeps.deployments.some((d) =>
        (d.entryPoints || []).some((e) => e.entryPointType === 'EXECUTION_API'),
      );
      checks.push(
        hasApiExec
          ? {
              id: 'api_executable_deployment',
              label: 'API Executable Deployment & Cloud Project Alignment',
              status: 'pass',
              code: 'DEPLOYMENT_READY',
              detail:
                'Verified active API Executable deployment. Remote execution requires matching Standard Google Cloud Project number.',
            }
          : {
              id: 'api_executable_deployment',
              label: 'API Executable Deployment & Cloud Project Alignment',
              status: 'warning',
              code: 'API_EXECUTABLE_NOT_DEPLOYED',
              detail:
                'No API Executable deployment found on selected script yet. Deploy an API Executable version to invoke scripts.run.',
            },
      );
    } catch (err) {
      const code =
        err instanceof AppError
          ? (err.code as DoctorCheckItem['code'])
          : 'PROVIDER_ERROR';
      checks.push({
        id: 'api_executable_deployment',
        label: 'API Executable Deployment & Cloud Project Alignment',
        status: 'error',
        code,
        detail: err instanceof Error ? err.message : 'Deployment inspection failed.',
      });
    }
  } else {
    const localExec = (params.targetDeployments || []).some(
      (d) => d.deploymentType === 'API_EXECUTABLE' && d.status === 'active',
    );
    checks.push({
      id: 'api_executable_deployment',
      label: 'API Executable Deployment & Cloud Project Alignment',
      status: localExec ? 'pass' : 'warning',
      code: localExec ? 'DEPLOYMENT_READY' : 'API_EXECUTABLE_NOT_DEPLOYED',
      detail: localExec
        ? 'API Executable deployment tracked in Antara workspace.'
        : 'Create and verify an API Executable deployment (and bind standard GCP project) before remote scripts.run.',
    });
  }

  const capabilities = evaluateCapabilities({
    platformOAuthConfigured: params.platformOAuthConfigured,
    connection: params.connection,
    scriptManifestScopes: manifestScopes,
    appsScriptApiToggleConfirmed,
  });

  const overallReady =
    params.platformOAuthConfigured &&
    params.encryptionVaultReady &&
    statusHealthy &&
    hasProjectScope &&
    hasDeploymentScope &&
    (tokenVerifiedLive || !params.accessToken) &&
    appsScriptApiToggleConfirmed !== false;

  return {
    overallReady,
    platformOAuthConfigured: params.platformOAuthConfigured,
    redirectUri: params.redirectUri,
    connectionStatus: params.connection?.status || 'not_connected',
    ...(params.connection?.googleEmail ? { connectedEmail: params.connection.googleEmail } : {}),
    checks,
    capabilities,
    checkedAt: new Date().toISOString(),
  };
}
