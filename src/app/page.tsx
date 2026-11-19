import Link from 'next/link';
import { ArrowRight, KeyRound, Layers, Lock, ShieldCheck } from 'lucide-react';
import { PublicFooter } from '@/components/layout/PublicFooter';
import { PublicHeader } from '@/components/layout/PublicHeader';

const FOUR_BOUNDARIES = [
  {
    code: 'A',
    title: 'Antara User Identity',
    summary:
      'Email/password and Google Identity login verify who you are inside Antara Engine without requesting Workspace, Drive, or Apps Script permissions.',
  },
  {
    code: 'B',
    title: 'Google Workspace Consent',
    summary:
      'External Google OAuth 2.0 connections live inside an encrypted workspace boundary with explicit incremental scope consent, independent of Antara login.',
  },
  {
    code: 'C',
    title: 'Apps Script Control Plane',
    summary:
      'Real Apps Script API & Drive discovery control plane with protected 10-step source sync, snapshots, deployments, allowlisted runs, and Doctor diagnostics.',
  },
  {
    code: 'D',
    title: 'External Platform Adapters',
    summary:
      'Meta, LinkedIn, TikTok, Canva, and AI providers evaluate readiness independently so missing credentials never block workspace operations.',
  },
] as const;

const PHASE_ROADMAP = [
  {
    phase: 'Phase 1 · Active',
    title: 'Foundation, Auth & Multi-Tenant Governance',
    detail:
      'Next.js App Router core, autonomous configuration engine, Firebase Auth, isolated workspaces, starter brand profiles, RBAC, and centralized settings.',
    active: true,
  },
  {
    phase: 'Phase 2 · Active',
    title: 'Universal OAuth & Apps Script Engine',
    detail:
      'Explicit Google Workspace & Apps Script authorization, AES-256-GCM vault, Drive discovery, protected code sync, immutable versions, deployments & Doctor.',
    active: true,
  },
  {
    phase: 'Phase 3 · Active',
    title: 'AI Command Center & Specialized Agents',
    detail:
      'Central orchestrator, 9 specialist agents, 20-category brand facts, 7-namespace memory, claim verification, strategy planner & 8 playbooks.',
    active: true,
  },
  {
    phase: 'Phase 4 · Active',
    title: 'Autonomous Marketing, Publishing & Growth',
    detail:
      'Content Factory, Canva & Media Pipeline, Central Action Gateway (Modes A/B/C + Emergency Stop), 6 social adapters, IANA scheduler, Inbox/Reviews/Leads & Analytics.',
    active: true,
  },
  {
    phase: 'Phase 5 · Active',
    title: 'Production Hardening, Observability & Release',
    detail:
      'Unified executive console, live System Health, Usage & Cost visibility, structured secret-redacted logging, security headers, CI/CD & recovery runbooks.',
    active: true,
  },
] as const;

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <PublicHeader />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:px-8 lg:py-24">
            <div className="lg:col-span-6">
              <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
                Production Release · Next.js App Router
              </p>
              <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
                Multi-tenant infrastructure for autonomous brand operations.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
                Antara Engine 4.0 separates application identity, encrypted credential
                storage, and tenant workspaces into a clean production architecture that
                boots without manual environment-variable bottlenecks.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  href="/register"
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-800"
                >
                  Initialize Workspace
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/product"
                  className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Inspect Architecture
                </Link>
              </div>

              <p className="mt-6 font-mono text-xs text-slate-500">
                Asia/Kolkata Default · AES-256-GCM Vault · Strict Firestore Rules
              </p>
            </div>

            <div className="lg:col-span-6">
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-sm">
                <img
                  src="/images/hero-antara-architecture.jpg"
                  alt="Antara Engine multi-tenant workspace and security architecture preview"
                  className="aspect-[16/10] w-full object-cover"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Four Separated Boundaries */}
        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="font-mono text-xs uppercase tracking-widest text-slate-500">
              Identity & Consent Architecture
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Four strictly separated authorization boundaries.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Every credential and user action is isolated cleanly so logging into the
              platform never implicitly grants external Workspace or channel access.
            </p>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FOUR_BOUNDARIES.map((item) => (
              <div
                key={item.code}
                className="rounded-xl border border-slate-200 bg-white p-6"
              >
                <span className="font-mono text-xs font-semibold text-blue-700">
                  Boundary {item.code}
                </span>
                <h3 className="mt-2 text-base font-semibold text-slate-900">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  {item.summary}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Multi-Brand Governance Showcase */}
        <section className="border-y border-slate-200 bg-white py-20">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
            <div className="lg:col-span-6">
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                <img
                  src="/images/brand-studio-preview.jpg"
                  alt="Multi-brand workspace profile editor inside Antara Engine"
                  className="aspect-[16/10] w-full object-cover"
                />
              </div>
            </div>

            <div className="lg:col-span-6">
              <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
                Workspace & Brand Profiles
              </p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                Isolated brand workspaces with editable governance baselines.
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">
                Bootstrap structured, editable brand profiles during onboarding —
                including Saket Personal, MAGNARC, GreenWeld, and Sapphire — or create
                custom tenant brand profiles backed by Firebase Storage logo uploads
                and role-based access control.
              </p>

              <dl className="mt-8 grid gap-5 sm:grid-cols-3">
                <div className="border-t border-slate-200 pt-4">
                  <dt className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <ShieldCheck className="h-4 w-4 text-blue-700" />
                    Tenant Gate
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    5-Role RBAC
                  </dd>
                </div>
                <div className="border-t border-slate-200 pt-4">
                  <dt className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <KeyRound className="h-4 w-4 text-blue-700" />
                    Master Key Rule
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    Outside Firestore
                  </dd>
                </div>
                <div className="border-t border-slate-200 pt-4">
                  <dt className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <Layers className="h-4 w-4 text-blue-700" />
                    Brand Isolation
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900">
                    Per-Workspace Scope
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* Five-Phase Roadmap */}
        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-slate-500">
                Architectural Discipline
              </p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                Five-phase rollout without architectural rewrites.
              </h2>
            </div>
            <Link
              href="/features"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-800"
            >
              Inspect Platform Capabilities
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-5">
            {PHASE_ROADMAP.map((stage) => (
              <div
                key={stage.phase}
                className={`rounded-xl border p-5 ${
                  stage.active
                    ? 'border-blue-200 bg-white'
                    : 'border-slate-200 bg-slate-50/70'
                }`}
              >
                <p
                  className={`font-mono text-[11px] font-semibold uppercase tracking-wider ${
                    stage.active ? 'text-blue-700' : 'text-slate-500'
                  }`}
                >
                  {stage.phase}
                </p>
                <h3 className="mt-2 text-sm font-semibold text-slate-900">
                  {stage.title}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  {stage.detail}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-14 flex flex-col items-start justify-between gap-6 rounded-xl border border-slate-200 bg-slate-900 p-8 text-white sm:flex-row sm:items-center">
            <div className="max-w-xl">
              <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-blue-300">
                <Lock className="h-3.5 w-3.5" />
                Zero-Blocker Configuration Active
              </div>
              <h2 className="mt-2 font-display text-xl font-semibold">
                Ready to initialize your Antara workspace?
              </h2>
              <p className="mt-1.5 text-sm text-slate-300">
                Start with email/password or Google Identity, select your starter brand
                profiles, and inspect real infrastructure status inside Settings Center.
              </p>
            </div>
            <Link
              href="/register"
              className="shrink-0 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-100"
            >
              Create Account
            </Link>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
