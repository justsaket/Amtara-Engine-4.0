'use client';

import React from 'react';
import Link from 'next/link';

export default function DashboardErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-xl border border-rose-200 bg-white p-6">
      <p className="font-mono text-xs font-medium text-rose-700">Module Error Boundary</p>
      <h2 className="mt-1 font-display text-xl font-semibold text-slate-900">
        Unable to display this workspace module
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Other workspace modules and scheduled jobs remain unaffected. Retry this module or check
        System Health for live diagnostics.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-slate-500">Error Digest: {error.digest}</p>
      )}
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
        >
          Retry Module
        </button>
        <Link
          href="/dashboard/system-health"
          className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Inspect System Health
        </Link>
      </div>
    </div>
  );
}
