# Monitoring & Observability Guide

## 1. Public Health Probe (`GET /api/health`)
- Intended for uptime monitors, load balancers, and deployment smoke checks.
- Returns `200 OK` with `status: "ok"`, `release: "phase_5_production_release"`, timestamp, and safe boolean readiness indicators.
- Deliberately sanitized: never exposes Firebase project IDs, Firestore database IDs, internal secret metadata, or filesystem paths.

## 2. Authenticated System Health Dashboard (`/dashboard/system-health`)
Backed by `GET /api/workspaces/[workspaceId]/system-health`:
- **Live Cloud Firestore Probe**: Executes a real read against `workspaces/{workspaceId}` and measures exact round-trip latency in milliseconds.
- **8 Subsystem Health Checks**: Website/API, Cloud Firestore, Firebase Storage, Auth & AES-256-GCM Vault, AI Model Providers, Google OAuth & Apps Script, Publishing Scheduler & Recovery, and Signed Webhooks.
- **8-Provider Capability Matrix**: Live readiness states (`connected`, `authorization_required`, `not_configured`, `app_review_required`, `error`).
- **Publishing Queue Health**: Live counts of scheduled, published, and failed/dead-letter/unknown jobs with sample error codes.
- **Schema Integrity Audit**: Live non-destructive findings for orphan references, duplicate job keys, and stale leases.
- **Recent Structured Logs**: Last 20 redacted JSON operational events for the workspace.

## 3. Structured Redacted Logging (`src/lib/server/observability.ts`)
Every server error and critical operation emits structured JSON containing:
- `eventId`, `timestamp`, `correlationId`, `workspaceId`, `userId`, `operation`, `provider`, `status`, `errorClassification`, `durationMs`, `metadata`.
- **Automatic Redaction**: Recursively masks sensitive keys (`token`, `secret`, `password`, `authorization`, `cookie`, `credential`, `private_key`, etc.) and regex-strips `Bearer`, `ya29.`, `AIza`, `sk-`, and PEM key blocks.
- **7-Way Error Classification**: `TRANSIENT`, `PERMANENT`, `CONFIGURATION`, `AUTHORIZATION`, `VALIDATION`, `RATE_LIMIT`, `UNKNOWN`.
