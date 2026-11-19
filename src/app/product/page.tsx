import Link from 'next/link';
import { ArrowRight, Cpu, Database, KeyRound, Shield } from 'lucide-react';
import { PublicFooter } from '@/components/layout/PublicFooter';
import { PublicHeader } from '@/components/layout/PublicHeader';

export const metadata = {
  title: 'Product Architecture',
};

export default function ProductPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <PublicHeader />
      <main className="flex-1">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
            <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
              Product Architecture
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              Built cleanly from Phase 1 to support five phases of intelligent automation.
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-slate-600">
              Instead of hardcoding brittle environment requirements or coupling user login
              with third-party OAuth permissions, Antara Engine 4.0 establishes explicit
              tenant boundaries, autonomous secret classification, and modular Next.js App
              Router endpoints.
            </p>
          </div>
        </section>

        <section className="mx-auto grid max-w-5xl gap-6 px-4 py-16 sm:grid-cols-2 sm:px-6 lg:px-8">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <Database className="h-5 w-5 text-blue-700" />
            <h2 className="mt-3 text-lg font-semibold text-slate-900">
              Multi-Tenant Firestore Model
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Users, membership indices, workspaces, brands, integration records,
              centralized application settings, audit logs, and notifications are partitioned
              per workspace and locked behind strict Firestore security rules.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <KeyRound className="h-5 w-5 text-blue-700" />
            <h2 className="mt-3 text-lg font-semibold text-slate-900">
              Master Key Isolation & Rotation
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              AES-256-GCM encryption binds ciphertexts with workspace additional
              authenticated data (AAD), keeps master keys out of Firestore, and supports
              seamless key version rotation.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <Shield className="h-5 w-5 text-blue-700" />
            <h2 className="mt-3 text-lg font-semibold text-slate-900">
              Five-Role Workspace Governance
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Owner, Administrator, Manager, Editor, and Viewer permissions are enforced on
              every API route and rule evaluation — preventing cross-tenant escalation.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <Cpu className="h-5 w-5 text-blue-700" />
            <h2 className="mt-3 text-lg font-semibold text-slate-900">
              Autonomous Configuration Manager
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Detects existing Firebase config, Vercel runtime metadata, and optional
              adapters, classifying every item into seven transparent operational states.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 pb-20 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Inspect live infrastructure capability states
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Sign in or create an account to manage workspaces, brands, and settings.
              </p>
            </div>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
