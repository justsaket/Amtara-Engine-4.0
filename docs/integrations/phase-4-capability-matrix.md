# Antara Engine 4.0 — Phase 4 Provider Capability Matrix

**Last Reviewed:** 2026-04-01  
**Policy:** Every external social, creative, paid-media, and reputation provider in Phase 4 uses official documented APIs, server-side encrypted OAuth credentials, and explicit capability boundaries. Missing credentials or unapproved app-review states never crash the application and never fabricate connected accounts or metrics.

---

## 1. Provider Matrix

| Provider | Official API | Required Env Vars | Required Scopes | Supported Capabilities | Unsupported / Restricted | App Review / Audit Rules | Automated Test Coverage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Meta Instagram** | Instagram Platform API v21.0 (separate Facebook Login & Instagram Login hosts) | `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | FB Login: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`<br>IG Login: `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments` | Single image & Reels container publishing, container status polling, reconciliation on ambiguous timeout, comments & policy-aware messaging windows, media/account insights | Text-only feed posts, Personal accounts (must be Business/Creator), cold DMs outside 24h or 72h Click-to-Message window | Requires Meta App Review for Advanced Access in Live Mode | Unit + mocked HTTP/adapter tests (no live external publishes) |
| **Meta Facebook Pages** | Facebook Graph API v21.0 (Pages) | `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` | Page discovery & role check, text/photo/video/Reel publishing, Page comments & Messenger policy-aware replies, Page & post insights | Personal timeline posting, deprecated Groups API | Requires Meta App Review for `pages_manage_posts` & `pages_read_engagement` | Unit + mocked HTTP/adapter tests |
| **YouTube** | YouTube Data API v3 (Resumable Uploads) | `GOOGLE_INTEGRATION_CLIENT_ID`, `GOOGLE_INTEGRATION_CLIENT_SECRET` | `https://www.googleapis.com/auth/youtube.upload`, `https://www.googleapis.com/auth/youtube.readonly` | Channel discovery, resumable video & Shorts uploads, explicit `private` / `unlisted` / `public` privacy guard, upload vs processing state tracking | Static image posts, Community text posts | Unaudited Google OAuth apps uploading via YouTube Data API are locked to Private videos until Google API Compliance Audit completes | Unit + mocked adapter tests |
| **LinkedIn** | LinkedIn REST Posts API (`LinkedIn-Version: 202504`, configurable via `LINKEDIN_API_VERSION`) | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Member: `openid`, `profile`, `w_member_social`<br>Org: `w_organization_social`, `rw_organization_admin` | Member posts, Organization Page posts when org scope & admin role verified, configurable API version header | Automated DM inbox, org posting without admin role | Share on LinkedIn grants `w_member_social`; Community Management API approval required for `w_organization_social` | Unit + mocked adapter tests |
| **TikTok** | TikTok Content Posting API v2 | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | `user.info.basic`, `video.upload` (draft inbox), `video.publish` (direct post) | Draft upload to creator inbox (`video.upload`), Direct Post (`video.publish`) when audited, status fetch & reconciliation | Text-only posts, Public Direct Post on unaudited apps (automatically restricted to `SELF_ONLY` private or Draft Inbox) | TikTok Content Posting API Audit required for public Direct Post | Unit + mocked adapter & webhook HMAC tests |
| **Google Business Profile (GBP)** | Google Business Profile APIs | `GOOGLE_INTEGRATION_CLIENT_ID`, `GOOGLE_INTEGRATION_CLIENT_SECRET`, `GBP_API_ACCESS_STATUS` | `https://www.googleapis.com/auth/business.manage` | Location discovery, GBP Local Post updates, review listing, 8-category review classification, human-approved review replies | Deprecated GBP Business Messages chat, short-form Reels | Explicit 6-state GBP API readiness (`not_requested`, `pending_google_approval`, `approved`, `rejected`, `connected`, `error`); requires separate Google Cloud GBP API Access approval for non-zero quota | Unit + mocked adapter & review classifier tests |
| **Canva Connect** | Canva Connect REST API v1 (PKCE OAuth) | `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET` | `design:meta:read`, `design:content:read`, `design:content:write`, `asset:read`, `asset:write` | Design listing, design creation from brand creative briefs, async export job creation + bounded polling + immediate download into Firebase Storage | In-editor Canva Content Publisher publishing (requires Canva Apps SDK, explicitly out of scope for REST Connect) | Enterprise Brand Template Autofill requires Canva Enterprise plan | Unit + mocked async export polling, expiry & storage failure tests |
| **Meta Marketing API (Paid Ads)** | Meta Marketing API v21.0 | `META_APP_ID`, `META_APP_SECRET` | `ads_read`, `ads_management` (owner-authorized only) | Ad account & campaign analysis, draft campaign plans, strict dry-run numeric cap validation, owner-authorized launch via Central Action Gateway | Any autonomous ad spend without explicit numeric daily/monthly caps and owner authorization | Paid Ads disabled by default per brand until explicit budget caps and owner authorization are stored | Unit + Central Action Gateway & dry-run tests |

