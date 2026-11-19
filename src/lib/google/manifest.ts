import { DEFAULT_WORKSPACE_TIMEZONE, appsScriptManifestSchema } from '@/lib/validation';
import type { WebAppAccessLevel, WebAppExecuteAs } from '@/types/domain';

export interface ParsedAppsScriptManifest {
  timeZone: string;
  runtimeVersion: 'V8' | 'DEPRECATED_ES5';
  exceptionLogging: 'STACKDRIVER' | 'NONE';
  oauthScopes?: string[];
  dependencies?: Record<string, unknown>;
  webapp?: {
    access: WebAppAccessLevel;
    executeAs: WebAppExecuteAs;
  };
  executionApi?: {
    access: 'MYSELF' | 'DOMAIN' | 'ANYONE';
  };
  [key: string]: unknown;
}

export interface ManifestValidationResult {
  valid: boolean;
  manifest: ParsedAppsScriptManifest | null;
  errors: string[];
  warnings: string[];
  publicAccessWarning: boolean;
}

export function buildDefaultManifest(options?: {
  timeZone?: string;
  oauthScopes?: string[];
  includeWebApp?: boolean;
  includeExecutionApi?: boolean;
  accessLevel?: WebAppAccessLevel;
  executeAs?: WebAppExecuteAs;
}): ParsedAppsScriptManifest {
  const manifest: ParsedAppsScriptManifest = {
    timeZone: options?.timeZone || DEFAULT_WORKSPACE_TIMEZONE,
    runtimeVersion: 'V8',
    exceptionLogging: 'STACKDRIVER',
  };

  if (options?.oauthScopes && options.oauthScopes.length > 0) {
    manifest.oauthScopes = Array.from(new Set(options.oauthScopes));
  }

  if (options?.includeWebApp) {
    manifest.webapp = {
      access: options.accessLevel || 'MYSELF',
      executeAs: options.executeAs || 'USER_DEPLOYING',
    };
  }

  if (options?.includeExecutionApi) {
    manifest.executionApi = {
      access: 'MYSELF',
    };
  }

  return manifest;
}

export function serializeManifest(manifest: ParsedAppsScriptManifest): string {
  return JSON.stringify(manifest, null, 2);
}

export function parseAndValidateManifest(rawSource: string): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!rawSource || !rawSource.trim()) {
    return {
      valid: false,
      manifest: null,
      errors: ['Manifest file appsscript.json cannot be empty.'],
      warnings,
      publicAccessWarning: false,
    };
  }

  let parsedRaw: Record<string, unknown>;
  try {
    parsedRaw = JSON.parse(rawSource) as Record<string, unknown>;
  } catch (err) {
    return {
      valid: false,
      manifest: null,
      errors: [
        `Malformed JSON in appsscript.json: ${err instanceof Error ? err.message : 'Syntax error'}.`,
      ],
      warnings,
      publicAccessWarning: false,
    };
  }

  if (!parsedRaw || typeof parsedRaw !== 'object' || Array.isArray(parsedRaw)) {
    return {
      valid: false,
      manifest: null,
      errors: ['appsscript.json root must be a JSON object.'],
      warnings,
      publicAccessWarning: false,
    };
  }

  const zodCheck = appsScriptManifestSchema.safeParse(parsedRaw);
  if (!zodCheck.success) {
    for (const issue of zodCheck.error.issues) {
      errors.push(`${issue.path.join('.') || 'manifest'}: ${issue.message}`);
    }
  }

  if (parsedRaw.runtimeVersion === 'DEPRECATED_ES5') {
    warnings.push('Legacy Rhino runtime (DEPRECATED_ES5) detected; V8 runtime is strongly recommended.');
  }

  const webapp = parsedRaw.webapp as
    | { access?: string; executeAs?: string }
    | undefined;
  let publicAccessWarning = false;

  if (webapp) {
    if (webapp.access === 'ANYONE' || webapp.access === 'ANYONE_ANONYMOUS') {
      publicAccessWarning = true;
      warnings.push(
        `Public Web App access (${webapp.access}) exposes this deployment outside private organization boundaries and requires explicit owner confirmation.`,
      );
    }
    if (webapp.executeAs === 'USER_DEPLOYING' && webapp.access === 'ANYONE_ANONYMOUS') {
      warnings.push(
        'High risk: ANYONE_ANONYMOUS paired with USER_DEPLOYING runs code with the deploying owner credentials for unauthenticated callers.',
      );
    }
  }

  const manifest: ParsedAppsScriptManifest = {
    ...parsedRaw,
    timeZone:
      typeof parsedRaw.timeZone === 'string'
        ? parsedRaw.timeZone
        : DEFAULT_WORKSPACE_TIMEZONE,
    runtimeVersion:
      parsedRaw.runtimeVersion === 'DEPRECATED_ES5' ? 'DEPRECATED_ES5' : 'V8',
    exceptionLogging:
      parsedRaw.exceptionLogging === 'NONE' ? 'NONE' : 'STACKDRIVER',
  };

  return {
    valid: errors.length === 0,
    manifest,
    errors,
    warnings,
    publicAccessWarning,
  };
}

/**
 * Extracts explicit Apps Script OAuth scopes implied by static service calls so
 * manifest oauthScopes can be verified cleanly against code requirements.
 */
export function inferImpliedScopesFromSource(files: ReadonlyArray<{ type: string; source: string }>): string[] {
  const combined = files
    .filter((f) => f.type === 'SERVER_JS')
    .map((f) => f.source)
    .join('\n');

  const implied = new Set<string>();
  if (/\bUrlFetchApp\./.test(combined)) {
    implied.add('https://www.googleapis.com/auth/script.external_request');
  }
  if (/\bSpreadsheetApp\./.test(combined)) {
    implied.add('https://www.googleapis.com/auth/spreadsheets');
  }
  if (/\bDriveApp\./.test(combined)) {
    implied.add('https://www.googleapis.com/auth/drive');
  }
  if (/\b(?:MailApp|GmailApp)\./.test(combined)) {
    implied.add('https://www.googleapis.com/auth/gmail.send');
  }
  if (/\bDocumentApp\./.test(combined)) {
    implied.add('https://www.googleapis.com/auth/documents');
  }
  if (/\bCalendarApp\./.test(combined)) {
    implied.add('https://www.googleapis.com/auth/calendar');
  }
  if (/\bScriptApp\.newTrigger\b/.test(combined)) {
    implied.add('https://www.googleapis.com/auth/script.scriptapp');
  }
  return Array.from(implied);
}
