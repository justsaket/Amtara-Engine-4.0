import Link from 'next/link';
import { PublicFooter } from '@/components/layout/PublicFooter';
import { PublicHeader } from '@/components/layout/PublicHeader';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <PublicHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center px-4 py-20 sm:px-6">
        <p className="font-mono text-xs font-medium text-blue-700">HTTP 404</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-900">
          Page not found
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          The route you requested does not exist in this workspace or may have been moved.
          Return to the workspace overview or sign in to continue.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Go to Dashboard
          </Link>
          <Link
            href="/"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Return Home
          </Link>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
