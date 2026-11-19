# Antara Engine 4.0

**Production Multi-Tenant Autonomous Digital Marketing & Automation Platform**

Antara Engine 4.0 is a full-stack Next.js App Router, TypeScript, and Firebase/Firestore SaaS platform unifying workspace & brand governance (Phase 1), Google Workspace & Apps Script deployment management (Phase 2), a 9-agent multi-agent intelligence layer with persistent brand memory (Phase 3), an autonomous marketing production, approval, publishing, engagement, and analytics execution engine (Phase 4), and production observability, security hardening, and operational controls (Phase 5).

---

## Core Architecture

- **Framework**: Next.js 16.4.6 App Router, React 19, TypeScript, Tailwind CSS v4
- **Authentication & Database**: Firebase Authentication + Cloud Firestore (`ai-studio-e9bdfca4-ede1-4994-8b80-fba76fa44eb9` in project `rare-rainfall-prtgb`) + Firebase Storage
- **Default Timezone**: `Asia/Kolkata` (all scheduled jobs stored in UTC with explicit IANA timezone display)
- **Zero-Blocker Startup**: The Autonomous Configuration Manager detects available resources cleanly; missing optional third-party credentials (AI API keys, Google OAuth, Meta/LinkedIn/TikTok/Canva) never crash startup, builds, or unrelated dashboard modules.
- **Safety-First Autonomy**: Defaults every brand to **Mode B (`APPROVAL_REQUIRED`)**, binds human approvals to cryptographic SHA-256 `payloadHash`, blocks AI self-approval, and provides an instant **Emergency Stop** across workspace, brand, or platform scopes.

---

## Five-Phase Capability Summary

| Phase | Domain | Key Modules |
| --- | --- | --- |
| **Phase 1** | Foundation, Multi-Tenant Auth & Brands | Firebase Auth, 5-tier RBAC, multi-tenant workspaces, 4 editable starter brands (`Saket Personal`, `MagnArc`, `GreenWeld`, `Sapphire`), Autonomous Config Manager, AES-256-GCM secrets, audit logs |
| **Phase 2** | Google OAuth & Apps Script Control Plane | Google OAuth2 PKCE + AAD-bound encrypted credential vault, Apps Script project creation/sync/backups/versions/deployments/executions/triggers, reusable automation templates |
| **Phase 3** | Autonomous Intelligence Engine | Provider-independent AI router (Gemini / OpenAI / Anthropic / Gateway), 9 specialist agents, Central Orchestrator, SSRF-safe research & claim evidence engine, 20-category Brand Knowledge, 7-namespace Brand Memory, 8 event playbooks |
| **Phase 4** | Autonomous Marketing & Growth Execution | Content Factory + Quality Gate + Payload-Hash approval invalidation, Media Pipeline + Canva Connect, 8-provider capability matrix, Central Action Gateway (Modes A/B/C + Emergency Stop), leased publishing scheduler, signed webhooks, Social Inbox, Reviews, Leads, Ads governance, null-preserving Analytics & Experiments |
| **Phase 5** | Production Excellence & Hardening | Unified Executive Dashboard, 9-stage resumable onboarding, System Health & live Firestore latency probe, Usage & Cost visibility, Owner/Admin Console, Help & Sanitized Export, CSP & security headers, rate limiting, structured redacted logging, CI/CD workflow & documentation |

---

## Quick Start (Local Development)

```bash
npm install
npm run typecheck
npm run lint:rules
npm test
npm run dev
```

Open `http://localhost:3000`. Copy `.env.example` to `.env.local` only for the optional external providers you wish to activate.

---

## Verification Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Strict TypeScript verification (`tsc --noEmit`) |
| `npm run lint:rules` | ESLint validation of `firestore.rules` & `DRAFT_firestore.rules` |
| `npm test` | Runs all automated unit & end-to-end integration tests (`tests/*.test.ts`) |
| `npm run build` | Production Next.js build |

> **Safety Rule**: Keep `ENABLE_REAL_GOOGLE_INTEGRATION_TESTS="false"` in local and CI runs so automated tests never trigger live external writes.

---

## Documentation Index

- **Architecture**: `docs/architecture/overview.md`, `data-flow.md`, `security-model.md`
- **Deployment**: `docs/deployment/github-vercel.md`, `environment-configuration.md`, `production-release.md`, `rollback.md`
- **Database**: `docs/database/schema.md`, `migrations.md`, `backup-restore.md`
- **Integrations**: `docs/integrations/provider-capability-matrix.md`, `google-oauth.md`, `apps-script.md`, `social-platforms.md`
- **Operations**: `docs/operations/monitoring.md`, `incident-response.md`, `recovery.md`, `usage-and-costs.md`
- **User Guides**: `docs/user/onboarding.md`, `marketing-workflows.md`, `autonomy-settings.md`
- **Release & Audit**: `docs/release/phase-completion-matrix.md`, `final-acceptance-report.md`
