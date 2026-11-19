'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { PublicFooter } from '@/components/layout/PublicFooter';
import { PublicHeader } from '@/components/layout/PublicHeader';
import { useAuth } from '@/components/providers/AuthContext';

export default function ForgotPasswordPage() {
  const { isFirebaseReady, sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to send password reset email.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <PublicHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-14 sm:px-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
            Account Recovery
          </p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-slate-900">
            Reset your password
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Enter your account email and Firebase Auth will send a recovery link.
          </p>

          {error && (
            <div
              role="alert"
              className="mt-5 flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-800"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {sent ? (
            <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                Reset link sent
              </div>
              <p className="mt-1 text-emerald-800">
                Check {email} for instructions to set a new password.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor="reset-email"
                  className="block text-sm font-medium text-slate-800"
                >
                  Account email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || !isFirebaseReady}
                className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {submitting ? 'Sending link…' : 'Send Reset Email'}
              </button>
            </form>
          )}

          <p className="mt-6 border-t border-slate-100 pt-5 text-center text-sm text-slate-600">
            <Link href="/login" className="font-medium text-blue-700 hover:text-blue-800">
              Back to Sign In
            </Link>
          </p>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
