import Link from 'next/link';
import { ArrowRight, Layers, ShieldCheck } from 'lucide-react';

export function PhasePlaceholderView({
  phase,
  title,
  summary,
  plannedCapabilities,
  collectionPath,
}: {
  phase: 'Phase 2' | 'Phase 3' | 'Phase 4' | 'Phase 5';
  title: string;
  summary: string;
  plannedCapabilities: readonly string[];
  collectionPath: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-slate-500">
          {phase} Architectural Placeholder · Tenant Foundation Ready
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900">
          {title}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-600">
          {summary}
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
          <ShieldCheck className="h-4 w-4 text-blue-700" />
          Phase 1 Schema & Security Boundary Prepared
        </div>
        <p className="mt-2 text-xs text-slate-600">
          Workspace isolation and Firestore rules are already provisioned under{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px]">
            {collectionPath}
          </code>{' '}
          so {phase} modules can activate cleanly without restructuring tenants or auth.
        </p>

        <div className="mt-6 border-t border-slate-100 pt-5">
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
            Scheduled {phase} Capabilities
          </p>
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {plannedCapabilities.map((item) => (
              <li
                key={item}
                className="rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-100 pt-5">
          <Link
            href="/dashboard/brands"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            <Layers className="h-3.5 w-3.5" />
            Configure Brand Profiles
          </Link>
          <Link
            href="/dashboard/settings"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Inspect Readiness in Settings
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
