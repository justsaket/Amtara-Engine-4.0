import Link from 'next/link';

export function PublicFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-xs font-semibold text-white">
                AE
              </span>
              <span className="font-display text-sm font-semibold text-slate-900">
                Antara Engine 4.0
              </span>
            </div>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-600">
              Multi-tenant SaaS automation platform featuring Firebase identity,
              tenant-isolated workspaces, editable brand governance, and the Google
              Apps Script Control Plane.
            </p>
          </div>

          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Platform
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>
                <Link href="/product" className="hover:text-slate-900">
                  Product Architecture
                </Link>
              </li>
              <li>
                <Link href="/features" className="hover:text-slate-900">
                  Capabilities & Roadmap
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="hover:text-slate-900">
                  Workspace Console
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Governance
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>
                <Link href="/privacy" className="hover:text-slate-900">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-slate-900">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/login" className="hover:text-slate-900">
                  Account Sign In
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col justify-between gap-4 border-t border-slate-100 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center">
          <p>Antara Engine 4.0 · Multi-Tenant Automation Platform</p>
          <p className="font-mono">Antara Engine 4.0 · Phases 1–5 Complete Production Architecture</p>
        </div>
      </div>
    </footer>
  );
}
