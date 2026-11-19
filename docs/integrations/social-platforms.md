# Social Platforms & Creative Integrations Guide

## 1. Supported Channels
Managed from `/dashboard/publishing/accounts` and `/dashboard/assets`:
- **Instagram Business / Creator** (Meta Graph API v21.0)
- **Facebook Pages** (Meta Graph API v21.0)
- **YouTube Channels** (YouTube Data API v3)
- **LinkedIn Members & Organizations** (LinkedIn API)
- **TikTok Accounts** (TikTok Content Posting API v2)
- **Google Business Profile** (GBP API — requires separate Google approval)
- **Meta Ads** (Meta Marketing API v21.0 — Owner budget cap required)
- **Canva Connect** (Canva OAuth2 PKCE + Async Export Pipeline)

## 2. Webhook Security (Meta & TikTok)
- Meta webhook route (`/api/webhooks/meta`): Supports `hub.challenge` verification via `META_WEBHOOK_VERIFY_TOKEN` and enforces `X-Hub-Signature-256` HMAC-SHA256 verification using `META_APP_SECRET`.
- TikTok webhook route (`/api/webhooks/tiktok`): Verifies cryptographic HMAC signature using `TIKTOK_WEBHOOK_SECRET`.
- All webhook deliveries are deduplicated via deterministic SHA-256 keys (`webhookEvents`) to guarantee idempotent processing.

## 3. Messaging & Compliance Safeguards
- **Meta 24-Hour Messaging Window**: `validateMessagingWindow` blocks automated DM replies outside standard platform customer-care windows.
- **Sensitive Topic Escalation**: `detectSensitiveTopic` automatically flags refund, legal, safety, complaint, pricing-dispute, or medical/compliance messages for mandatory human review—even under Mode C (`LIMITED_AUTONOMOUS`).
- **TikTok Audit Constraint**: Unaudited apps cannot publish public TikTok posts; Antara explicitly enforces draft/sandbox awareness (`unauditedAppWarning`) until TikTok audit completion.
- **Account Disconnect Safety**: Disconnecting any social account automatically cancels its pending `scheduledPosts` so orphaned jobs never fail repeatedly.
