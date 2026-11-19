import type {
  CapabilityAvailability,
  EvaluatedGoogleCapability,
  GoogleCapabilityDescriptor,
  GoogleCapabilityId,
  GoogleConnectionRecord,
} from '@/types/domain';

export const GOOGLE_SCOPE = {
  OPENID: 'openid',
  EMAIL: 'email',
  PROFILE: 'profile',
  SCRIPT_PROJECTS: 'https://www.googleapis.com/auth/script.projects',
  SCRIPT_DEPLOYMENTS: 'https://www.googleapis.com/auth/script.deployments',
  DRIVE_METADATA_READONLY: 'https://www.googleapis.com/auth/drive.metadata.readonly',
  DRIVE_READONLY: 'https://www.googleapis.com/auth/drive.readonly',
  SCRIPT_PROCESSES: 'https://www.googleapis.com/auth/script.processes',
  SCRIPT_EXTERNAL_REQUEST: 'https://www.googleapis.com/auth/script.external_request',
} as const;

export const GOOGLE_CAPABILITY_REGISTRY: readonly GoogleCapabilityDescriptor[] = [
  {
    id: 'google_identity',
    name: 'Google Account Identity',
    requiredApi: 'OpenID Connect UserInfo API',
    requiredScopes: [GOOGLE_SCOPE.OPENID, GOOGLE_SCOPE.EMAIL, GOOGLE_SCOPE.PROFILE],
    riskCategory: 'low',
    explanation:
      'Verifies the authorized Google email, account ID, and profile name independently of Antara Engine login.',
  },
  {
    id: 'apps_script_projects',
    name: 'Apps Script Project Management',
    requiredApi: 'Apps Script API (script.googleapis.com)',
    requiredScopes: [GOOGLE_SCOPE.SCRIPT_PROJECTS],
    riskCategory: 'medium',
    explanation:
      'Creates standalone or bound Apps Script projects, reads project files, submits protected updates, and creates immutable versions.',
    requiresAppsScriptUserSetting: true,
  },
  {
    id: 'apps_script_deployments',
    name: 'Apps Script Deployment Management',
    requiredApi: 'Apps Script API (script.googleapis.com)',
    requiredScopes: [GOOGLE_SCOPE.SCRIPT_DEPLOYMENTS],
    riskCategory: 'high',
    explanation:
      'Creates, updates, inspects, and retires Web App and API Executable deployments bound to immutable script versions.',
    requiresAppsScriptUserSetting: true,
  },
  {
    id: 'drive_discovery',
    name: 'Google Drive Script Discovery',
    requiredApi: 'Google Drive API v3 (drive.googleapis.com)',
    requiredScopes: [GOOGLE_SCOPE.DRIVE_METADATA_READONLY],
    riskCategory: 'low',
    explanation:
      'Metadata-only listing of eligible application/vnd.google-apps.script files (names, file IDs, modified dates, and owner metadata) without reading full Drive contents.',
  },
  {
    id: 'drive_autopilot_read',
    name: 'Google Drive Autopilot Read Access',
    requiredApi: 'Google Drive API v3 (drive.googleapis.com)',
    requiredScopes: [GOOGLE_SCOPE.DRIVE_READONLY],
    riskCategory: 'medium',
    explanation:
      'Read-only access to monitor selected Drive folders, traverse configured subfolders, receive change notifications, and securely retrieve video media for autonomous publishing.',
  },
  {
    id: 'apps_script_processes',
    name: 'Apps Script Process Monitoring',
    requiredApi: 'Apps Script API (script.googleapis.com)',
    requiredScopes: [GOOGLE_SCOPE.SCRIPT_PROCESSES],
    riskCategory: 'low',
    explanation:
      'Reads recent execution telemetry and completion states via processes.list and processes.listScriptProcesses.',
  },
  {
    id: 'apps_script_execution',
    name: 'Apps Script Execution (scripts.run)',
    requiredApi: 'Apps Script API Execution Endpoint',
    requiredScopes: [GOOGLE_SCOPE.SCRIPT_PROJECTS],
    riskCategory: 'high',
    explanation:
      'Executes explicitly allowlisted functions through an API Executable deployment, additionally requiring every OAuth scope declared in the target project manifest.',
  },
] as const;

export function getCapabilityDescriptor(
  id: GoogleCapabilityId,
): GoogleCapabilityDescriptor {
  return (
    GOOGLE_CAPABILITY_REGISTRY.find((c) => c.id === id) ||
    GOOGLE_CAPABILITY_REGISTRY[0]
  );
}

