# Rollback & Recovery Procedure

## 1. Application Rollback (Vercel)
If a production deployment introduces a regression:
1. Open Vercel Dashboard → **Deployments**.
2. Locate the previous verified healthy production deployment.
3. Click **Promote to Production** (Instant Rollback).
4. Verify `/api/health` returns HTTP `200` and inspect `/dashboard/system-health`.

## 2. Immediate Publishing Halt (Zero-Downtime Mitigation)
Before rolling back code if an automation or publishing anomaly occurs:
1. Open `/dashboard/autonomy`.
2. Activate **Global Emergency Stop** (or pause a specific brand/platform).
3. All immediate publishes and `/api/cron/publish-dispatcher` executions halt immediately via the Central Action Gateway.

## 3. Firestore Rules Rollback
If a `firestore.rules` change breaks legitimate access:
1. Restore the prior known-good `firestore.rules` from git history.
2. Validate with `npm run lint:rules`.
3. Deploy rules via Firebase CLI (`firebase deploy --only firestore:rules`).

## 4. Schema Migration Safety
Antara Engine 4.0 uses strictly additive, backward-compatible Firestore schemas (`1.0.0` → `5.0.0` registered in `src/lib/server/migrations.ts`). Code rollbacks between adjacent minor/patch releases do not require destructive database downgrades. Run the non-destructive Integrity Audit in `/dashboard/system-health` or `/dashboard/admin` after any rollback to verify zero orphan references or stuck scheduler leases.

## 5. Apps Script Deployment Rollback (Phase 2)
Every Apps Script update creates an automatic backup snapshot (`appsScriptBackups`) and immutable version (`appsScriptVersions`). To roll back a script:
1. Open `/dashboard/apps-script`.
2. Select the affected project → **Versions & Backups**.
3. Restore the previous verified backup or point the deployment back to the last known-good version number.
