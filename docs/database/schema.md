# Cloud Firestore Database Schema — Antara Engine 4.0

All tenant records are strictly scoped under `workspaces/{workspaceId}/...` and enforced by both server-side tenant guards (`src/lib/server/tenant-guard.ts`) and deployed `firestore.rules`.

## Top-Level Collections
- `users/{uid}` — Authenticated user profile (`email`, `displayName`, `defaultWorkspaceId`, `createdAt`, `updatedAt`)
- `users/{uid}/memberships/{workspaceId}` — Fast membership lookup index (`workspaceId`, `role`, `status`, `joinedAt`)
- `workspaces/{workspaceId}` — Workspace root metadata (`name`, `slug`, `timezone` defaulting to `Asia/Kolkata`, `ownerUid`)

## Workspace Subcollections by Phase

### Phase 1 — Core Governance
- `members/{uid}` — 5-tier RBAC role (`owner | admin | editor | operator | viewer`) & active status
- `invitations/{invitationId}` — Workspace member invitations
- `brands/{brandId}` — Brand profiles (4 editable starter brands: `Saket Personal`, `MagnArc`, `GreenWeld`, `Sapphire`, plus custom brands)
- `integrations/{integrationId}` — Integration connection state records
- `settings/{settingId}` — Workspace configuration documents (including `usage_thresholds`)
- `notifications/{notificationId}` — Workspace operational notifications
- `auditLogs/{auditLogId}` — Append-only security & administrative audit trail

### Phase 2 — Google OAuth & Apps Script Control Plane
- `googleConnections/{connectionId}` — Authorized Google accounts, scopes, status
- `encryptedCredentials/{credentialId}` — AES-256-GCM AAD-bound ciphertext envelopes (never returned by UI/export/admin APIs)
- `appsScriptProjects/{projectId}` — Tracked Google Apps Script projects & source sync state
- `appsScriptBackups/{backupId}` — Pre-update immutable code snapshots
- `appsScriptVersions/{versionId}` — Versioned release snapshots
- `appsScriptDeployments/{deploymentId}` — Published Apps Script deployments & endpoints
- `appsScriptExecutions/{executionId}` — Execution records & status
- `appsScriptTriggers/{triggerId}` — Managed Apps Script triggers

### Phase 3 — Autonomous Intelligence Engine
- `agentConfigs/{agentId}` — Per-agent configuration for all 9 specialists
- `aiRuns/{runId}` — Central Orchestrator run records, intent, QA verdict, tokens
- `aiConversations/{conversationId}` — Command Center conversation threads
- `researchSources/{sourceId}` — Deduplicated, SSRF-validated research sources
- `brandKnowledge/{factId}` — 20-category verified Brand Knowledge facts (strictly scoped by `brandId`)
- `brandMemory/{memoryId}` — 7-namespace persistent Brand Memory with approval workflow
- `strategyPlans/{planId}` — Generated 7/14/30-day content & growth strategies
- `contentDrafts/{draftId}` — Phase 3 AI-drafted content packages
- `playbooks/{playbookRunId}` — Event playbook triggers and runs
- `aiUsageLedger/{usageId}` — Per-call token & estimated USD cost ledger

### Phase 4 — Autonomous Marketing & Growth Execution
- `growthObjectives/{objectiveId}` — Brand marketing objectives
- `contentItems/{contentId}` — Canonical marketing content with SHA-256 `payloadHash`, platform variants & QA results
- `creativeBriefs/{briefId}` — Brand-compliant creative briefs & Canva export jobs
- `mediaAssets/{assetId}` — Validated media metadata & Firebase Storage paths
- `socialAccounts/{accountId}` — Connected social publishing accounts (metadata only; tokens in `encryptedCredentials`)
- `scheduledPosts/{postId}` — UTC-scheduled publishing jobs with idempotency keys, worker leases & retry state
- `publishingAttempts/{attemptId}` — Immutable per-attempt publishing & reconciliation records
- `approvalRequests/{approvalId}` — Human approval decisions bound to `payloadHash` & expiration
- `autonomyPolicies/{brandId}` — Per-brand Mode A/B/C policy, allowlists, daily caps & topic filters
- `marketingControls/emergency_stop` — Global, per-brand, and per-platform Emergency Stop state
- `socialConversations/{conversationId}` — Unified comments & DM threads
- `reviews/{reviewId}` — Reputation reviews with 8-category classification
- `leads/{leadId}` — Lead pipeline records with explicit consent provenance
- `adCampaigns/{campaignId}` & `campaignBudgetPolicies/{brandId}` — Paid ads drafts & numeric budget policies
- `analyticsSnapshots/{snapshotId}` & `experiments/{experimentId}` — Null-preserving performance metrics & A/B experiments
- `webhookEvents/{eventId}` — Signed webhook deduplication records
- `marketingActivity/{activityId}` — Unified marketing operations feed