export function resolveScopesForCapabilities(
  capabilityIds: readonly GoogleCapabilityId[],
  extraScopes: readonly string[] = [],
): string[] {
  const scopeSet = new Set<string>([
    GOOGLE_SCOPE.OPENID,
    GOOGLE_SCOPE.EMAIL,
    GOOGLE_SCOPE.PROFILE,
  ]);

  for (const id of capabilityIds) {
    const desc = getCapabilityDescriptor(id);
    for (const s of desc.requiredScopes) {
      scopeSet.add(s);
    }
  }

  for (const extra of extraScopes) {
    const trimmed = extra.trim();
    if (trimmed.startsWith('https://www.googleapis.com/auth/') || ['openid', 'email', 'profile'].includes(trimmed)) {
      scopeSet.add(trimmed);
    }
  }

  return Array.from(scopeSet);
}

export function normalizeGrantedScopeList(rawScopeString: string | string[] | undefined): string[] {
  if (!rawScopeString) return [];
  const list = Array.isArray(rawScopeString)
    ? rawScopeString
    : rawScopeString.split(/\s+/);

  const normalized = new Set<string>();
  for (const item of list) {
    const s = item.trim();
    if (!s) continue;
    normalized.add(s);
    // Normalize Google OIDC short vs full scope synonyms cleanly
    if (s === 'https://www.googleapis.com/auth/userinfo.email') normalized.add('email');
    if (s === 'https://www.googleapis.com/auth/userinfo.profile') normalized.add('profile');
  }
  return Array.from(normalized);
}

export function evaluateCapabilities(params: {
  platformOAuthConfigured: boolean;
  connection: GoogleConnectionRecord | null;
  scriptManifestScopes?: string[];
  appsScriptApiToggleConfirmed?: boolean;
}): EvaluatedGoogleCapability[] {
  const {
    platformOAuthConfigured,
    connection,
    scriptManifestScopes = [],
    appsScriptApiToggleConfirmed,
  } = params;

  const granted = normalizeGrantedScopeList(connection?.grantedScopes);
  const grantedSet = new Set(granted);

  return GOOGLE_CAPABILITY_REGISTRY.map((cap): EvaluatedGoogleCapability => {
    const effectiveRequired =
      cap.id === 'apps_script_execution' && scriptManifestScopes.length > 0
        ? Array.from(new Set([...cap.requiredScopes, ...scriptManifestScopes]))
        : cap.requiredScopes;

    const missingScopes = effectiveRequired.filter((s) => !grantedSet.has(s));

    if (!platformOAuthConfigured) {
      return {
        ...cap,
        requiredScopes: effectiveRequired,
        availability: 'APP_CONFIG_REQUIRED',
        grantedScopes: granted,
        missingScopes,
        reauthorizationRequired: false,
        reason:
          'Platform Google OAuth Client ID and Client Secret are not yet configured by a workspace administrator.',
      };
    }

    if (!connection || connection.status === 'disconnected' || connection.status === 'revoked') {
      return {
        ...cap,
        requiredScopes: effectiveRequired,
        availability: 'USER_AUTHORIZATION_REQUIRED',
        grantedScopes: [],
        missingScopes: effectiveRequired,
        reauthorizationRequired: true,
        reason:
          connection?.status === 'revoked'
            ? 'Previous Google authorization was revoked. Connect or reauthorize Google access.'
            : 'No connected Google account is linked to this workspace yet.',
      };
    }

    if (connection.status === 'reauth_required' || connection.status === 'expired') {
      return {
        ...cap,
        requiredScopes: effectiveRequired,
        availability: 'USER_AUTHORIZATION_REQUIRED',
        grantedScopes: granted,
        missingScopes,
        reauthorizationRequired: true,
        reason: 'Google authorization expired or requires fresh offline consent.',
      };
    }

    if (missingScopes.length > 0) {
      const availability: CapabilityAvailability = 'PERMISSION_REQUIRED';
      return {
        ...cap,
        requiredScopes: effectiveRequired,
        availability,
        grantedScopes: granted,
        missingScopes,
        reauthorizationRequired: true,
        reason: `Missing OAuth scope(s): ${missingScopes.join(', ')}. Use incremental authorization to grant only these permissions.`,
      };
    }

    if (cap.requiresAppsScriptUserSetting && appsScriptApiToggleConfirmed === false) {
      return {
        ...cap,
        requiredScopes: effectiveRequired,
        availability: 'USER_AUTHORIZATION_REQUIRED',
        grantedScopes: granted,
        missingScopes: [],
        reauthorizationRequired: false,
        reason:
          'Google requires the connected user to turn ON "Google Apps Script API" at https://script.google.com/home/usersettings.',
      };
    }

    return {
      ...cap,
      requiredScopes: effectiveRequired,
      availability: 'AVAILABLE',
      grantedScopes: granted,
      missingScopes: [],
      reauthorizationRequired: false,
      reason:
        cap.id === 'apps_script_execution' && scriptManifestScopes.length === 0
          ? 'Project scope granted; select a target script manifest & API Executable deployment to inspect execution scopes.'
          : 'Authorized and ready.',
    };
  });
}
