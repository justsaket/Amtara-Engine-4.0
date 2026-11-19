# Production Release Checklist

Execute this checklist before every production promotion of Antara Engine 4.0.

## 1. Pre-Release Automated Quality Gates
- [ ] `npm run typecheck` passes with 0 errors.
- [ ] `npm run lint:rules` passes with 0 Firestore rule errors.
- [ ] `npm test` passes 100% with `ENABLE_REAL_GOOGLE_INTEGRATION_TESTS="false"`.
- [ ] `npm run build` succeeds cleanly with zero build warnings/errors blocking compilation.
- [ ] Static secret scan over `.next/static/` returns 0 secret/key matches.

## 2. Infrastructure & Security Verification
- [ ] Production `ENCRYPTION_KEY` and `SESSION_SECRET` are set in Vercel Environment Variables (never ephemeral, never committed to git).
- [ ] `firestore.rules` and `firestore.indexes.json` are deployed to the target Firebase project (`rare-rainfall-prtgb`).
- [ ] Authorized domains in Firebase Authentication include the production domain.
- [ ] Public `/api/health` returns `200 OK` with `release: "phase_5_production_release"` and zero internal project/secret leaks.
- [ ] HTTP security headers (`Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`) are verified on the live domain.
- [ ] `/api/*` responses include `Cache-Control: no-store, no-cache, must-revalidate, private`.

## 3. Operational Readiness
- [ ] Verify `/dashboard/system-health` shows `healthy` for Website/API, Cloud Firestore (live read latency measured), and Auth/Vault.
- [ ] Verify Emergency Stop defaults to inactive and can be toggled + resumed cleanly by the Workspace Owner.
- [ ] Verify `/dashboard/autonomy` defaults new brands to Mode B (`APPROVAL_REQUIRED`).
- [ ] Confirm Cloud Firestore scheduled backup export policy in Google Cloud Console (requires GCP Blaze + Cloud Scheduler; do not assume automatic backups are active until verified).
- [ ] Confirm Vercel Cron job `/api/cron/publish-dispatcher` is enabled and `CRON_SECRET` is configured.

## 4. External Platform Approvals (When Enabling Live Channels)
- [ ] Google OAuth Consent Screen verified for sensitive/restricted Apps Script & Drive scopes before non-test users authorize.
- [ ] Meta App Review completed for Advanced Access (`instagram_content_publish`, `pages_manage_posts`, `instagram_manage_messages`) before public workspace use.
- [ ] TikTok Content Posting API audit completed before switching from `SELF_ONLY` draft/sandbox publishing to public posting.
- [ ] Google Business Profile API access request approved by Google before enabling GBP live publishing/review replies.
