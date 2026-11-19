# Autonomous Configuration Model

## Design Principle

Antara Engine 4.0 never blocks builds, boot, homepage rendering, onboarding flows, or unrelated dashboard pages when optional provider credentials are absent. Instead, `resolveAutonomousConfiguration()` (`src/lib/config/manager.ts`) inspects the runtime cleanly and reports safe, masked status diagnostics via `GET /api/config/status` and `/dashboard/settings`.

## Environment Inspection Priority

1. **Firebase Client Configuration:**
   - Uses `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` when defined.
   - Falls back cleanly to repository-mounted `firebase-applet-config.json`.
   - Resolves `firestoreDatabaseId` from `FIREBASE_DATABASE_ID` / `NEXT_PUBLIC_FIREBASE_DATABASE_ID` / `firebase-applet-config.json`, defaulting to `(default)`.
2. **Firebase Admin SDK:**
   - Supports **either** `FIREBASE_SERVICE_ACCOUNT_JSON` **or** individual fields (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`). Never requires both.
   - Detects project ID mismatches (`projectConflict`) if client and service-account configs point to different Firebase projects.
   - Falls back cleanly to user Bearer ID-token Firestore REST requests (`FirestoreRestClient`) enforced by deployed `firestore.rules` when Admin service-account credentials are absent, paired with `0o600` local encrypted `.antara/vault/` storage for unauthenticated OAuth GET callbacks.
3. **Internal Secrets (`SESSION_SECRET`, `INTERNAL_SIGNING_SECRET`, `ENCRYPTION_KEY`):**
   - Uses environment variables if provided.
   - Otherwise persists generated CSPRNG keys locally into `.antara/internal-secrets.json` (`0o600`), or surfaces one-time Vercel setup guidance in Settings -> Encryption Status.
4. **Platform Google OAuth Client (Phase 2):**
   - Resolves from `GOOGLE_INTEGRATION_CLIENT_ID` / `GOOGLE_INTEGRATION_CLIENT_SECRET` (or `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), OR from the encrypted vault configured once inside `/dashboard/integrations`.
   - Computes dynamic exact callback redirect URIs from the active request origin (`${origin}/api/integrations/google/callback`) cleanly across `localhost:3000`, Cloud Run previews, and Vercel domains.
   - **Important Google User Requirement for Real API Execution:** Beyond authorizing scopes in OAuth consent, the Google user account must enable the personal toggle **Google Apps Script API -> ON** at `https://script.google.com/home/usersettings`. The 16-check Google Integration Doctor detects and surfaces this directly.
5. **Optional Phase 3–5 Integrations:**
   - `GEMINI_API_KEY`, `META_APP_*`, `LINKEDIN_CLIENT_*`, `TIKTOK_CLIENT_*`, `CANVA_CLIENT_*` remain optional and isolated.
6. **Opt-In Real Integration Testing Switch:**
   - `ENABLE_REAL_GOOGLE_INTEGRATION_TESTS` defaults strictly to `false`.
