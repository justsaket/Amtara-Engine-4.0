# GitHub & Vercel Deployment Guide

## 1. Repository Readiness

- `.gitignore` excludes `node_modules/`, `.next/`, `dist/`, `.antara/`, `.env*` (except `.env.example`), and temporary browser verification artifacts.
- Never commit `.antara/internal-secrets.json`, `.antara/vault/`, `.env.local`, or service-account JSON key files.
- Verify clean local checks before pushing to GitHub:
  ```bash
  npm test
  npm run lint
  npm run lint:rules
  npm run build
  ```

## 2. Vercel Project Setup

1. Import the GitHub repository into Vercel (Framework Preset: **Next.js**).
2. Configure core environment variables:
   - **Durable Encryption & Sessions (Required for Stateless Production):**
     - `SESSION_SECRET` (64-char hex or `>= 32` chars)
     - `ENCRYPTION_KEY` (64-char hex, 32 bytes)
     - `ENCRYPTION_KEY_VERSION=v1`
   - **Firebase Client (if overriding `firebase-applet-config.json`):**
     - `NEXT_PUBLIC_FIREBASE_API_KEY`
     - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
     - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
     - `NEXT_PUBLIC_FIREBASE_APP_ID`
     - Optional: `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_DATABASE_ID`
   - **Firebase Admin (recommended for stateless Vercel server callbacks & token vault):**
     - Either `FIREBASE_SERVICE_ACCOUNT_JSON` **or** `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
   - **Platform Google OAuth 2.0 (Phase 2 — optional at build time):**
     - Can be set via `GOOGLE_INTEGRATION_CLIENT_ID` & `GOOGLE_INTEGRATION_CLIENT_SECRET`, **or** saved encrypted once via the Workspace Owner UI in `/dashboard/integrations`.
     - Add your authorized redirect URI (`https://<your-domain>/api/integrations/google/callback`) to Google Cloud Console -> Credentials -> OAuth 2.0 Client ID.
   - **Runtime URL:** `APP_URL` is auto-inferred from `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL` if unset.
3. Optional Phase 3–5 variables (`GEMINI_API_KEY`, Meta/LinkedIn/TikTok/Canva credentials) remain unset without blocking Vercel builds (`next build`) or homepage/dashboard rendering.

## 3. Enabling Real Google Apps Script Execution in Google Cloud

To run real Apps Script operations against a live Google account:
1. Enable **Google Apps Script API** (`script.googleapis.com`) and **Google Drive API** (`drive.googleapis.com`) in your Google Cloud Console project.
2. Add your deployment redirect URI (`https://<domain>/api/integrations/google/callback`) in OAuth 2.0 Client settings.
3. Have the authorizing Google user switch **Google Apps Script API** to **ON** at `https://script.google.com/home/usersettings`.
4. Run the **16-Check Google Integration Doctor** inside `/dashboard/apps-script` or `/dashboard/integrations` to verify all checks pass before pushing code or deploying.

## 4. Deploying Firestore Security Rules & Storage

```bash
firebase deploy --only firestore:rules,firestore:indexes
```
Verify the rules lint clean before any release:
```bash
npm run lint:rules
```
