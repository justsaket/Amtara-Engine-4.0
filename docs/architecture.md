# Antara Engine 4.0 — Architecture (Phases 1 & 2)

## Overview

Antara Engine 4.0 is architected on the **Next.js App Router** (`src/app`) with strict separation between public marketing views, authenticated tenant-scoped dashboard modules, trusted server-side route handlers, real Google Workspace / Apps Script control plane adapters, and future Phase 3–5 placeholders.

```
src/
├── app/
│   ├── api/
│   │   ├── auth/                   # Session cookies & user profile / deletion
│   │   ├── config/                 # Autonomous config snapshot & bootstrap
│   │   ├── health/                 # Non-blocking runtime diagnostic endpoint
│   │   ├── integrations/google/    # Platform Google OAuth config, CSRF authorize, callback
│   │   ├── onboarding/             # Initial workspace + starter brand creation
│   │   └── workspaces/[workspaceId]/
│   │       ├── google/             # Connections, token validation, 16-check Doctor
│   │       ├── apps-script/        # Discovery, projects, content/snapshots, versions,
│   │       │                       # deployments, allowlisted execute, triggers, audit
│   │       └── ...                 # Brands, members, invitations, settings, notifications
│   ├── dashboard/                  # Protected SaaS shell (Phases 1-2 active + Phase 3-5 placeholders)
│   ├── login/ register/ forgot-password/ onboarding/
│   ├── product/ features/ privacy/ terms/
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                    # Public homepage
├── components/
│   ├── apps-script/                # GoogleOAuthHub, DoctorPanel, ProjectExplorerPanel,
│   │                               # SourceEditorPanel, DeploymentsVersionsPanel,
│   │                               # ExecutionTriggersAuditPanel, AppsScriptWorkspaceConsole
│   ├── auth/                       # AuthGuard + Firebase status banners
│   ├── dashboard/                  # PhasePlaceholderView for Phases 3-5
│   ├── layout/                     # PublicHeader, PublicFooter, DashboardShell
│   └── providers/                  # ErrorBoundary, AuthContext, WorkspaceContext
├── lib/
│   ├── config/manager.ts           # Autonomous configuration inspection & 7-state classification
│   ├── firebase/                   # Browser SDK initialization + Storage logo helper
│   ├── google/                     # OAuth 2.0, Drive discovery, Apps Script API v1,
│   │                               # manifest/diff/validator, source-manager, templates,
│   │                               # triggers, capabilities, 16-check Doctor
│   ├── server/                     # Admin SDK, Firestore REST fallback, AES-256-GCM crypto,
│   │                               # secret manager, google-vault, platform-oauth, RBAC guard,
│   │                               # Phase 1 & Phase 2 repositories
│   ├── navigation.ts
│   ├── rbac.ts
│   ├── starter-brands.ts
│   └── validation.ts               # Strict Zod schemas
└── types/domain.ts                 # Canonical TypeScript domain types
```

## Request Lifecycle & Tenant Isolation

1. **Client Auth:** Users sign in via Firebase Auth (`Email/Password` or identity-only `GoogleAuthProvider`). Client API calls attach the Firebase ID token in `Authorization: Bearer <token>` and maintain an `HttpOnly`, `SameSite=Lax` session cookie via `/api/auth/session`.
2. **Server Verification (`src/lib/server/auth.ts`):** Route handlers verify the Bearer token (via Firebase Admin Auth when a service account is configured, or Firebase Identity Toolkit verification when operating in lightweight client/REST mode).
3. **Tenant Guard (`src/lib/server/tenant-guard.ts` & `repositories.ts`):** Every `/api/workspaces/[workspaceId]/*` handler loads `/workspaces/{workspaceId}/members/{uid}`, validates active status + RBAC permission (`evaluateTenantAccess`), and asserts resource ownership (`assertCrossTenantMatch`).
4. **Dual Persistence Layer (`getStore` & `google-vault.ts`):**
   - When explicit Firebase Admin credentials are supplied, server handlers run via `firebase-admin/firestore`.
   - When Admin service-account credentials are omitted locally, user-authenticated API requests persist through `FirestoreRestClient` bounded by `firestore.rules`, while server-only OAuth transactions and connection vault payloads operate via `0o600` `.antara/vault/` and `.antara/internal-secrets.json` and reconcile metadata cleanly into Firestore once the user resumes in `/dashboard/integrations`.
   - `createDevelopmentTestStore` (`isProductionPersistence: false`) is strictly isolated to automated unit tests.

## Multi-Phase Architecture Boundaries

- **Phase 1 (Complete):** Tenant workspaces, 5-tier RBAC, Brand Studio, 12-category Settings Center, Security & Key Management.
- **Phase 2 (Complete):** Universal Google OAuth Hub, Drive Apps Script discovery, template-based creation/import, protected code updates with snapshot rollback, immutable versions, deployments, allowlisted execution, idempotent triggers, 16-check Doctor, and audit ledger (`/dashboard/integrations`, `/dashboard/apps-script`).
- **Phase 3:** AI Command Center & Agent Team (`/dashboard/command-center`, `/dashboard/agents`)
- **Phase 4:** Automation Engine & Content Studio (`/dashboard/automations`, `/dashboard/content-studio`, `/dashboard/workflows`)
- **Phase 5:** Multi-channel Publishing, Approvals & Verified Analytics (`/dashboard/publishing`, `/dashboard/approvals`, `/dashboard/analytics`)
