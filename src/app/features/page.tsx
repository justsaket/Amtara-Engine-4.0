import Link from 'next/link';
import { Check } from 'lucide-react';
import { PublicFooter } from '@/components/layout/PublicFooter';
import { PublicHeader } from '@/components/layout/PublicHeader';

export const metadata = {
  title: 'Features & Active Phases',
};

const PLATFORM_MODULES = [
  {
    group: 'Identity & Onboarding (Phase 1)',
    items: [
      'Email/password sign-up, sign-in, and password reset via Firebase Auth',
      'Identity-only Google Sign-In separated strictly from Workspace/Drive OAuth',
      'Automatic onboarding with Asia/Kolkata default workspace timezone',
      'Self-service account deletion request workflow & HTTP-only signed sessions',
    ],
  },
  {
    group: 'Multi-Tenant Workspaces & Brands (Phase 1)',
    items: [
      'Owner, Administrator, Manager, Editor, and Viewer RBAC matrix',
      'Starter brand baselines: Saket Personal, MAGNARC, GreenWeld, Sapphire',
      'Full brand editing: audience, voice, pillars, visual colors, restrictions, logos',
      'Centralized 12-category Settings Center & append-only governance audit logs',
    ],
  },
  {
    group: 'Google OAuth & Apps Script Control Plane (Phase 2)',
    items: [
      'Zero-secret client bundle with AES-256-GCM AAD-bound Google token vault',
      'Google Drive Apps Script discovery, 8 starter templates & project creation',
      'Protected 10-step remote code sync, immutable backup snapshots & rollback',
      'Versions, Web App/API deployments, allowlisted execution, triggers & 16-check Doctor',
    ],
  },
  {
    group: 'Autonomous Intelligence Engine (Phase 3)',
    items: [
      'Central Orchestrator + 9 specialist agents (Market Radar through Results & ROI)',
      '20-category Brand Knowledge, 7-namespace Memory & Claim Verification Engine',
      '7/14/30-day Strategy Planner, Content Drafts & 8 Event Playbooks (draft-only boundary)',
      'Zero-blocker provider readiness across Gemini, AI Gateway, OpenAI, and Anthropic',
    ],
  },
  {
    group: 'Autonomous Marketing & Publishing Engine (Phase 4)',
    items: [
      'Content Factory, Creative Studio (Canva Connect) & validated Media Asset Pipeline',
      'Central Action Gateway with Modes A / B / C, payload-hash approvals & Emergency Stop',
      'Official adapters for Instagram, Facebook, LinkedIn, YouTube, TikTok, GBP & Meta Ads',
      'IANA timezone scheduler, Webhooks, Social Inbox, Reviews, Leads, Experiments & 8 Apps Script templates',
    ],
  },
  {
    group: 'Production Hardening, Observability & Governance (Phase 5)',
    items: [
      'Unified Executive Overview, 9-stage resumable onboarding & cohesive navigation',
      'Live System Health Center, schema integrity audit & Usage/Cost visibility',
      'Security response headers, rate limiting, secret-redacted logging & sanitized JSON export',
      'Owner/Admin Console, Help & Recovery guides, GitHub Actions CI & Vercel release docs',
    ],
  },
] as const;

export default function FeaturesPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <PublicHeader />
      <main className="flex-1">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
            <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
              Platform Capabilities
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              Complete Antara Engine 4.0 — Phases 1–5 unified and verified.
            </h1>
            <p className="mt-4 max-w-2xl text-base text-slate-600">
              Multi-tenant governance, autonomous configuration, Google OAuth 2.0, the Apps
              Script Control Plane, the 9-Agent Intelligence Engine, Autonomous Marketing
              Execution, and Production Observability operate as one cohesive platform.
            </p>
          </div>
        </section>

        <section className="mx-auto grid max-w-5xl gap-6 px-4 py-16 sm:grid-cols-2 sm:px-6 lg:px-8">
          {PLATFORM_MODULES.map((section) => (
            <div
              key={section.group}
              className="rounded-xl border border-slate-200 bg-white p-6"
            >
              <h2 className="text-base font-semibold text-slate-900">
                {section.group}
              </h2>
              <ul className="mt-4 space-y-3">
                {section.items.map((line) => (
                  <li key={line} className="flex items-start gap-2.5 text-sm text-slate-600">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="mx-auto max-w-5xl px-4 pb-20 sm:px-6 lg:px-8">
          <div className="rounded-xl border border-slate-200 bg-white p-6 sm:flex sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Inspect live settings and capability states inside the console
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                All external adapters clearly state their readiness without blocking core workflows.
              </p>
            </div>
            <Link
              href="/login"
              className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 sm:mt-0"
            >
              Sign In
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
