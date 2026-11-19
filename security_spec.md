# Antara Engine 4.0 — Phase 1 Security Specification & Invariants

## 1. Core Security & Tenant Isolation Laws
1. **Strict User PII Isolation**: `/users/{userId}` and `/users/{userId}/memberships/{workspaceId}` may only be read or written by `request.auth.uid == userId`. Blankets like `isSignedIn()` on `/users` are strictly prohibited.
2. **Master Membership Gate**: All tenant subcollections (`brands`, `integrations`, `settings`, `auditLogs`, `notifications`, `invitations`, `agentConfigs`, `workflows`, `approvals`, `members`) derive access exclusively from `/workspaces/{workspaceId}/members/{request.auth.uid}` where `status == 'active'`.
3. **Immutable Ownership & Tenant Bindings**: `ownerId`, `workspaceId`, `createdBy`, and `createdAt` cannot be modified after document creation.
4. **Privilege Escalation Lock**: A `viewer` or `editor` can never mutate `members`, `invitations`, `integrations`, `settings`, or `workspaces`. Only `owner` (or `admin` for non-owner roles) may modify roles, and no client can self-assign `owner`.
5. **Server-Only Encrypted Credential Vault**: `/workspaces/{workspaceId}/encryptedCredentials/{credentialId}` and `/workspaces/{workspaceId}/oauthStates/{stateId}` deny all client SDK reads and writes (`allow read, write: if false;`).
6. **Master Encryption Key Separation**: `ENCRYPTION_KEY` is generated via CSPRNG or supplied via server environment variables / secure local `.antara/internal-secrets.json` (never stored inside the same Firestore database it protects, never generated per boot or per request).
7. **AES-256-GCM AAD Binding & Key Rotation**: Credential payloads use `v1:<keyVersion>:<iv>:<tag>:<ct>` bound to `workspaceId:credentialId` AAD to prevent cross-tenant ciphertext transplantation. Optional rotation uses `ENCRYPTION_KEY_PREVIOUS`.
8. **Separation of Identity vs External Authorization**: Signing into Antara with email/password or Google identity never automatically authorizes Google Workspace, Apps Script, Drive, YouTube, or social platforms.
9. **Immutable Audit Trail**: `auditLogs` allows `create` by active workspace members matching `actorUid == request.auth.uid` and denies `update` and `delete`.
10. **Bounded Volumetric Integrity**: All string lengths, array sizes, path IDs (`isValidId()`), slugs (`isValidSlug()`), hex colors (`isValidHexColor()`), and server timestamps (`request.time`) are strictly validated.

## 2. Adversarial Scenarios Enforced (Dirty Dozen+)
1. Unauthenticated read on `/workspaces/{id}` -> `PERMISSION_DENIED`.
2. Cross-tenant `LIST` on `/workspaces/ws_b/brands` by non-member -> `PERMISSION_DENIED`.
3. Cross-tenant `GET` on `/users/uid_b` by `uid_a` -> `PERMISSION_DENIED`.
4. Shadow field injection (`isAdmin: true`, `role: "owner"`) on `/users/{uid}` -> `PERMISSION_DENIED`.
5. Identity spoofing `ownerId: "uid_b"` on workspace creation -> `PERMISSION_DENIED`.
6. Viewer attempting self-promotion on `/workspaces/ws_1/members/uid_viewer` -> `PERMISSION_DENIED`.
7. Viewer attempting brand creation -> `PERMISSION_DENIED`.
8. Editor reassigning `workspaceId` during brand update -> `PERMISSION_DENIED`.
9. Workspace owner attempting client SDK read on `/workspaces/ws_1/encryptedCredentials/cred_1` -> `PERMISSION_DENIED`.
10. Workspace owner attempting client SDK write of `status: "connected"` on `integrations` -> `PERMISSION_DENIED`.
11. Cross-workspace ciphertext transplant fails GCM tag check during decryption.
12. Owner attempting `UPDATE` or `DELETE` on `/workspaces/ws_1/auditLogs/{logId}` -> `PERMISSION_DENIED`.

## 3. Phase 3 Autonomous Intelligence Invariants
13. **Agent & AI Run Tenant Isolation**: `aiRuns`, `agentTasks`, `agentExecutionEvents`, `agentArtifacts`, `brandMemory`, `brandKnowledge`, `researchSources`, `researchClaims`, `strategyRecords`, `contentDrafts`, `playbookRuns`, `normalizedEvents`, `aiUsageLedger`, `aiConversations`, and `aiMessages` are strictly locked to active workspace members and verified by `workspaceId == workspaceId` + `isValidId()`.
14. **Immutable Ledgers & Event Streams**: `aiUsageLedger`, `agentExecutionEvents`, `researchSources`, and `aiMessages` disallow client-side updates and deletes (`allow update, delete: if false;`).
15. **Prompt Injection & Secret Redaction**: External research HTML/text, reviews, and DMs are wrapped as `[UNTRUSTED EXTERNAL DATA]` and never granted system-role privilege or access to `encryptedCredentials` / `_serverVault`.
16. **Memory Approval Gate**: Candidate memories enter with `status == 'candidate'` and require `owner`, `admin`, or `manager` authority (`memory:approve`) to transition to `approved` or `rejected`.
17. **Adversarial Phase 3 Scenarios**:
    - Non-member reading `/workspaces/ws_b/aiRuns/{runId}` -> `PERMISSION_DENIED`.
    - Viewer mutating `/workspaces/ws_a/agentConfigs/{agentId}` -> `PERMISSION_DENIED`.
    - Editor promoting `candidate` memory to `approved` directly -> `PERMISSION_DENIED`.
    - SSRF target `http://169.254.169.254/latest/meta-data` rejected with `SOURCE_VERIFICATION_FAILED`.

