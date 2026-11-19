'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthContext';
import { useWorkspace } from '@/components/providers/WorkspaceContext';

export function AuthGuard({
  children,
  requireWorkspace = true,
}: {
  children: React.ReactNode;
  requireWorkspace?: boolean;
}) {
  const router = useRouter();
  const { firebaseUser, profile, loading, isFirebaseReady, firebaseError } = useAuth();
  const { workspaces, loading: wsLoading } = useWorkspace();

  useEffect(() => {
    if (!loading && isFirebaseReady && !firebaseUser) {
      router.replace('/login');
    }
  }, [loading, isFirebaseReady, firebaseUser, router]);

  useEffect(() => {
    if (
      requireWorkspace &&
      !loading &&
      !wsLoading &&
      firebaseUser &&
      profile &&
      !profile.onboardingCompleted &&
      workspaces.length === 0
    ) {
      router.replace('/onboarding');
    }
  }, [
    requireWorkspace,
    loading,
    wsLoading,
    firebaseUser,
    profile,
    workspaces.length,
    router,
  ]);

  if (!isFirebaseReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-16">
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-3 text-amber-700">
            <ShieldAlert className="h-5 w-5" />
            <span className="font-mono text-xs uppercase tracking-wider">
              Authentication Unavailable
            </span>
          </div>
          <h1 className="mt-3 text-xl font-semibold text-slate-900">
            Firebase Client SDK is not configured
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {firebaseError ||
              'Supply NEXT_PUBLIC_FIREBASE_* environment variables or firebase-applet-config.json to authenticate into protected workspace routes.'}
          </p>
          <div className="mt-6 flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              View Sign-In Status
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Return Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (loading || (firebaseUser && requireWorkspace && wsLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-blue-700" />
          <p className="text-sm text-slate-600">Verifying workspace session…</p>
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
            Protected Console
          </p>
          <h1 className="mt-2 text-xl font-semibold text-slate-900">
            Authentication required
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Sign in with your Antara Engine account to open this workspace.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-800"
          >
            Go to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
