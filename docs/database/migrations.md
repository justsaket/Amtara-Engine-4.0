# Schema Migrations & Integrity Verification

## 1. Migration Registry (`src/lib/server/migrations.ts`)
Antara Engine 4.0 tracks schema evolution explicitly via `SCHEMA_MIGRATION_REGISTRY`:

| Version | Phase | Scope | Destructive |
| --- | --- | --- | --- |
| `1.0.0` | Phase 1 | Users, workspaces, members, brands, settings, auditLogs | No |
| `2.0.0` | Phase 2 | Google connections, AAD-bound encryptedCredentials, Apps Script control plane | No |
| `3.0.0` | Phase 3 | Multi-agent orchestrator, research sources, brand knowledge, brand memory, AI usage ledger | No |
| `4.0.0` | Phase 4 | Content factory, media assets, social accounts, scheduler, approvals, autonomy, inbox, reviews, leads, campaigns, analytics | No |
| `5.0.0` | Phase 5 | Operational usage thresholds, release observability, non-destructive workspace integrity audits | No |

## 2. Additive Forward-Compatibility Policy
- Every schema expansion adds optional fields or new workspace subcollections rather than renaming or deleting fields in place.
- Documents created prior to explicit `schemaVersion` tagging remain readable and are flagged as `info` (never `error`) during integrity audits.

## 3. Non-Destructive Workspace Integrity Audit
`runWorkspaceIntegrityAudit(store, workspaceId)` runs read-only checks exposed in `/dashboard/system-health` and `/dashboard/admin`:
- **Orphan Brand References**: Detects `contentItems` or `approvalRequests` pointing to deleted/missing `brandId`.
- **Orphan Account References**: Detects `scheduledPosts` referencing a missing `accountId`.
- **Duplicate Job Idempotency Keys**: Flags duplicate `idempotencyKey` entries in `scheduledPosts` as `severity: 'error'`.
- **Stale Worker Leases**: Detects `claimed`/`publishing` jobs whose `leaseExpiresAt` timestamp has expired so operators or the next dispatcher cycle can recover them.
- **Zero Production Mutation**: Never modifies, deletes, or overwrites production documents during audit execution.
