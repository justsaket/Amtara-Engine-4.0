# Operational Failure Recovery Guide

## 1. Ambiguous Publish State (`publish_status_unknown`)
When a network timeout occurs after sending a publish request to an external platform, Antara intentionally marks the job `publish_status_unknown` (`reconciliationRequired: true`) instead of blindly retrying and creating duplicate posts.
**Recovery Steps**:
1. Open `/dashboard/publishing/queue` or `/dashboard/system-health`.
2. Inspect the job's provider container/idempotency reference and run **Reconcile Status** (or verify directly on the social channel).
3. Only reschedule once confirmed `confirmed_not_published`.

## 2. Dead-Letter & Failed Scheduled Jobs
Jobs that exhaust `maxAttempts` move to `dead_letter` (never infinite retry loops).
**Recovery Steps**:
1. Inspect `lastErrorCode` and `lastErrorMessage` in `/dashboard/publishing/queue`.
2. Fix the underlying cause (e.g., reconnect expired OAuth account, replace unsupported media format, or update caption length).
3. Create a fresh scheduled job or re-queue after approval verification.

## 3. Expired Worker Leases
If a serverless function terminates mid-execution while holding a `scheduledPosts` lease (`claimed` / `publishing`), the lease expires automatically and is flagged by `runWorkspaceIntegrityAudit` (`stale_lease`). The next `/api/cron/publish-dispatcher` cycle safely reclaims expired leases unless `reconciliationRequired` is true.

## 4. Disconnected Accounts
Disconnecting an external account automatically cancels all `scheduled` jobs targeting that account (`cancelScheduledPostsForDisconnectedAccount`). Reconnect the account in `/dashboard/publishing/accounts` and reschedule desired drafts.

## 5. AI Provider Unavailable (`AI_PROVIDER_NOT_CONFIGURED` or Quota Exhausted)
When no AI API key is set or a provider returns 429/503:
- All Phase 1, 2, 4, and 5 non-AI modules continue working normally.
- Configure or rotate `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` in environment settings and retry the run from `/dashboard/ai`.
