import type { AppsScriptFile } from '@/types/domain';
import { inferImpliedScopesFromSource, parseAndValidateManifest } from './manifest';

export interface ValidationDiagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  file: string;
  line?: number;
  message: string;
}

export interface ProjectValidationReport {
  valid: boolean;
  hasHighRiskPatterns: boolean;
  discoveredFunctions: string[];
  declaredScopes: string[];
  impliedScopes: string[];
  diagnostics: ValidationDiagnostic[];
  staticAnalysisDisclaimer: string;
}

const STATIC_ANALYSIS_DISCLAIMER =
  'Static analysis checks manifest syntax, file structure, scope alignment, and common risky patterns without executing script code. Passing static validation does not guarantee runtime correctness or safety.';

function findLineNumber(source: string, pattern: RegExp): number | undefined {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i]!)) {
      return i + 1;
    }
  }
  return undefined;
}

export function validateAppsScriptProject(params: {
  scriptId?: string;
  files: AppsScriptFile[];
}): ProjectValidationReport {
  const { scriptId, files } = params;
  const diagnostics: ValidationDiagnostic[] = [];

  if (scriptId !== undefined && (!scriptId || scriptId.trim().length < 6)) {
    diagnostics.push({
      severity: 'error',
      code: 'INVALID_SCRIPT_ID',
      file: 'project',
      message: 'Project scriptId is missing or shorter than 6 characters.',
    });
  }

  if (!Array.isArray(files) || files.length === 0) {
    diagnostics.push({
      severity: 'error',
      code: 'EMPTY_PROJECT_FILES',
      file: 'project',
      message: 'Apps Script project must contain at least appsscript.json.',
    });
    return {
      valid: false,
      hasHighRiskPatterns: false,
      discoveredFunctions: [],
      declaredScopes: [],
      impliedScopes: [],
      diagnostics,
      staticAnalysisDisclaimer: STATIC_ANALYSIS_DISCLAIMER,
    };
  }

  // 1. Validate filenames & required manifest
  const seenNames = new Set<string>();
  let manifestFile: AppsScriptFile | undefined;

  for (const file of files) {
    const cleanName = file.name.trim();
    if (!cleanName || /[\\]|\.\./.test(cleanName)) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_FILE_NAME',
        file: file.name,
        message: `Invalid file name "${file.name}".`,
      });
    }
    const dedupeKey = `${file.type}:${cleanName}`;
    if (seenNames.has(dedupeKey)) {
      diagnostics.push({
        severity: 'error',
        code: 'DUPLICATE_FILE_NAME',
        file: cleanName,
        message: `Duplicate file "${cleanName}" of type ${file.type}.`,
      });
    }
    seenNames.add(dedupeKey);

    if (cleanName === 'appsscript' || cleanName === 'appsscript.json') {
      if (file.type !== 'JSON') {
        diagnostics.push({
          severity: 'error',
          code: 'INVALID_MANIFEST_TYPE',
          file: cleanName,
          message: 'Manifest file appsscript must use file type JSON.',
        });
      }
      manifestFile = file;
    }
  }

  if (!manifestFile) {
    diagnostics.push({
      severity: 'error',
      code: 'MISSING_MANIFEST',
      file: 'appsscript.json',
      message: 'Mandatory manifest file "appsscript" (appsscript.json) is missing.',
    });
  }

  // 2. Validate manifest JSON & structure
  let declaredScopes: string[] = [];
  if (manifestFile) {
    const manifestResult = parseAndValidateManifest(manifestFile.source);
    for (const err of manifestResult.errors) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_MANIFEST',
        file: manifestFile.name,
        message: err,
      });
    }
    for (const warn of manifestResult.warnings) {
      diagnostics.push({
        severity: 'warning',
        code: 'MANIFEST_SECURITY_WARNING',
        file: manifestFile.name,
        message: warn,
      });
    }
    declaredScopes = manifestResult.manifest?.oauthScopes || [];
  }

  // 3. Static code checks across SERVER_JS & HTML template references
  const htmlNames = new Set(
    files
      .filter((f) => f.type === 'HTML')
      .map((f) => f.name.replace(/\.html$/i, '')),
  );

  const functionRegistry = new Map<string, string>();
  const discoveredFunctions: string[] = [];
  let hasHighRiskPatterns = false;

  const fnRegex = /^\s*function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/;

  for (const file of files) {
    if (file.type !== 'SERVER_JS') continue;
    const lines = file.source.split('\n');

    lines.forEach((lineText, idx) => {
      const lineNum = idx + 1;
      const fnMatch = fnRegex.exec(lineText);
      if (fnMatch) {
        const fnName = fnMatch[1]!;
        const prevFile = functionRegistry.get(fnName);
        if (prevFile) {
          diagnostics.push({
            severity: 'warning',
            code: 'DUPLICATE_FUNCTION_NAME',
            file: file.name,
            line: lineNum,
            message: `Top-level function "${fnName}" is already declared in "${prevFile}". Apps Script shares global namespace across .gs files.`,
          });
        } else {
          functionRegistry.set(fnName, file.name);
          discoveredFunctions.push(fnName);
        }
      }

      // Check HtmlService references
      const htmlRef = /createHtmlOutputFromFile\(\s*['"]([^'"]+)['"]\s*\)|createTemplateFromFile\(\s*['"]([^'"]+)['"]\s*\)/.exec(
        lineText,
      );
      if (htmlRef) {
        const target = (htmlRef[1] || htmlRef[2] || '').replace(/\.html$/i, '');
        if (target && !htmlNames.has(target)) {
          diagnostics.push({
            severity: 'error',
            code: 'MISSING_HTML_TEMPLATE',
            file: file.name,
            line: lineNum,
            message: `Referenced HTML file "${target}" is missing from the project.`,
          });
        }
      }
    });

    // Check risky or side-effecting operations cleanly without executing code
    const checks: Array<{
      pattern: RegExp;
      severity: ValidationDiagnostic['severity'];
      code: string;
      message: string;
      highRisk?: boolean;
    }> = [
      {
        pattern: /\beval\s*\(|new\s+Function\s*\(/,
        severity: 'error',
        code: 'UNSAFE_DYNAMIC_EVAL',
        message: 'Dynamic eval() or new Function() execution is prohibited.',
        highRisk: true,
      },
      {
        pattern: /\bwhile\s*\(\s*true\s*\)|\bfor\s*\(\s*;\s*;\s*\)/,
        severity: 'warning',
        code: 'UNBOUNDED_LOOP_RISK',
        message: 'Unbounded loop construct detected; Apps Script enforces a strict 6-minute execution limit.',
        highRisk: true,
      },
      {
        pattern: /\.(?:setTrashed|removeFile|removeFolder|deleteSheet|deleteRow|clearContents)\s*\(/,
        severity: 'warning',
        code: 'DESTRUCTIVE_WRITE_OPERATION',
        message: 'Destructive or data-mutating operation detected; require explicit owner approval before automated execution.',
        highRisk: true,
      },
      {
        pattern: /\b(?:MailApp|GmailApp)\.sendEmail\s*\(/,
        severity: 'warning',
        code: 'OUTBOUND_EMAIL_OPERATION',
        message: 'Outbound email sending detected; review recipients and require confirmation before trigger automation.',
        highRisk: true,
      },
      {
        pattern: /\bUrlFetchApp\.fetch(?:All)?\s*\(/,
        severity: 'info',
        code: 'EXTERNAL_URL_FETCH',
        message: 'External HTTP call via UrlFetchApp detected (requires script.external_request scope).',
      },
      {
        pattern: /\b(?:SpreadsheetApp|DriveApp)\.(?:create|openById|getFileById)\b/,
        severity: 'info',
        code: 'WORKSPACE_RESOURCE_ACCESS',
        message: 'Google Workspace data access detected; verify least-privilege manifest scopes.',
      },
    ];

    for (const check of checks) {
      if (check.pattern.test(file.source)) {
        if (check.highRisk) hasHighRiskPatterns = true;
        diagnostics.push({
          severity: check.severity,
          code: check.code,
          file: file.name,
          line: findLineNumber(file.source, check.pattern),
          message: check.message,
        });
      }
    }
  }

  // 4. Compare implied vs declared oauthScopes
  const impliedScopes = inferImpliedScopesFromSource(files);
  if (declaredScopes.length > 0) {
    const declaredSet = new Set(declaredScopes);
    for (const imp of impliedScopes) {
      if (!declaredSet.has(imp)) {
        diagnostics.push({
          severity: 'warning',
          code: 'UNDECLARED_IMPLIED_SCOPE',
          file: manifestFile?.name || 'appsscript.json',
          message: `Script code references services typically requiring scope "${imp}", which is not explicitly listed in appsscript.json.`,
        });
      }
    }
  }

  const hasErrors = diagnostics.some((d) => d.severity === 'error');
  return {
    valid: !hasErrors,
    hasHighRiskPatterns,
    discoveredFunctions,
    declaredScopes,
    impliedScopes,
    diagnostics,
    staticAnalysisDisclaimer: STATIC_ANALYSIS_DISCLAIMER,
  };
}