---

## 2. Central Action Gateway Enforcement

Every external write action (`publish_content`, `schedule_publish`, `reply_comment`, `reply_dm`, `reply_review`, `launch_ad_campaign`, `update_ad_budget`, `send_lead_outreach`) must pass `evaluateActionGateway`:

1. **Idempotency Replay Protection** — Prevents duplicate side effects on identical idempotency keys.
2. **Emergency Stop Hierarchy** — Global workspace stop, per-brand pause, and per-platform pause override all policies immediately.
3. **RBAC Role & Permission Verification** — Verifies caller workspace membership and Phase 4 permission.
4. **Account Connection, Scope & Token Freshness** — Blocks disconnected, expired, or under-scoped accounts.
5. **Paid Spend Hard Guard** — Blocks paid campaigns lacking positive numeric daily/monthly limits or owner authorization.
6. **Quality Gate Enforcement** — Blocks publishing when brand facts, prohibited claims, or media rules fail.
7. **Payload-Hash-Bound Approvals** — Any edit to title, hook, body, CTA, hashtags, media assets, or target platforms invalidates prior approval (`APPROVAL_INVALIDATED_BY_EDIT`). AI agents can never self-approve.
8. **Per-Brand Autonomy Modes**:
   - **Mode A (`DRAFT_ONLY`)**: Drafts only; blocks all external publishing.
   - **Mode B (`APPROVAL_REQUIRED`, default)**: Requires valid human approval matching exact payload hash.
   - **Mode C (`AUTHORIZED_AUTO_PUBLISHING`)**: Permits auto-publishing only for explicitly allowlisted platforms, formats, daily post caps, passed QA, non-expired policy, and non-sensitive topics.
9. **Ambiguous Commit Protection (`PUBLISH_STATUS_UNKNOWN`)** — Blocks blind duplicate retries until provider reconciliation confirms whether the post was created.

---

## 3. OAuth Callback & Webhook Routes

All OAuth callback routes are derived from `APP_URL`:

- Meta (Instagram / Facebook / Meta Ads): `${APP_URL}/api/integrations/social/meta/callback`
- LinkedIn: `${APP_URL}/api/integrations/social/linkedin/callback`
- TikTok: `${APP_URL}/api/integrations/social/tiktok/callback`
- Canva Connect: `${APP_URL}/api/integrations/social/canva/callback`
- YouTube: `${APP_URL}/api/integrations/social/youtube/callback`
- Google Business Profile: `${APP_URL}/api/integrations/social/gbp/callback`
- Meta Webhook: `${APP_URL}/api/webhooks/meta` (`X-Hub-Signature-256` HMAC-SHA256)
- TikTok Webhook: `${APP_URL}/api/webhooks/tiktok` (`TikTok-Signature` HMAC-SHA256)
- Serverless Cron Dispatcher: `${APP_URL}/api/cron/publish-dispatcher` (`Authorization: Bearer ${CRON_SECRET}`, scheduled every 5 minutes via `vercel.json`)
