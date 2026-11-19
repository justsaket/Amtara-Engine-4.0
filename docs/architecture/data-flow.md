# End-to-End Data Flow — Antara Engine 4.0

## 1. Authentication & Tenant Resolution Flow
1. User authenticates via Firebase Authentication (`/login` or `/register`).
2. Client obtains a short-lived Firebase ID token and attaches `Authorization: Bearer <idToken>` on API requests (`src/lib/api-client.ts`).
3. Server validates the token (`requireAuthenticatedUser`) and verifies membership + RBAC permission in `workspaces/{workspaceId}/members/{uid}` (`requireWorkspaceAccess`).
4. Cross-tenant resource access is rejected both in server repositories (`assertCrossTenantMatch`) and in Firestore security rules.

## 2. Multi-Agent Intelligence Flow (Phase 3)
1. Operator submits an instruction or triggers an Event Playbook in `/dashboard/ai`.
2. Central Orchestrator loads workspace brand profile, approved Brand Knowledge facts, and verified Brand Memory items strictly scoped to the active `brandId`.
3. Untrusted external inputs pass through prompt-injection sanitization (`src/lib/ai/prompt-defense.ts`); outbound research URLs pass through SSRF validation (`src/lib/ai/research-engine.ts`).
4. Specialist agents execute via the Provider-Independent Model Manager (`gemini`, `openai`, `anthropic`, or `ai_gateway`). If no provider key is configured, the system returns `AI_PROVIDER_NOT_CONFIGURED` cleanly without inventing outputs.
5. Token usage and estimated costs are persisted to `aiUsageLedger`; outputs are audited by the Quality Audit Agent before being saved as drafts or candidate memory.

## 3. Marketing Content → Approval → Publishing Flow (Phase 4)
1. Draft content is created in Content Studio (`/dashboard/content`) or generated from Phase 3 drafts, producing platform-specific variants and a SHA-256 `payloadHash`.
2. Quality Gate (`evaluateContentQualityGate`) checks prohibited claims, brand rules, platform limits, media compatibility, and duplicate risks.
3. Approval request is created in `approvalRequests` bound to the exact `payloadHash`. Editing content recomputes `payloadHash` and automatically invalidates prior approval.
4. Publishing (immediate or via `/api/cron/publish-dispatcher`) passes through the **Central Action Gateway** (`evaluateActionGateway`), which checks in order:
   - Emergency Stop (workspace / brand / platform)
   - Tenant & RBAC permission
   - Connected account & required OAuth scopes
   - Quality gate pass
   - Autonomy Mode (`DRAFT_ONLY` / `APPROVAL_REQUIRED` / `LIMITED_AUTONOMOUS` with allowlists & daily caps)
   - Idempotency key deduplication
5. Publishing attempts are recorded in `publishingAttempts`. Ambiguous network timeouts transition to `publish_status_unknown` for explicit provider reconciliation rather than blind duplicate reposting.

## 4. Engagement, Analytics & Learning Loop
1. Meta and TikTok webhooks verify cryptographic HMAC signatures before deduplication (`webhookEvents`) and routing into `socialConversations`.
2. Reviews (`reviews`) and Leads (`leads`) classify sentiment/sensitivity and enforce consent provenance before any external outreach.
3. Analytics snapshots preserve `null` for unavailable metrics (never zero-filling) and separate currencies (`INR` vs `USD`).
4. Completed experiments exceeding `minSampleSize` generate candidate `performance_memory` proposals back into Phase 3 Brand Memory for human approval.
