'use client';

import React from 'react';
import Link from 'next/link';

export default function GlobalErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-16 text-slate-900">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8">
        <p className="font-mono text-xs font-medium text-rose-700">Application Recovery</p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-slate-900">
          Something went wrong while rendering this view
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Your persisted workspace records remain safe. You can retry loading this screen or
          inspect System Health if the issue persists.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-slate-500">Reference: {error.digest}</p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Try Again
          </button>
          <Link
            href="/dashboard"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Workspace Overview
          </Link>
        </div>
      </div>
    </div>
  );
}
