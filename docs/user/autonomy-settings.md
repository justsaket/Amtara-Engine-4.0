# Autonomy Modes & Safety Controls Guide

Managed from `/dashboard/autonomy` and enforced server-side on every external write by the **Central Action Gateway** (`src/lib/marketing/autonomy-gateway.ts`).

## The Three Autonomy Modes
1. **Mode A — `DRAFT_ONLY`**
   - AI agents and operators can research, draft content, and prepare creative briefs.
   - All external publishing, replies, and campaign mutations are **unconditionally blocked**.
2. **Mode B — `APPROVAL_REQUIRED` (Default for Every Brand)**
   - Every external publish, scheduled post, reply, or campaign action requires an explicit, unexpired **human approval** matching the exact SHA-256 `payloadHash`.
   - **AI Self-Approval Blocked**: Automated agents can never approve their own requests.
   - **Edit Invalidation**: Modifying caption, media, hashtags, or platforms after approval immediately invalidates approval until re-approved by a human.
3. **Mode C — `LIMITED_AUTONOMOUS`**
   - Permits automated execution **only** within strict guardrails configured per brand:
     - Explicit platform allowlist (`allowedAutoPlatforms`)
     - Explicit format allowlist (`allowedAutoFormats`)
     - Hard daily publish cap (`maxAutoPostsPerDay`)
     - Passing Quality Gate required (`requireQualityGatePass`)
     - Optional automatic expiration (`policyExpiresAt`)
   - **Always Escalated to Humans**: Sensitive topics (legal, refund, safety, complaint, pricing dispute), negative reviews, external lead outreach without consent, and paid ad spend **always** require human approval regardless of Mode C.

## Emergency Stop (Instant Halt)
Located at `/dashboard/autonomy` and accessible from the top bar of the dashboard shell:
- **Global Workspace Stop**: Immediately halts all external actions across all brands, platforms, and scheduled cron dispatches.
- **Brand Pause / Platform Pause**: Granularly halts one brand or one social platform while keeping others operational.
- Every activation and resumption is logged immutably to `auditLogs`.
