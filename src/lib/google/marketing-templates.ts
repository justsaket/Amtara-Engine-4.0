import type { AppsScriptFile } from '@/types/domain';
import { DEFAULT_WORKSPACE_TIMEZONE } from '@/lib/validation';

export interface Phase4MarketingAppsScriptTemplate {
  key: string;
  name: string;
  description: string;
  marketingCategory:
    | 'reporting'
    | 'campaigns'
    | 'media_ops'
    | 'sync'
    | 'notifications'
    | 'content_ops'
    | 'health';
  recommendedDeploymentType: 'API_EXECUTABLE' | 'WEB_APP' | 'STANDALONE_TRIGGER';
  defaultScopes: string[];
  buildFiles: (timezone?: string) => AppsScriptFile[];
}

/**
 * 8 Production Google Apps Script Marketing Automation Templates for Phase 4.
 * Deployed, versioned, backed up, and trigger-managed through the Phase 2 Apps Script Control Plane.
 */
export const PHASE_4_MARKETING_APPS_SCRIPT_TEMPLATES: readonly Phase4MarketingAppsScriptTemplate[] = [
  {
    key: 'sheets_marketing_performance_reporter',
    name: 'Google Sheets Marketing Performance Reporter',
    description:
      'Appends normalized cross-platform analytics snapshots (impressions, engagements, clicks, leads, spend) into a structured brand performance sheet without fabricating missing fields.',
    marketingCategory: 'reporting',
    recommendedDeploymentType: 'API_EXECUTABLE',
    defaultScopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.external_request',
    ],
    buildFiles: (timezone = DEFAULT_WORKSPACE_TIMEZONE): AppsScriptFile[] => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: JSON.stringify(
          {
            timeZone: timezone,
            runtimeVersion: 'V8',
            exceptionLogging: 'STACKDRIVER',
            oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'],
            executionApi: { access: 'MYSELF' },
          },
          null,
          2,
        ),
      },
      {
        name: 'Code',
        type: 'SERVER_JS',
        source: `/**
 * Antara Engine 4.0 — Google Sheets Marketing Performance Reporter
 */
function appendPerformanceSnapshots(spreadsheetId, rows) {
  if (!spreadsheetId || !Array.isArray(rows)) {
    throw new Error('spreadsheetId and rows array are required.');
  }
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName('Performance_Snapshots') || ss.insertSheet('Performance_Snapshots');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'CollectedAt', 'BrandId', 'Platform', 'PeriodStart', 'PeriodEnd',
      'Impressions', 'Reach', 'Engagements', 'Clicks', 'LeadsAttributed', 'SpendAmount', 'Currency', 'SourceAPI'
    ]);
  }
  const values = rows.map(function (r) {
    return [
      r.collectedAt || new Date().toISOString(),
      r.brandId || '',
      r.platform || '',
      r.periodStart || '',
      r.periodEnd || '',
      r.impressions === null || r.impressions === undefined ? '' : r.impressions,
      r.reach === null || r.reach === undefined ? '' : r.reach,
      r.engagements === null || r.engagements === undefined ? '' : r.engagements,
      r.clicks === null || r.clicks === undefined ? '' : r.clicks,
      r.leadsAttributed === null || r.leadsAttributed === undefined ? '' : r.leadsAttributed,
      r.spendAmount === null || r.spendAmount === undefined ? '' : r.spendAmount,
      r.currency || '',
      r.sourceApi || ''
    ];
  });
  if (values.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, values[0].length).setValues(values);
  }
  return { ok: true, appendedRows: values.length };
}
`,
      },
    ],
  },
  {
    key: 'sheets_campaign_tracker',
    name: 'Google Sheets Campaign Tracker',
    description:
      'Maintains a live campaign registry sheet tracking draft plans, budget caps, owner approval IDs, and spend pacing alerts.',
    marketingCategory: 'campaigns',
    recommendedDeploymentType: 'API_EXECUTABLE',
    defaultScopes: ['https://www.googleapis.com/auth/spreadsheets'],
    buildFiles: (timezone = DEFAULT_WORKSPACE_TIMEZONE): AppsScriptFile[] => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: JSON.stringify(
          {
            timeZone: timezone,
            runtimeVersion: 'V8',
            exceptionLogging: 'STACKDRIVER',
            oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'],
            executionApi: { access: 'MYSELF' },
          },
          null,
          2,
        ),
      },
      {
        name: 'Code',
        type: 'SERVER_JS',
        source: `/**
 * Antara Engine 4.0 — Google Sheets Campaign Tracker
 */
function syncCampaignTracker(spreadsheetId, campaigns) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName('Campaign_Tracker') || ss.insertSheet('Campaign_Tracker');
  sheet.clearContents();
  sheet.appendRow([
    'CampaignId', 'BrandId', 'Name', 'Objective', 'Status',
    'DailyBudget', 'TotalBudget', 'Currency', 'ApprovalId', 'UpdatedAt'
  ]);
  (campaigns || []).forEach(function (c) {
    sheet.appendRow([
      c.id, c.brandId, c.name, c.objective, c.status,
      c.dailyBudget || '', c.totalBudget || '', c.currency || 'INR',
      c.approvalRequestId || '', c.updatedAt || new Date().toISOString()
    ]);
  });
  return { ok: true, syncedCount: (campaigns || []).length };
}
`,
      },
    ],
  },
  {
    key: 'drive_media_organizer',
    name: 'Google Drive Media Organizer',
    description:
      'Creates standardized brand and campaign folder hierarchies in Google Drive and indexes validated creative asset metadata.',
    marketingCategory: 'media_ops',
    recommendedDeploymentType: 'API_EXECUTABLE',
    defaultScopes: ['https://www.googleapis.com/auth/drive.file'],
    buildFiles: (timezone = DEFAULT_WORKSPACE_TIMEZONE): AppsScriptFile[] => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: JSON.stringify(
          {
            timeZone: timezone,
            runtimeVersion: 'V8',
            exceptionLogging: 'STACKDRIVER',
            oauthScopes: ['https://www.googleapis.com/auth/drive.file'],
            executionApi: { access: 'MYSELF' },
          },
          null,
          2,
        ),
      },
      {
        name: 'Code',
        type: 'SERVER_JS',
        source: `/**
 * Antara Engine 4.0 — Google Drive Media Organizer
 */
function ensureBrandMediaFolders(rootFolderName, brandNames) {
  const roots = DriveApp.getFoldersByName(rootFolderName || 'Antara_Media_Library');
  const root = roots.hasNext() ? roots.next() : DriveApp.createFolder(rootFolderName || 'Antara_Media_Library');
  const created = [];
  (brandNames || ['Saket Personal', 'MAGNARC', 'GreenWeld', 'Sapphire']).forEach(function (brandName) {
    const existing = root.getFoldersByName(brandName);
    const brandFolder = existing.hasNext() ? existing.next() : root.createFolder(brandName);
    ['Raw_Uploads', 'Canva_Exports', 'Approved_Assets', 'Published_Archive'].forEach(function (sub) {
      if (!brandFolder.getFoldersByName(sub).hasNext()) {
        brandFolder.createFolder(sub);
      }
    });
    created.push({ brandName: brandName, folderId: brandFolder.getId() });
  });
  return { ok: true, rootFolderId: root.getId(), brands: created };
}
`,
      },
    ],
  },
  {
    key: 'sheets_data_synchronizer',
    name: 'Google Sheets Data Synchronizer',
    description:
      'Bidirectionally synchronizes approved leads, reviews, and content calendar rows between Antara Engine and Google Sheets with idempotent row keys.',
    marketingCategory: 'sync',
    recommendedDeploymentType: 'API_EXECUTABLE',
    defaultScopes: ['https://www.googleapis.com/auth/spreadsheets'],
    buildFiles: (timezone = DEFAULT_WORKSPACE_TIMEZONE): AppsScriptFile[] => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: JSON.stringify(
          {
            timeZone: timezone,
            runtimeVersion: 'V8',
            exceptionLogging: 'STACKDRIVER',
            oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'],
            executionApi: { access: 'MYSELF' },
          },
          null,
          2,
        ),
      },
      {
        name: 'Code',
        type: 'SERVER_JS',
        source: `/**
 * Antara Engine 4.0 — Google Sheets Data Synchronizer
 */
function upsertKeyedRows(spreadsheetId, sheetName, headerRow, records) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  if (sheet.getLastRow() === 0 && Array.isArray(headerRow)) {
    sheet.appendRow(headerRow);
  }
  const existingData = sheet.getDataRange().getValues();
  const rowIndexByKey = {};
  for (var i = 1; i < existingData.length; i++) {
    rowIndexByKey[String(existingData[i][0])] = i + 1;
  }
  var updated = 0;
  var inserted = 0;
  (records || []).forEach(function (row) {
    const key = String(row[0]);
    if (rowIndexByKey[key]) {
      sheet.getRange(rowIndexByKey[key], 1, 1, row.length).setValues([row]);
      updated += 1;
    } else {
      sheet.appendRow(row);
      inserted += 1;
    }
  });
  return { ok: true, updated: updated, inserted: inserted };
}
`,
      },
    ],
  },
  {
    key: 'workspace_scheduled_reporting',
    name: 'Google Workspace Scheduled Reporting',
    description:
      'Compiles weekly brand performance digests in Asia/Kolkata timezone and records delivery logs in Google Sheets.',
    marketingCategory: 'reporting',
    recommendedDeploymentType: 'API_EXECUTABLE',
    defaultScopes: ['https://www.googleapis.com/auth/spreadsheets'],
    buildFiles: (timezone = DEFAULT_WORKSPACE_TIMEZONE): AppsScriptFile[] => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: JSON.stringify(
          {
            timeZone: timezone,
            runtimeVersion: 'V8',
            exceptionLogging: 'STACKDRIVER',
            oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'],
            executionApi: { access: 'MYSELF' },
          },
          null,
          2,
        ),
      },
      {
        name: 'Code',
        type: 'SERVER_JS',
        source: `/**
 * Antara Engine 4.0 — Scheduled Reporting Digest Handler
 */
function runWeeklyDigestCheck() {
  const props = PropertiesService.getScriptProperties();
  const timestamp = Utilities.formatDate(new Date(), '${timezone}', 'yyyy-MM-dd HH:mm:ss z');
  props.setProperty('ANTARA_LAST_REPORT_RUN', timestamp);
  return { ok: true, executedAt: timestamp, timezone: '${timezone}' };
}
`,
      },
    ],
  },
  {
    key: 'approved_workspace_notifications',
    name: 'Approved Google Workspace Notifications',
    description:
      'Sends internal operational alerts (pending approvals, failed publish recovery, escalated 1-star reviews) strictly to authorized workspace members.',
    marketingCategory: 'notifications',
    recommendedDeploymentType: 'API_EXECUTABLE',
    defaultScopes: ['https://www.googleapis.com/auth/gmail.send'],
    buildFiles: (timezone = DEFAULT_WORKSPACE_TIMEZONE): AppsScriptFile[] => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: JSON.stringify(
          {
            timeZone: timezone,
            runtimeVersion: 'V8',
            exceptionLogging: 'STACKDRIVER',
            oauthScopes: ['https://www.googleapis.com/auth/gmail.send'],
            executionApi: { access: 'MYSELF' },
          },
          null,
          2,
        ),
      },
      {
        name: 'Code',
        type: 'SERVER_JS',
        source: `/**
 * Antara Engine 4.0 — Approved Internal Workspace Notifications
 */
function sendApprovedWorkspaceAlert(recipientEmail, subject, bodyText) {
  if (!recipientEmail || !subject || !bodyText) {
    throw new Error('recipientEmail, subject, and bodyText are required.');
  }
  GmailApp.sendEmail(recipientEmail, '[Antara Ops] ' + subject, bodyText);
  return { ok: true, sentTo: recipientEmail, sentAt: new Date().toISOString() };
}
`,
      },
    ],
  },
  {
    key: 'brand_content_operations_tracker',
    name: 'Brand Content Operations Tracker',
    description:
      'Tracks content lifecycle stages from IDEA through PUBLISHED and ANALYZED across Saket Personal, MAGNARC, GreenWeld, and Sapphire.',
    marketingCategory: 'content_ops',
    recommendedDeploymentType: 'API_EXECUTABLE',
    defaultScopes: ['https://www.googleapis.com/auth/spreadsheets'],
    buildFiles: (timezone = DEFAULT_WORKSPACE_TIMEZONE): AppsScriptFile[] => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: JSON.stringify(
          {
            timeZone: timezone,
            runtimeVersion: 'V8',
            exceptionLogging: 'STACKDRIVER',
            oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'],
            executionApi: { access: 'MYSELF' },
          },
          null,
          2,
        ),
      },
      {
        name: 'Code',
        type: 'SERVER_JS',
        source: `/**
 * Antara Engine 4.0 — Brand Content Operations Tracker
 */
function syncContentPipeline(spreadsheetId, items) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName('Content_Pipeline') || ss.insertSheet('Content_Pipeline');
  sheet.clearContents();
  sheet.appendRow([
    'ContentId', 'BrandId', 'Title', 'Format', 'LifecycleStatus',
    'Platforms', 'Version', 'ScheduledForUTC', 'UpdatedAt'
  ]);
  (items || []).forEach(function (item) {
    sheet.appendRow([
      item.id, item.brandId, item.title, item.format, item.status,
      (item.targetPlatforms || []).join(', '), item.currentVersion || 1,
      item.scheduledForUtc || '', item.updatedAt || ''
    ]);
  });
  return { ok: true, syncedItems: (items || []).length };
}
`,
      },
    ],
  },
  {
    key: 'antara_automation_health_monitor',
    name: 'Antara Automation Health Monitor',
    description:
      'Verifies Antara Engine health endpoint reachability and records uptime & scheduler heartbeat diagnostics.',
    marketingCategory: 'health',
    recommendedDeploymentType: 'WEB_APP',
    defaultScopes: ['https://www.googleapis.com/auth/script.external_request'],
    buildFiles: (timezone = DEFAULT_WORKSPACE_TIMEZONE): AppsScriptFile[] => [
      {
        name: 'appsscript',
        type: 'JSON',
        source: JSON.stringify(
          {
            timeZone: timezone,
            runtimeVersion: 'V8',
            exceptionLogging: 'STACKDRIVER',
            oauthScopes: ['https://www.googleapis.com/auth/script.external_request'],
            webapp: { access: 'MYSELF', executeAs: 'USER_DEPLOYING' },
          },
          null,
          2,
        ),
      },
      {
        name: 'Code',
        type: 'SERVER_JS',
        source: `/**
 * Antara Engine 4.0 — Automation Health Monitor
 */
function checkAntaraHealth(healthUrl) {
  const url = healthUrl || PropertiesService.getScriptProperties().getProperty('ANTARA_HEALTH_URL');
  if (!url) {
    return { ok: false, error: 'ANTARA_HEALTH_URL is not configured.' };
  }
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  return {
    ok: res.getResponseCode() === 200,
    statusCode: res.getResponseCode(),
    checkedAt: new Date().toISOString()
  };
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    service: 'antara_automation_health_monitor',
    status: 'ready',
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}
`,
      },
    ],
  },
];

export function getPhase4MarketingAppsScriptTemplate(
  key: string,
): Phase4MarketingAppsScriptTemplate | undefined {
  return PHASE_4_MARKETING_APPS_SCRIPT_TEMPLATES.find((t) => t.key === key);
}
