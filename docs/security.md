# Security & Encryption Architecture

## Zero-Trust Multi-Tenancy

1. **Workspace Membership Gate:** Both Firestore Security Rules (`isActiveMember(workspaceId)`) and Next.js API Route Handlers (`requireWorkspaceAccess`) enforce that an authenticated user belongs to the target workspace with `status == 'active'`.
2. **RBAC Role Rank & Escalation Protection:**
   - Roles are ordered `viewer (1) < editor (2) < manager (3) < admin (4) < owner (5)`.
   - Phase 2 RBAC permissions (`google:read`, `google:connect`, `apps_script:read`, `apps_script:write`, `apps_script:deploy`, `apps_script:execute`) prevent viewers from modifying code or deploying, and restrict allowlist approvals (`approvedExecutionTargets`) and connection deletion/sharing policies cleanly.
   - `canAssignRole` and `canManageMember` prevent non-owners from modifying owners, self-escalating roles, or assigning `owner`.
   - Client rules enforce immutable ownership and `affectedKeys().hasOnly(...)` anti-update-gap checks on every writable collection.
3. **Immutable Audit Trails:** Both `auditLogs` and `googleIntegrationAudit` are append-only (`allow update, delete: if false;`), logging workspace changes, OAuth connect/disconnect/revocation, code updates, snapshot restores, version releases, deployments, rollbacks, trigger changes, and allowlisted executions.

## Credential Encryption & Secret Management

- **Master Key Separation:** Encryption keys are **never** stored inside the Firestore database whose credentials they protect.
- **Persistence Strategy (`src/lib/server/secret-manager.ts`):**
  - Locally (non-Vercel), `ensureInternalSecrets()` generates cryptographically random 32-byte hex values via `crypto.randomBytes(32)` once and atomically persists them to git-ignored `.antara/internal-secrets.json` with `0o600` file permissions.
  - Keys are never regenerated on every HTTP request, restart, or deployment.
  - On stateless hosts (`VERCEL=1`), secrets are loaded from `SESSION_SECRET` / `ENCRYPTION_KEY` environment variables, and `/api/config/bootstrap` emits one-time setup instructions to authorized Owner/Admin users without storing plaintext keys in Firestore.
- **AES-256-GCM + Tenant AAD Binding (`src/lib/server/crypto.ts`, `src/lib/server/google-vault.ts`):**
  - Every `EncryptedCredentialPayload` uses unique 96-bit IVs, AES-256-GCM authentication tags, key versioning (`v1`, `v2`, ...), and Additional Authenticated Data (AAD).
  - Phase 2 Google OAuth token bundles bind AAD strictly to `workspace:${workspaceId}:connection:${connectionId}` (and platform OAuth client secrets bind to `platform:google_oauth`), causing cross-workspace ciphertext transplantation to fail authentication immediately (`VAULT_DECRYPT_FAILED`).
- **Key Rotation:** `rotateInternalEncryptionKey()` advances `encryptionKeyVersion` while retaining `previousEncryptionKey` / `previousEncryptionKeyVersion` cleanly so existing credentials decrypt with `needsReEncryption: true` and zero downtime.

## Identity vs. External Google OAuth & Apps Script Controls

- User login via Firebase Auth never grants Google Drive or Google Apps Script access.
- Platform Google OAuth credentials can be provided via environment variables OR saved once by a Workspace Owner/Admin via `/api/integrations/google/platform-config` into encrypted server storage (client never receives `clientSecret`).
- OAuth authorization routes bind a 10-minute single-use CSRF `stateHash` to an `HttpOnly`, `SameSite=Lax` browser nonce cookie (`antara_google_oauth_nonce`).
- **Apps Script Safeguards:**
  - Protected remote updates refuse accidental file deletions unless `confirmFileDeletions: true` is supplied, and always capture an immutable backup snapshot prior to pushing changes.
  - `ANYONE` / `ANYONE_ANONYMOUS` Web App deployments require `confirmPublicAccess: true`.
  - `scripts.run` execution strictly rejects functions not registered inside `/approvedExecutionTargets` (`EXECUTION_NOT_ALLOWLISTED`).
