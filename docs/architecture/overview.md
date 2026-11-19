# Architecture Overview — Antara Engine 4.0

## 1. High-Level System Architecture

Antara Engine 4.0 is structured as a modular, full-stack Next.js 16 App Router application (`src/app/`) backed by typed domain libraries (`src/lib/`), server-side repositories (`src/lib/server/`), Firebase Authentication, Cloud Firestore, and Firebase Storage.

### Core Layers
1. **Presentation & Navigation Layer (`src/app/`, `src/components/`)**
   - Public marketing & legal routes (`/`, `/features`, `/privacy`, `/terms`, `/login`, `/register`).
   - Authenticated multi-tenant workspace shell (`DashboardShell`) grouped into unified product areas: `Main`, `Intelligence`, `Content`, `Engagement`, `Performance`, `Automation`, `Management`, and `System`.
   - Next.js App Router recovery boundaries (`src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/dashboard/loading.tsx`, `src/app/dashboard/error.tsx`).

2. **Server API & Security Boundary (`src/app/api/`)**
   - Every authenticated route verifies a Firebase ID token via `requireAuthenticatedUser`, validates input payloads via Zod (`src/lib/validation.ts`), and enforces workspace membership + 5-tier RBAC permissions via `requireWorkspaceAccess`.
   - Sensitive operations apply sliding-window rate limiting (`src/lib/server/rate-limit.ts`), payload size checks, and structured secret-redacted logging (`src/lib/server/observability.ts`).
   - All `/api/*` responses include `Cache-Control: no-store, no-cache, must-revalidate, private`.

3. **Autonomous Configuration Layer (`src/lib/config/manager.ts`)**
   - Single authoritative configuration resolver across all five phases.
   - Detects environment variables, `firebase-applet-config.json`, ADC/Vercel metadata, and local CSPRNG-generated `.antara/internal-secrets.json`.
   - Classifies every subsystem (`READY`, `AUTO_GENERATED_LOCAL`, `OPTIONAL_NOT_CONFIGURED`, `ACTION_REQUIRED`) without crashing startup when optional providers are absent.

4. **Domain Engines (`src/lib/`)**
   - **Phase 1**: RBAC (`rbac.ts`), tenant guards (`server/tenant-guard.ts`), AES-256-GCM vault (`server/crypto.ts`), starter brands (`starter-brands.ts`).
   - **Phase 2**: Google OAuth PKCE & Apps Script Control Plane (`google/`).
   - **Phase 3**: Provider-independent AI Router, 9 Specialist Agents, Central Orchestrator, Research & Claim Evidence Engine, 20-category Brand Knowledge, 7-namespace Brand Memory, 8 Event Playbooks (`ai/`).
   - **Phase 4**: Content Factory & QA Gate, Media Pipeline & Canva Connect, Central Action Gateway (Modes A/B/C + Emergency Stop), 8-Provider Adapter Registry, Leased Scheduler, Signed Webhooks, Inbox/Reviews/Leads, Analytics & Experiments (`marketing/`).
   - **Phase 5**: Observability, rate limiting, schema integrity audits, 9-stage onboarding readiness, usage/cost visibility, executive overview, and Owner/Admin operational console.

5. **Persistence Layer (`src/lib/server/repositories*.ts`)**
   - Supports Firebase Admin SDK (`admin` mode), authenticated Firestore REST fallback (`rest` mode), and an explicit test-only in-memory store (`development_test_adapter`) that is never used silently in production requests.
   - Strictly isolated per workspace under `workspaces/{workspaceId}/...` enforced both by server tenant guards and deployed `firestore.rules`.
