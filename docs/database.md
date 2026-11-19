# Database Schema & Firestore Security Rules

## Database Topology

- **Configured Project ID (`firebase-applet-config.json`):** `rare-rainfall-prtgb`
- **Database ID Resolver (`resolveFirestoreDatabaseId`):** Reads `FIREBASE_DATABASE_ID` / `NEXT_PUBLIC_FIREBASE_DATABASE_ID` / `firebase-applet-config.json` (`ai-studio-e9bdfca4-ede1-4994-8b80-fba76fa44eb9`), defaulting cleanly to `(default)` when omitted.
- **Canonical Blueprint:** `/firebase-blueprint.json`
- **Composite Indexes:** `/firestore.indexes.json`
- **Deployed Security Rules:** `/firestore.rules` (kept in parity with `/DRAFT_firestore.rules` and verified via `npm run lint:rules`).

## Collection Hierarchy

### User Root Collections
- `/users/{userId}` (`UserProfile`) — Profile metadata, timezone (`Asia/Kolkata`), `defaultWorkspaceId`, `onboardingCompleted`, `authProvider`, and `accountDeletionStatus` (`none | requested`).
- `/users/{userId}/memberships/{workspaceId}` (`UserMembershipIndex`) — Active workspace membership index for fast tenant switching.

### Workspace-Scoped Collections (`/workspaces/{workspaceId}/...`)
- `/workspaces/{workspaceId}` (`Workspace`) — Workspace metadata, slug, timezone, owner ID, `foundation | growth | enterprise` tier.
- `/workspaces/{workspaceId}/members/{uid}` (`WorkspaceMember`) — Active/invited/suspended member record with 5-tier RBAC role (`owner | admin | manager | editor | viewer`).
- `/workspaces/{workspaceId}/invitations/{invitationId}` (`WorkspaceInvitation`) — Pending/accepted/revoked workspace invites.
- `/workspaces/{workspaceId}/brands/{brandId}` (`BrandProfile`) — Brand identity (`Saket Personal`, `MAGNARC`, `GreenWeld`, `Sapphire`, or custom), colors, content pillars, voice, restrictions, and optional Storage `logoPath`.
- `/workspaces/{workspaceId}/integrations/{integrationId}` (`IntegrationRecord`) — Capability state (`not_configured | authorization_required | connected | expired | error | disabled`), requested scopes, and mandatory `consentSeparatedFromLogin: true`.
- `/workspaces/{workspaceId}/settings/{category}` (`ApplicationSetting`) — Centralized settings across all 12 categories.
- `/workspaces/{workspaceId}/auditLogs/{logId}` (`AuditLog`) — Append-only workspace audit trail (`allow update, delete: if false;`).
- `/workspaces/{workspaceId}/notifications/{notificationId}` (`NotificationRecord`) — Workspace system notices and alert acknowledgements.

### Phase 2 Google & Apps Script Collections (`/workspaces/{workspaceId}/...`)
- `/workspaces/{workspaceId}/googleConnections/{connectionId}` (`GoogleConnectionRecord`) — Authorized Google account metadata (email, subject ID, normalized scopes, `sharedWithWorkspace`, expiration timestamp, `status`; never stores raw tokens). Enforces `consentSeparatedFromLogin: true` and owner/shared visibility rules.
- `/workspaces/{workspaceId}/appsScriptProjects/{scriptId}` (`AppsScriptProjectRecord`) — Linked or Antara-created Google Apps Script metadata, `ownershipKind`, `lastRemoteHash`, file count, editor URL, and cloud project status.
- `/workspaces/{workspaceId}/appsScriptSnapshots/{snapshotId}` (`AppsScriptSnapshotRecord`) — Immutable source-file backups taken automatically before remote edits or restores (`allow update: if false;`).
- `/workspaces/{workspaceId}/appsScriptVersions/{versionId}` (`AppsScriptVersionRecord`) — Recorded immutable Apps Script numeric versions (`allow update: if false;`).
- `/workspaces/{workspaceId}/appsScriptDeployments/{deploymentId}` (`AppsScriptDeploymentRecord`) — Tracked Web App & API Executable deployments with entry point URLs and access/execution modes.
- `/workspaces/{workspaceId}/approvedExecutionTargets/{targetId}` (`ApprovedExecutionTarget`) — Owner/Admin-approved execution allowlist specifying callable functions, risk level, and required human approval flags (`onlyOwnerOrAdmin`).
- `/workspaces/{workspaceId}/scriptExecutions/{executionId}` (`ScriptExecutionRecord`) — Recorded `scripts.run` execution runs, parameters preview, structured outputs/errors, and confirmation metadata.
- `/workspaces/{workspaceId}/scriptTriggers/{triggerId}` (`ScriptTriggerRecord`) — Antara-managed trigger definitions linked to `__antara_triggers.gs` deduplication keys.
- `/workspaces/{workspaceId}/googleIntegrationAudit/{auditId}` (`GoogleIntegrationAuditRecord`) — Append-only Phase 2 audit ledger (`allow update, delete: if false;`).

### Locked Server-Only Subcollections & Root Vault
- `/workspaces/{workspaceId}/encryptedCredentials/{credentialId}` — `allow read, write: if false;` (holds AES-256-GCM encrypted Google token payloads bound to workspace + connection AAD).
- `/workspaces/{workspaceId}/oauthStates/{stateId}` — `allow read, write: if false;` (holds SHA-256 `stateHash` single-use CSRF transaction state with 10-minute expiry).
- `/_serverVault/{docId}` — `allow read, write: if false;` (server-only encrypted Platform Google OAuth client config when Admin SDK is available).

### Firebase Storage Paths
- Brand logos uploaded through `/src/lib/firebase/storage.ts` are stored under `workspaces/{workspaceId}/brands/{brandId}/{filename}` with MIME validation (`image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`) and 2 MB size cap.
