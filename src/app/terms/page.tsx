import { PublicFooter } from '@/components/layout/PublicFooter';
import { PublicHeader } from '@/components/layout/PublicHeader';

export const metadata = {
  title: 'Terms of Service',
};

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <PublicHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-slate-200 bg-white p-8 sm:p-10">
          <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
            Workspace Terms
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-slate-900">
            Terms of Service
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            These terms govern access to the Antara Engine 4.0 multi-tenant automation,
            multi-agent intelligence, Google Apps Script control plane, and marketing execution
            platform.
          </p>

          <div className="mt-8 space-y-6 text-sm leading-relaxed text-slate-700">
            <section>
              <h2 className="text-base font-semibold text-slate-900">
                1. Multi-Tenant Workspace Ownership &amp; Autonomy Responsibility
              </h2>
              <p className="mt-2">
                Workspace owners are responsible for team role assignments (Owner,
                Administrator, Manager, Editor, Viewer), brand accuracy rules, explicit
                human-in-the-loop approvals, Mode A/B/C autonomy scopes, and paid advertising
                budget limits configured inside their workspace.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900">
                2. Third-Party Platform Policies &amp; Honest Readiness
              </h2>
              <p className="mt-2">
                Antara Engine connects to external services (Google Workspace, Apps Script, Meta,
                LinkedIn, YouTube, TikTok, Google Business Profile, Canva) solely via official
                APIs and authorized credentials. Platform-level app reviews, API quotas, and
                account-type eligibility remain governed by each third-party provider.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900">
                3. Security Boundaries &amp; Prohibited Use
              </h2>
              <p className="mt-2">
                Attempting cross-tenant reads, unauthorized role escalation, automated bypass of
                approval gateways, spamming without verified lead consent, or secret extraction
                is strictly prohibited and recorded in append-only workspace audit logs.
              </p>
            </section>

            <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              <strong className="font-semibold">Pre-Commercial Legal Review Notice:</strong> Review
              and adapt these operational terms with qualified legal counsel prior to offering
              paid multi-customer subscriptions.
            </section>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
