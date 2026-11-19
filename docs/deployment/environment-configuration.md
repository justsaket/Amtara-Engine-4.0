# Environment Configuration Reference

Antara Engine 4.0 uses a single **Autonomous Configuration Manager** (`src/lib/config/manager.ts`) so the application boots, builds, and passes verification even when optional third-party credentials are absent.

## 1. Required for Production Serverless Deployment (Vercel)

| Variable | Scope | Purpose |
| --- | --- | --- |
| `APP_URL` | Server | Canonical HTTPS origin used to construct OAuth redirect URIs |
| `NEXT_PUBLIC_APP_URL` | Client | Public canonical origin |
| `SESSION_SECRET` | Server | Durable secret (32+ bytes hex). Auto-generated locally in `.antara/internal-secrets.json` if omitted |
| `ENCRYPTION_KEY` | Server | 32-byte AES-256-GCM master key (64 hex chars). Must NEVER be stored in Firestore |
| `ENCRYPTION_KEY_VERSION` | Server | Active key version label (e.g., `v1`) |
| `NEXT_PUBLIC_FIREBASE_*` | Client | Firebase Web App config (`API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, `APP_ID`, optional `DATABASE_ID`). Falls back to `firebase-applet-config.json` when present |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Server | Firebase Admin SDK service account JSON (or individual `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_DATABASE_ID`) |
| `CRON_SECRET` | Server | Shared bearer secret protecting `/api/cron/publish-dispatcher` |

## 2. Optional Key Rotation Variables
- `ENCRYPTION_KEY_PREVIOUS`
- `ENCRYPTION_KEY_PREVIOUS_VERSION`

Omit these unless actively rotating an existing `ENCRYPTION_KEY`.

## 3. Optional Phase 3 AI Providers
Configure one or more to enable live multi-agent model synthesis:
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `AI_GATEWAY_URL` + `AI_GATEWAY_API_KEY`
- `AI_DEFAULT_MODEL` (optional override)

When none are set, non-AI modules operate normally and AI runs return `AI_PROVIDER_NOT_CONFIGURED`.

## 4. Optional Phase 2 Google OAuth & Apps Script
- `GOOGLE_INTEGRATION_CLIENT_ID`
- `GOOGLE_INTEGRATION_CLIENT_SECRET`
- `GOOGLE_INTEGRATION_REDIRECT_URI` (defaults to `<APP_URL>/api/integrations/google/callback`)

## 5. Optional Phase 4 Social, Creative & Webhook Integrations
- **Meta**: `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`
- **LinkedIn**: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
- **TikTok**: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_WEBHOOK_SECRET`
- **Canva**: `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`

## 6. Automated Testing Guard
- `ENABLE_REAL_GOOGLE_INTEGRATION_TESTS="false"` — Must remain `false` in CI and standard test runs.
