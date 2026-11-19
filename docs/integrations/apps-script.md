# Google Apps Script Control Plane Guide

## 1. Capabilities
Available at `/dashboard/apps-script` once a Google account is connected:
- **Project Discovery & Creation**: List authorized Apps Script projects or create new standalone projects directly from the dashboard.
- **Source Control & Validation**: Edit `.gs`, `.html`, and `appsscript.json` files with syntax & manifest validation before pushing to Google.
- **Automatic Pre-Update Backups**: Every push snapshots existing remote files into `appsScriptBackups`.
- **Immutable Versioning**: Create numbered Apps Script versions tracked in `appsScriptVersions`.
- **Deployment Management**: Create, update, and archive Apps Script deployments (`appsScriptDeployments`) with live URLs.
- **Execution & Trigger Tracking**: Invoke supported functions and track execution history (`appsScriptExecutions`) and triggers (`appsScriptTriggers`).

## 2. Built-in Marketing Automation Templates (Phase 4)
`src/lib/google/marketing-templates.ts` provides 8 production-oriented Apps Script templates that operators can deploy into their own Google account:
1. Content Calendar Sheet Sync
2. Brand Asset Drive Indexer
3. Lead Capture Form → Antara Webhook Bridge
4. Weekly Executive Analytics Digest Email
5. Competitor Price & Promo Monitor Sheet
6. Review Alert Escalation Notifier
7. Campaign UTM Link Builder & Tracker
8. Monthly Content Archive Exporter

## 3. Prerequisites
- Enable the **Google Apps Script API** in your user Google Apps Script settings (`https://script.google.com/home/usersettings`) as well as in Google Cloud Console.
- Without enabling the Apps Script API in user settings, Google returns a `403` permission error when creating or updating scripts; Antara surfaces this exact remediation guidance cleanly in the UI.
