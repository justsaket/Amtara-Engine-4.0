# Backup, Export & Restore Guide

## 1. Honest Backup Readiness Notice
Managed automatic Cloud Firestore exports and Point-in-Time Recovery (PITR) depend on Google Cloud project billing (Blaze plan) and an explicitly configured Cloud Scheduler export job. **Do not assume automatic Firestore backups are active until verified in Google Cloud Console.**

Antara Engine surfaces this honestly in `/dashboard/system-health` and `/dashboard/admin` (`managedAutomaticBackupsConfirmed: false` until verified externally by the GCP administrator).

## 2. Manual & Scheduled Cloud Firestore Export (Recommended)
Run against the production Firestore database (`ai-studio-e9bdfca4-ede1-4994-8b80-fba76fa44eb9` in project `rare-rainfall-prtgb`):

```bash
gcloud firestore export \
  gs://<YOUR_BACKUP_BUCKET>/antara-$(date +%Y%m%d-%H%M%S) \
  --project=rare-rainfall-prtgb \
  --database=ai-studio-e9bdfca4-ede1-4994-8b80-fba76fa44eb9
```

To restore a full or selective collection backup:
```bash
gcloud firestore import \
  gs://<YOUR_BACKUP_BUCKET>/antara-<TIMESTAMP> \
  --project=rare-rainfall-prtgb \
  --database=ai-studio-e9bdfca4-ede1-4994-8b80-fba76fa44eb9
```

## 3. Sanitized Application-Level Workspace Export
Workspace **Owners** and **Admins** can download a structured JSON snapshot of their workspace directly from `/dashboard/help` (backed by `GET /api/workspaces/[workspaceId]/export`, rate-limited to 5 requests/minute).

**Security Guarantees of Workspace JSON Export**:
- Includes workspace metadata, brands, brand knowledge, brand memory, content items, scheduled posts, approvals, autonomy policies, reviews, leads, analytics snapshots, and audit logs.
- **Strictly excludes** `encryptedCredentials`, OAuth access/refresh tokens, encryption master keys, and session secrets.
- Every export event is logged in `auditLogs`.

## 4. Encryption Key Backup Requirement
Because `ENCRYPTION_KEY` is stored outside Firestore (Vercel Environment Variables / local `.antara/internal-secrets.json`), maintain a secure offline backup of `ENCRYPTION_KEY` and `ENCRYPTION_KEY_VERSION` in your password manager/KMS. Losing the encryption key renders stored `encryptedCredentials` unrecoverable and requires users to re-authorize external OAuth accounts.
