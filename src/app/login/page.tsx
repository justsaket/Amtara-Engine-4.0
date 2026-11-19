'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, RefreshCw, ShieldCheck } from 'lucide-react';
import { PublicFooter } from '@/components/layout/PublicFooter';
import { PublicHeader } from '@/components/layout/PublicHeader';
import { useAuth } from '@/components/providers/AuthContext';

function formatAuthError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : fallback;
  if (raw.includes('auth/popup-blocked')) {
    return 'Your browser blocked the Google sign-in popup. Allow popups for this site (or open the preview in a new browser tab) and click Continue with Google Identity again.';
  }
  if (raw.includes('auth/cancelled-popup-request')) {
    return 'A Google sign-in window is already open. Complete sign-in there or click Continue with Google Identity again.';
  }
  if (raw.includes('auth/popup-closed-by-user')) {
    return 'Google sign-in popup was closed before completing authentication.';
  }
  if (raw.includes('auth/unauthorized-domain')) {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    return `Domain "${host}" is not authorized in Firebase Authentication. Open Antara via your AI Studio preview URL or add "${host}" under Firebase Console -> Authentication -> Settings -> Authorized domains.`;
  }
  if (raw.includes('auth/network-request-failed')) {
    return 'Network request failed while contacting Google Identity. Check your internet connection or disable strict third-party blockers for Firebase Auth and retry.';
  }
  if (raw.includes('auth/internal-error')) {
    return 'Google sign-in encountered a browser popup/iframe restriction. Open the preview in a dedicated tab or allow popups & third-party cookies for accounts.google.com and try again.';
  }
  if (raw.includes('auth/operation-not-allowed')) {
    return 'Email/password sign-in is currently disabled on this Firebase project. Use "Continue with Google Identity" above, or enable Email/Password under Firebase Console -> Authentication -> Sign-in method.';
  }
  if (raw.includes('auth/invalid-credential') || raw.includes('auth/wrong-password')) {
    return 'Incorrect email or password. Verify your credentials or sign in with Google Identity.';
  }
  return raw;
}

function GoogleMark() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.45 1.14-4.06 1.14-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.28v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.38l4-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.62l4 3.1c.95-2.84 3.6-4.95 6.72-4.95z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const {
    firebaseUser,
    profile,
    loading,
    isFirebaseReady,
    firebaseError,
    authError,
    clearAuthError,
    signInWithEmail,
    signInWithGoogleIdentity,
    refreshProfile,
  } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && firebaseUser && profile) {
      router.replace(profile.onboardingCompleted ? '/dashboard' : '/onboarding');
    }
  }, [loading, firebaseUser, profile, router]);

  async function handleGoogleLogin() {
    setError(null);
    clearAuthError();
    setSubmitting(true);
    try {
      const userProfile = await signInWithGoogleIdentity();
      router.push(userProfile.onboardingCompleted ? '/dashboard' : '/onboarding');
    } catch (err) {
      setError(formatAuthError(err, 'Google identity sign-in failed.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetrySession() {
    setError(null);
    clearAuthError();
    setSubmitting(true);
    try {
      const userProfile = await refreshProfile();
      if (userProfile) {
        router.push(userProfile.onboardingCompleted ? '/dashboard' : '/onboarding');
      }
    } catch (err) {
      setError(formatAuthError(err, 'Unable to finalize authenticated session.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    clearAuthError();
    setSubmitting(true);
    try {
      const userProfile = await signInWithEmail(email, password);
      router.push(userProfile.onboardingCompleted ? '/dashboard' : '/onboarding');
    } catch (err) {
      setError(formatAuthError(err, 'Unable to sign in.'));
    } finally {
      setSubmitting(false);
    }
  }

  const displayedError = error || authError;

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <PublicHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-14 sm:px-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
            Boundary A · Antara Identity
          </p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-slate-900">
            Sign in to Antara Engine
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Access your multi-tenant workspace, brand profiles, and settings center.
          </p>

          {!isFirebaseReady && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              {firebaseError}
            </div>
          )}

          {displayedError && (
            <div
              role="alert"
              className="mt-5 flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-800"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{displayedError}</span>
            </div>
          )}

          {!loading && firebaseUser && !profile && (
            <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-3.5 text-sm text-blue-900">
              <p className="font-medium">
                Signed in as {firebaseUser.email || 'Google Account'} — finishing session sync.
              </p>
              <button
                type="button"
                onClick={handleRetrySession}
                disabled={submitting}
                className="mt-2.5 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {submitting ? 'Syncing session…' : 'Complete Workspace Sign-In'}
              </button>
            </div>
          )}

          <div className="mt-6">
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={submitting || !isFirebaseReady}
              className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GoogleMark />
              {submitting ? 'Connecting to Google…' : 'Continue with Google Identity'}
            </button>

            <p className="mt-3 flex items-start gap-2 text-xs text-slate-500">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>
                Antara account sign-in only. Google Workspace, Drive, YouTube, and Apps
                Script scopes are never requested during login.
              </span>
            </p>
          </div>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
              Or email & password
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="login-email"
                className="block text-sm font-medium text-slate-800"
              >
                Email address
              </label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="login-password"
                  className="block text-sm font-medium text-slate-800"
                >
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-blue-700 hover:text-blue-800"
                >
                  Forgot password?
                </Link>
              </div>
              <input
                id="login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !isFirebaseReady}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Signing in…' : 'Sign In with Email'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <p className="mt-6 border-t border-slate-100 pt-5 text-center text-sm text-slate-600">
            New to Antara Engine?{' '}
            <Link
              href="/register"
              className="font-medium text-blue-700 hover:text-blue-800"
            >
              Create an account
            </Link>
          </p>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
