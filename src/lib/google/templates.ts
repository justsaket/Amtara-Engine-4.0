import { DEFAULT_WORKSPACE_TIMEZONE } from '@/lib/validation';
import type { AppsScriptFile } from '@/types/domain';
import { buildDefaultManifest, serializeManifest } from './manifest';

export interface AppsScriptProjectTemplate {
  key: string;
  name: string;
  category: 'foundation' | 'monitoring' | 'sheets' | 'drive' | 'scheduler' | 'webapp' | 'executable';
  purpose: string;
  requiredScopes: string[];
  requiredParameters: Array<{ name: string; type: string; description: string }>;
  recommendedDeploymentType: 'API_EXECUTABLE' | 'WEB_APP' | 'STANDALONE_TRIGGER';
  risksAndLimitations: string;
  validationNotes: string[];
  testFunctionName: string;
  defaultVersionDescription: string;
  buildFiles: (timezone?: string) => AppsScriptFile[];
}

export const APPS_SCRIPT_TEMPLATES: readonly AppsScriptProjectTemplate[] = [
  {
    key: 'antara_base_automation',
    name: 'Antara Base Automation Project',
    category: 'foundation',
    purpose:
      'Minimal, verified baseline project with health-ping execution target, safe structured JSON responses, and idempotent Antara trigger installer helpers.',
    requiredScopes: ['https://www.googleapis.com/auth/script.scriptapp'],
    requiredParameters: [],
    recommendedDeploymentType: 'API_EXECUTABLE',
    risksAndLimitations:
      'Contains Antara-owned trigger prefix __antara_trigger_ so existing user triggers are never altered.',
    validationNotes: ['Includes appsscript.json in V8 runtime', 'Zero external network calls by default'],
    testFunctionName: 'antaraPingHealth',
    defaultVersionDescription: 'Initial Antara Base Automation baseline',
    buildFiles: (tz = DEFAULT_WORKSPACE_TIMEZONE) => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: serializeManifest(
          buildDefaultManifest({
            timeZone: tz,
            oauthScopes: ['https://www.googleapis.com/auth/script.scriptapp'],
            includeExecutionApi: true,
          }),
        ),
      },
      {
        name: 'Code',
        type: 'SERVER_JS',
        source: `/**
 * Antara Engine 4.0 - Base Automation Runtime
 * Safe read-only diagnostic endpoint & Antara-managed trigger helpers.
 */
function antaraPingHealth() {
  return {
    ok: true,
    service: 'antara-base-automation',
    timezone: Session.getScriptTimeZone(),
    timestamp: new Date().toISOString()
  };
}

function antaraInstallOrSyncTrigger(config) {
  var handler = (config && config.handler) || 'antaraScheduledHeartbeat';
  var hours = Number((config && config.intervalValue) || 6);
  var prefix = '__antara_trigger_';
  var props = PropertiesService.getScriptProperties();
  var propKey = prefix + handler;
  var existingId = props.getProperty(propKey);
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (existingId && triggers[i].getUniqueId() === existingId) {
      return { installed: true, triggerId: existingId, deduplicated: true };
    }
  }
  var created = ScriptApp.newTrigger(handler).timeBased().everyHours(hours).create();
  var newId = created.getUniqueId();
  props.setProperty(propKey, newId);
  return { installed: true, triggerId: newId, deduplicated: false };
}

function antaraRemoveTrigger(handler) {
  var propKey = '__antara_trigger_' + handler;
  var props = PropertiesService.getScriptProperties();
  var targetId = props.getProperty(propKey);
  var triggers = ScriptApp.getProjectTriggers();
  var removed = false;
  for (var i = 0; i < triggers.length; i++) {
    if (targetId && triggers[i].getUniqueId() === targetId) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed = true;
    }
  }
  props.deleteProperty(propKey);
  return { removed: removed };
}

function antaraScheduledHeartbeat() {
  Logger.log('Antara heartbeat ran at ' + new Date().toISOString());
}
`,
      },
    ],
  },
  {
    key: 'workspace_health_monitor',
    name: 'Google Workspace Health Monitor',
    category: 'monitoring',
    purpose:
      'Collects script timezone, active script triggers count, and quota-safe diagnostic metadata for workspace readiness verification.',
    requiredScopes: ['https://www.googleapis.com/auth/script.scriptapp'],
    requiredParameters: [],
    recommendedDeploymentType: 'API_EXECUTABLE',
    risksAndLimitations: 'Read-only status reporting; does not mutate Drive or Sheets data.',
    validationNotes: ['Uses minimal script.scriptapp metadata scope only'],
    testFunctionName: 'inspectWorkspaceScriptHealth',
    defaultVersionDescription: 'Workspace Health Monitor v1',
    buildFiles: (tz = DEFAULT_WORKSPACE_TIMEZONE) => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: serializeManifest(
          buildDefaultManifest({
            timeZone: tz,
            oauthScopes: ['https://www.googleapis.com/auth/script.scriptapp'],
            includeExecutionApi: true,
          }),
        ),
      },
      {
        name: 'HealthMonitor',
        type: 'SERVER_JS',
        source: `function inspectWorkspaceScriptHealth() {
  var triggers = ScriptApp.getProjectTriggers();
  return {
    ok: true,
    timezone: Session.getScriptTimeZone(),
    triggerCount: triggers.length,
    checkedAt: new Date().toISOString()
  };
}
`,
      },
    ],
  },
  {
    key: 'sheets_reporting_automation',
    name: 'Google Sheets Reporting Automation',
    category: 'sheets',
    purpose:
      'Appends structured timestamped summary rows into an explicitly supplied target Spreadsheet ID and tab name.',
    requiredScopes: ['https://www.googleapis.com/auth/spreadsheets'],
    requiredParameters: [
      { name: 'spreadsheetId', type: 'string', description: 'Target Google Spreadsheet ID' },
      { name: 'sheetName', type: 'string', description: 'Worksheet tab name' },
    ],
    recommendedDeploymentType: 'API_EXECUTABLE',
    risksAndLimitations:
      'Writes rows to the specified Spreadsheet ID. Requires explicit confirmation before automated runs.',
    validationNotes: ['Explicit spreadsheetId parameter required (never scans unknown spreadsheets)'],
    testFunctionName: 'verifyTargetSpreadsheetAccess',
    defaultVersionDescription: 'Sheets Reporting Automation v1',
    buildFiles: (tz = DEFAULT_WORKSPACE_TIMEZONE) => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: serializeManifest(
          buildDefaultManifest({
            timeZone: tz,
            oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'],
            includeExecutionApi: true,
          }),
        ),
      },
      {
        name: 'SheetsReporting',
        type: 'SERVER_JS',
        source: `function verifyTargetSpreadsheetAccess(spreadsheetId) {
  if (!spreadsheetId) throw new Error('spreadsheetId is required.');
  var ss = SpreadsheetApp.openById(String(spreadsheetId));
  return {
    ok: true,
    title: ss.getName(),
    sheetCount: ss.getSheets().length
  };
}

function appendStructuredReportRow(spreadsheetId, sheetName, rowValues) {
  if (!spreadsheetId || !sheetName) {
    throw new Error('spreadsheetId and sheetName are required.');
  }
  var ss = SpreadsheetApp.openById(String(spreadsheetId));
  var sheet = ss.getSheetByName(String(sheetName));
  if (!sheet) throw new Error('Target sheet tab not found: ' + sheetName);
  var row = Array.isArray(rowValues) ? rowValues : [new Date().toISOString(), String(rowValues || '')];
  sheet.appendRow(row);
  return { ok: true, appendedColumns: row.length, updatedAt: new Date().toISOString() };
}
`,
      },
    ],
  },
  {
    key: 'drive_organization_helper',
    name: 'Google Drive Organization Helper',
    category: 'drive',
    purpose:
      'Reads metadata of an explicitly selected Drive folder ID and summarizes child file counts without moving or deleting files automatically.',
    requiredScopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'],
    requiredParameters: [
      { name: 'folderId', type: 'string', description: 'Target Drive folder ID' },
    ],
    recommendedDeploymentType: 'API_EXECUTABLE',
    risksAndLimitations: 'Metadata read-only by default (drive.metadata.readonly) for safe inspection.',
    validationNotes: ['Zero file deletion or permission mutation'],
    testFunctionName: 'summarizeDriveFolderMetadata',
    defaultVersionDescription: 'Drive Metadata Inspector v1',
    buildFiles: (tz = DEFAULT_WORKSPACE_TIMEZONE) => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: serializeManifest(
          buildDefaultManifest({
            timeZone: tz,
            oauthScopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'],
            includeExecutionApi: true,
          }),
        ),
      },
      {
        name: 'DriveOrganizer',
        type: 'SERVER_JS',
        source: `function summarizeDriveFolderMetadata(folderId) {
  if (!folderId) throw new Error('folderId is required.');
  var folder = DriveApp.getFolderById(String(folderId));
  var iter = folder.getFiles();
  var count = 0;
  var samples = [];
  while (iter.hasNext() && count < 200) {
    var f = iter.next();
    count += 1;
    if (samples.length < 15) {
      samples.push({ id: f.getId(), name: f.getName(), mimeType: f.getMimeType() });
    }
  }
  return {
    ok: true,
    folderName: folder.getName(),
    inspectedCount: count,
    samples: samples
  };
}
`,
      },
    ],
  },
  {
    key: 'sheets_data_processing_helper',
    name: 'Google Sheets Data Processing Helper',
    category: 'sheets',
    purpose:
      'Normalizes and trims text cells within an explicitly bounded range inside a target Spreadsheet.',
    requiredScopes: ['https://www.googleapis.com/auth/spreadsheets'],
    requiredParameters: [
      { name: 'spreadsheetId', type: 'string', description: 'Spreadsheet ID' },
      { name: 'rangeA1', type: 'string', description: 'A1 range notation (e.g. Sheet1!A2:D50)' },
    ],
    recommendedDeploymentType: 'API_EXECUTABLE',
    risksAndLimitations: 'Mutates values inside the specified A1 range; requires owner approval.',
    validationNotes: ['Requires explicit spreadsheetId and rangeA1'],
    testFunctionName: 'previewSheetRangeDimensions',
    defaultVersionDescription: 'Sheets Data Processor v1',
    buildFiles: (tz = DEFAULT_WORKSPACE_TIMEZONE) => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: serializeManifest(
          buildDefaultManifest({
            timeZone: tz,
            oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'],
            includeExecutionApi: true,
          }),
        ),
      },
      {
        name: 'SheetProcessor',
        type: 'SERVER_JS',
        source: `function previewSheetRangeDimensions(spreadsheetId, rangeA1) {
  var ss = SpreadsheetApp.openById(String(spreadsheetId));
  var range = ss.getRange(String(rangeA1));
  return {
    ok: true,
    rows: range.getNumRows(),
    columns: range.getNumColumns()
  };
}

function normalizeSheetRangeWhitespace(spreadsheetId, rangeA1) {
  var ss = SpreadsheetApp.openById(String(spreadsheetId));
  var range = ss.getRange(String(rangeA1));
  var values = range.getValues();
  var updated = values.map(function (row) {
    return row.map(function (cell) {
      return typeof cell === 'string' ? cell.trim() : cell;
    });
  });
  range.setValues(updated);
  return { ok: true, normalizedRows: updated.length };
}
`,
      },
    ],
  },
  {
    key: 'workspace_scheduled_task_runner',
    name: 'Google Workspace Scheduled Task Runner',
    category: 'scheduler',
    purpose:
      'Provides an Antara-managed scheduled execution loop with PropertiesService execution timestamps and duplicate-trigger guards.',
    requiredScopes: ['https://www.googleapis.com/auth/script.scriptapp'],
    requiredParameters: [],
    recommendedDeploymentType: 'STANDALONE_TRIGGER',
    risksAndLimitations: 'Respects Google Apps Script daily trigger quota ceilings.',
    validationNotes: ['Includes timezone configuration defaulted to Asia/Kolkata'],
    testFunctionName: 'runScheduledMaintenanceTask',
    defaultVersionDescription: 'Scheduled Task Runner v1',
    buildFiles: (tz = DEFAULT_WORKSPACE_TIMEZONE) => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: serializeManifest(
          buildDefaultManifest({
            timeZone: tz,
            oauthScopes: ['https://www.googleapis.com/auth/script.scriptapp'],
            includeExecutionApi: true,
          }),
        ),
      },
      {
        name: 'Scheduler',
        type: 'SERVER_JS',
        source: `function runScheduledMaintenanceTask() {
  var props = PropertiesService.getScriptProperties();
  var now = new Date().toISOString();
  props.setProperty('ANTARA_LAST_SCHEDULED_RUN', now);
  return { ok: true, lastRun: now, timezone: Session.getScriptTimeZone() };
}
`,
      },
    ],
  },
  {
    key: 'antara_web_app_starter',
    name: 'Antara Web App Starter',
    category: 'webapp',
    purpose:
      'Private-by-default Google Apps Script Web App starter (access: MYSELF, executeAs: USER_DEPLOYING) with verified HTML output rendering.',
    requiredScopes: [],
    requiredParameters: [],
    recommendedDeploymentType: 'WEB_APP',
    risksAndLimitations:
      'Access defaults strictly to MYSELF; public exposure requires explicit owner authorization.',
    validationNotes: ['Matches WebApp.gs template reference to index.html cleanly'],
    testFunctionName: 'getWebAppDiagnostic',
    defaultVersionDescription: 'Antara Web App Starter v1',
    buildFiles: (tz = DEFAULT_WORKSPACE_TIMEZONE) => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: serializeManifest(
          buildDefaultManifest({
            timeZone: tz,
            includeWebApp: true,
            accessLevel: 'MYSELF',
            executeAs: 'USER_DEPLOYING',
          }),
        ),
      },
      {
        name: 'WebApp',
        type: 'SERVER_JS',
        source: `function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Antara Managed Web App');
}

function getWebAppDiagnostic() {
  return {
    ok: true,
    timezone: Session.getScriptTimeZone(),
    timestamp: new Date().toISOString()
  };
}
`,
      },
      {
        name: 'index',
        type: 'HTML',
        source: `<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <style>
      body { font-family: sans-serif; margin: 40px; color: #0f172a; }
      .panel { max-width: 560px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; }
    </style>
  </head>
  <body>
    <div class="panel">
      <h1>Antara Managed Web App</h1>
      <p>Deployed and verified via Antara Engine 4.0 Control Plane.</p>
    </div>
  </body>
</html>
`,
      },
    ],
  },
  {
    key: 'antara_api_executable_starter',
    name: 'Antara API Executable Starter',
    category: 'executable',
    purpose:
      'Configured with executionApi access MYSELF so Antara Execution Center can call allowlisted functions cleanly via scripts.run.',
    requiredScopes: ['https://www.googleapis.com/auth/script.projects'],
    requiredParameters: [
      { name: 'payload', type: 'object', description: 'Optional structured input metadata' },
    ],
    recommendedDeploymentType: 'API_EXECUTABLE',
    risksAndLimitations:
      'Caller and target script must share the configured Google Cloud Platform project number for scripts.run.',
    validationNotes: ['Includes executionApi: { access: "MYSELF" } in appsscript.json'],
    testFunctionName: 'executeAntaraProbe',
    defaultVersionDescription: 'API Executable Starter v1',
    buildFiles: (tz = DEFAULT_WORKSPACE_TIMEZONE) => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: serializeManifest(
          buildDefaultManifest({
            timeZone: tz,
            oauthScopes: ['https://www.googleapis.com/auth/script.projects'],
            includeExecutionApi: true,
          }),
        ),
      },
      {
        name: 'ApiExecutable',
        type: 'SERVER_JS',
        source: `function executeAntaraProbe(payload) {
  return {
    ok: true,
    echoed: payload || null,
    timezone: Session.getScriptTimeZone(),
    executedAt: new Date().toISOString()
  };
}
`,
      },
    ],
  },
] as const;

export function getAppsScriptTemplate(key: string): AppsScriptProjectTemplate | null {
  return APPS_SCRIPT_TEMPLATES.find((t) => t.key === key) || null;
}
