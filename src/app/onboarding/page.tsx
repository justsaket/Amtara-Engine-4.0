'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Sparkles } from 'lucide-react';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useAuth } from '@/components/providers/AuthContext';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { STARTER_BRAND_PRESETS } from '@/lib/starter-brands';
import { DEFAULT_WORKSPACE_TIMEZONE } from '@/lib/validation';
import type { AutonomousConfigSnapshot, StarterBrandKey, WorkspaceWithRole } from '@/types/domain';

type StarterSelection = Exclude<StarterBrandKey, 'custom'>;

const TIMEZONE_OPTIONS = [
  'Asia/Kolkata',
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Asia/Singapore',
] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const { profile, refreshProfile } = useAuth();
  const { workspaces, refreshWorkspaces, setActiveWorkspaceId } = useWorkspace();

  const [displayName, setDisplayName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [timezone, setTimezone] = useState<string>(DEFAULT_WORKSPACE_TIMEZONE);
  const [selectedBrands, setSelectedBrands] = useState<StarterSelection[]>([
    'saket_personal',
    'magnarc',
    'greenweld',
    'sapphire',
  ]);
  const [configSnapshot, setConfigSnapshot] = useState<AutonomousConfigSnapshot | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.displayName && !displayName) {
      setDisplayName(profile.displayName);
      setWorkspaceName(`${profile.displayName.split(' ')[0]}'s Workspace`);
    }
  }, [profile?.displayName, displayName]);

  useEffect(() => {
    if (profile?.onboardingCompleted && workspaces.length > 0) {
      router.replace('/dashboard');
    }
  }, [profile?.onboardingCompleted, workspaces.length, router]);

  useEffect(() => {
    apiRequest<AutonomousConfigSnapshot>('/api/config/status')
      .then(setConfigSnapshot)
      .catch(() => null);
  }, []);

  function toggleStarterBrand(key: StarterSelection) {
    setSelectedBrands((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  }

  async function handleComplete(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await apiRequest<{ workspace: WorkspaceWithRole }>(
        '/api/onboarding/complete',
        {
          method: 'POST',
          body: JSON.stringify({
            displayName: displayName.trim() || 'Workspace Owner',
            workspaceName: workspaceName.trim(),
            timezone,
            starterBrands: selectedBrands,
          }),
        },
      );
      await refreshProfile();
      await refreshWorkspaces();
      setActiveWorkspaceId(data.workspace.id);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete onboarding.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthGuard requireWorkspace={false}>
      <div className="min-h-screen bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
                Automatic Workspace Setup
              </p>
              <span className="font-mono text-xs text-slate-500">
                Timezone: {timezone}
              </span>
            </div>

            <h1 className="mt-2 font-display text-2xl font-semibold text-slate-900">
              Initialize your Antara Engine workspace
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">
              Configure your tenant name, confirm default timezone settings, and optionally
              initialize starter brand governance profiles. Everything can be edited later.
            </p>

            {configSnapshot && (
              <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-800">
                  <Sparkles className="h-4 w-4 text-blue-700" />
                  Autonomous Environment Inspection
                </div>
                <p className="mt-1 font-mono text-xs text-slate-600">
                  Firebase Project: {configSnapshot.firebase.projectId || 'local'} · Database:{' '}
                  {configSnapshot.firebase.databaseId} · Encryption Vault:{' '}
                  {configSnapshot.secrets.encryptionKeyConfigured
                    ? `Ready (${configSnapshot.secrets.encryptionKeyVersion})`
                    : 'Awaiting Initialization'}
                </p>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-800"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleComplete} className="mt-6 space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="ob-display-name"
                    className="block text-sm font-medium text-slate-800"
                  >
                    Your display name
                  </label>
                  <input
                    id="ob-display-name"
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-blue-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="ob-timezone"
                    className="block text-sm font-medium text-slate-800"
                  >
                    Default workspace timezone
                  </label>
                  <select
                    id="ob-timezone"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:border-blue-700 focus:outline-none"
                  >
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="ob-workspace-name"
                  className="block text-sm font-medium text-slate-800"
                >
                  Workspace / Organization name
                </label>
                <input
                  id="ob-workspace-name"
                  type="text"
                  required
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="Antara Operations Group"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-blue-700 focus:outline-none"
                />
              </div>

              <div>
                <p className="text-sm font-medium text-slate-800">
                  Editable starter brand profiles
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Select which baseline brand profiles to initialize in your workspace. You
                  can modify, archive, or add custom brands anytime.
                </p>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {STARTER_BRAND_PRESETS.map((preset) => {
                    const checked = selectedBrands.includes(preset.starterKey);
                    return (
                      <button
                        key={preset.starterKey}
                        type="button"
                        onClick={() => toggleStarterBrand(preset.starterKey)}
                        className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                          checked
                            ? 'border-blue-600 bg-blue-50/40'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                            checked
                              ? 'border-blue-700 bg-blue-700 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {checked && <Check className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: preset.primaryColor }}
                            />
                            {preset.name}
                          </span>
                          <span className="mt-1 block text-xs text-slate-600">
                            {preset.industry}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-5">
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-blue-700 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {submitting ? 'Creating Workspace…' : 'Launch Workspace Console'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
