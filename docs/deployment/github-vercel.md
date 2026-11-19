# GitHub & Vercel Deployment Guide

## 1. Repository & CI Setup (GitHub)
Antara Engine 4.0 ships with a ready-to-run GitHub Actions CI workflow at `.github/workflows/ci.yml` that executes on every push and pull request to `main`/`master`:
1. Installs dependencies (`npm ci` when `package-lock.json` is committed, or `npm install --no-audit --no-fund`).
2. Runs `npm run typecheck` (`tsc --noEmit`).
3. Runs `npm run lint:rules` (Firestore security rules linter).
4. Runs `npm test` with `ENABLE_REAL_GOOGLE_INTEGRATION_TESTS="false"`.
5. Runs `npm run build` (Next.js production build).
6. Scans `.next/static/` to verify zero private keys or server secrets leaked into client bundles.

### Pushing From Local Export to GitHub
If initializing a fresh GitHub repository from this workspace:
```bash
git init -b main
npm install --package-lock-only
git add .
git commit -m "Release Antara Engine 4.0 (Phases 1-5)"
git remote add origin https://github.com/<your-org>/<your-repo>.git
git push -u origin main
```

> Verify `.gitignore` excludes `.env`, `.env.local`, `.antara/`, `.next/`, and `.playwright-cli/` before pushing.

## 2. Importing & Deploying to Vercel
1. Open the Vercel Dashboard → **Add New Project** → import your GitHub repository.
2. Framework preset is auto-detected as **Next.js** (Node.js 22 runtime).
3. Configure required Production Environment Variables (see `docs/deployment/environment-configuration.md`):
   - `APP_URL` and `NEXT_PUBLIC_APP_URL` (your production HTTPS domain)
   - `SESSION_SECRET` (64+ hex characters)
   - `ENCRYPTION_KEY` (64 hex characters / 32-byte key) and `ENCRYPTION_KEY_VERSION="v1"`
   - Firebase Client `NEXT_PUBLIC_FIREBASE_*` variables
   - `FIREBASE_SERVICE_ACCOUNT_JSON` (or individual `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_DATABASE_ID`)
   - `CRON_SECRET` (random secret for authenticating Vercel Cron requests to `/api/cron/publish-dispatcher`)
4. Configure optional provider credentials only for the AI, Google, or Social channels you want enabled.
5. Click **Deploy**.

## 3. Vercel Cron Configuration (`vercel.json`)
`vercel.json` defines the scheduled publishing dispatcher:
```json
{
  "crons": [
    {
      "path": "/api/cron/publish-dispatcher",
      "schedule": "*/5 * * * *"
    }
  ]
}
```
> **Note**: On Vercel Hobby plans, cron execution frequency may be restricted by Vercel plan limits (daily vs every 5 minutes on Pro). Verify your Vercel plan's Cron quota in Project Settings → Cron Jobs.

## 4. OAuth Redirect URIs After Custom Domain Setup
After connecting your production Vercel domain, register the exact HTTPS callback URLs in each external developer console you enable:
- Google OAuth: `https://<your-domain>/api/integrations/google/callback`
- Meta (Instagram/Facebook): `https://<your-domain>/api/integrations/social/meta/callback`
- LinkedIn: `https://<your-domain>/api/integrations/social/linkedin/callback`
- TikTok: `https://<your-domain>/api/integrations/social/tiktok/callback`
- Canva: `https://<your-domain>/api/integrations/social/canva/callback`
