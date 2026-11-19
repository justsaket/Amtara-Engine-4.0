'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, RefreshCw, Save, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthContext';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { hasPermission } from '@/lib/rbac';
import type {
  ApplicationSetting,
  AutonomousConfigSnapshot,
  SettingCategory,
} from '@/types/domain';

const SETTINGS_CATEGORIES: readonly {
  id: SettingCategory;
  label: string;
  summary: string;
}[] = [
  { id: 'general', label: 'General', summary: 'Default locale, date display, and Asia/Kolkata timezone.' },
  { id: 'account', label: 'Account', summary: 'Personal identity profile, timezone, and account deletion.' },
  { id: 'workspace', label: 'Workspace', summary: 'Tenant governance policies and administrative locks.' },
  { id: 'brands', label: 'Brands', summary: 'Brand profile editing permissions and starter profile defaults.' },
  { id: 'integrations', label: 'Integrations', summary: 'OAuth boundary mode and Phase 2 deployment slot rules.' },
  { id: 'ai_configuration', label: 'AI Configuration', summary: 'Gemini API availability and Phase 3 agent readiness.' },
  { id: 'security', label: 'Security', summary: 'HTTP-only signed session enforcement and tenant isolation.' },
  { id: 'encryption_status', label: 'Encryption Status', summary: 'AES-256-GCM key version, rotation, and vault health.' },
  { id: 'automation', label: 'Automation', summary: 'Phase 4 automation engine scheduling placeholders.' },
  { id: 'notifications', label: 'Notifications', summary: 'Workspace security alerts and onboarding notices.' },
  { id: 'database_health', label: 'Database Health', summary: 'Firestore database ID, Admin SDK vs REST fallback, and conflict detection.' },
  { id: 'deployment_health', label: 'Deployment Health', summary: 'Runtime URL, Vercel environment status, and test gate.' },
] as const;

export default function SettingsCenterPage() {
  const router = useRouter();
  const { profile, refreshProfile, signOut } = useAuth();
  const { activeWorkspace } = useWorkspace();

  const [activeCategory, setActiveCategory] = useState<SettingCategory>('general');
  const [settingsList, setSettingsList] = useState<ApplicationSetting[]>([]);
  const [config, setConfig] = useState<AutonomousConfigSnapshot | null>(null);

  // Account editable fields
  const [displayName, setDisplayName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Generic setting field editor
  const [settingNotes, setSettingNotes] = useState('');
  const [rotationInstructions, setRotationInstructions] = useState<Record<
    string,
    string
  > | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManageSettings = hasPermission(activeWorkspace?.role, 'settings:update');
  const canManageSecurity = hasPermission(activeWorkspace?.role, 'security:manage');

  const loadCenter = useCallback(async () => {
    const cfg = await apiRequest<AutonomousConfigSnapshot>('/api/config/status').catch(
      () => null,
    );
    if (cfg) setConfig(cfg);
    if (activeWorkspace) {
      const res = await apiRequest<{ settings: ApplicationSetting[] }>(
        `/api/workspaces/${activeWorkspace.id}/settings`,
      ).catch(() => ({ settings: [] }));
      setSettingsList(res.settings);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadCenter();
  }, [loadCenter]);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || '');
      setJobTitle(profile.jobTitle || '');
      setTimezone(profile.timezone || 'Asia/Kolkata');
    }
  }, [profile]);

  const currentSetting = settingsList.find((s) => s.category === activeCategory);

  useEffect(() => {
    setSettingNotes(
      typeof currentSetting?.values?.adminNotes === 'string'
        ? currentSetting.values.adminNotes
        : '',
    );
  }, [currentSetting, activeCategory]);

  async function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    setError(null);
    try {
      await apiRequest('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: displayName.trim(),
          jobTitle: jobTitle.trim(),
          timezone: timezone.trim(),
        }),
      });
      await refreshProfile();
      setFeedback('Account settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save account settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRequestAccountDeletion() {
    setSaving(true);
    setError(null);
    try {
      await apiRequest('/api/auth/me', { method: 'DELETE' });
      await signOut();
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Account deletion request failed.');
      setSaving(false);
    }
  }

  async function handleSaveCategorySetting(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !canManageSettings) return;
    setSaving(true);
    setFeedback(null);
    setError(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/settings`, {
        method: 'PUT',
        body: JSON.stringify({
          category: activeCategory,
          values: {
            ...(currentSetting?.values || {}),
            adminNotes: settingNotes.trim(),
            lastReviewedBy: profile?.email || 'admin',
          },
        }),
      });
      await loadCenter();
      setFeedback(`Saved "${activeCategory}" workspace policy settings.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSecretAction(action: 'initialize' | 'rotate_encryption_key') {
    if (!activeWorkspace || !canManageSecurity) return;
    setSaving(true);
    setFeedback(null);
    setError(null);
    setRotationInstructions(null);
    try {
      const res = await apiRequest<{
        result: {
          persistedLocally: boolean;
          encryptionKeyVersion: string;
          envInstructions?: Record<string, string>;
        };
        snapshot: AutonomousConfigSnapshot;
      }>('/api/config/bootstrap', {
        method: 'POST',
        body: JSON.stringify({
          action,
          workspaceId: activeWorkspace.id,
        }),
      });
      setConfig(res.snapshot);
      if (res.result.envInstructions) {
        setRotationInstructions(res.result.envInstructions);
      }
      setFeedback(
        action === 'rotate_encryption_key'
          ? `Rotated AES-256-GCM key to version ${res.result.encryptionKeyVersion}.`
          : `Verified internal security secrets (${res.result.encryptionKeyVersion}).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Secret operation failed.');
    } finally {
      setSaving(false);
    }
  }

  const activeMeta =
    SETTINGS_CATEGORIES.find((c) => c.id === activeCategory) || SETTINGS_CATEGORIES[0];

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
          Centralized Configuration Governance
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900">
          Settings Center
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          All twelve workspace governance, security, database, encryption, and runtime
          settings unified in one role-gated interface. Secret values are masked.
        </p>
      </div>

      {feedback && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {feedback}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* 12 Category Tabs */}
        <aside className="lg:col-span-4">
          <div className="rounded-xl border border-slate-200 bg-white p-2">
            {SETTINGS_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs transition-colors ${
                  activeCategory === cat.id
                    ? 'bg-slate-900 font-semibold text-white'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>{cat.label}</span>
                <span
                  className={`font-mono text-[10px] ${
                    activeCategory === cat.id ? 'text-slate-300' : 'text-slate-400'
                  }`}
                >
                  {cat.id}
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Category Panel */}
        <div className="space-y-6 lg:col-span-8">
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">
              {activeMeta.label}
            </h2>
            <p className="mt-1 text-xs text-slate-600">{activeMeta.summary}</p>

            {/* Account Category */}
            {activeCategory === 'account' && (
              <div className="mt-6 space-y-6">
                <form onSubmit={handleSaveAccount} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="acc-name"
                        className="block text-xs font-medium text-slate-700"
                      >
                        Display Name
                      </label>
                      <input
                        id="acc-name"
                        type="text"
                        required
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="acc-title"
                        className="block text-xs font-medium text-slate-700"
                      >
                        Job Title
                      </label>
                      <input
                        id="acc-title"
                        type="text"
                        value={jobTitle}
                        onChange={(e) => setJobTitle(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="acc-tz"
                      className="block text-xs font-medium text-slate-700"
                    >
                      User Timezone
                    </label>
                    <input
                      id="acc-tz"
                      type="text"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Update Account Profile
                  </button>
                </form>

                <div className="border-t border-slate-200 pt-5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-rose-800">
                    <ShieldAlert className="h-4 w-4" />
                    Request Account Deletion
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    Marks your profile deletion status as requested and signs out your
                    active session cookies cleanly.
                  </p>
                  {!confirmDelete ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="mt-3 rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                    >
                      Initiate Deletion Request
                    </button>
                  ) : (
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={handleRequestAccountDeletion}
                        className="rounded-lg bg-rose-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-800"
                      >
                        Confirm Account Deletion Request
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Encryption Status Category */}
            {activeCategory === 'encryption_status' && config && (
              <div className="mt-6 space-y-4">
                <dl className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">Cipher & Binding</dt>
                    <dd className="mt-1 font-mono font-semibold text-slate-900">
                      AES-256-GCM · Tenant AAD Bound
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Active Key Version</dt>
                    <dd className="mt-1 font-mono font-semibold text-slate-900">
                      {config.secrets.encryptionKeyVersion} ({config.secrets.encryptionKeySource})
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Master Key Separation</dt>
                    <dd className="mt-1 font-mono font-semibold text-emerald-700">
                      Stored outside Firestore
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Rotation State</dt>
                    <dd className="mt-1 font-mono text-slate-800">
                      {config.secrets.rotationActive
                        ? `Rotating from ${config.secrets.previousKeyVersion}`
                        : 'Single active key'}
                    </dd>
                  </div>
                </dl>

                {config.secrets.serverlessWarning && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    {config.secrets.serverlessWarning}
                  </div>
                )}

                {canManageSecurity && (
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleSecretAction('initialize')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Verify Internal Secrets
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleSecretAction('rotate_encryption_key')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Rotate Encryption Key
                    </button>
                  </div>
                )}

                {rotationInstructions && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-xs text-slate-800">
                    <p className="font-semibold">
                      Serverless Host Action Required (shown once):
                    </p>
                    <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 font-mono text-[11px] text-slate-100">
                      {Object.entries(rotationInstructions)
                        .map(([k, v]) => `${k}="${v}"`)
                        .join('\n')}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Database & Deployment Health live diagnostics */}
            {(activeCategory === 'database_health' ||
              activeCategory === 'deployment_health') &&
              config && (
                <div className="mt-6 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs sm:grid-cols-2">
                  <div>
                    <p className="text-slate-500">Firebase Project ID</p>
                    <p className="mt-1 font-mono font-semibold text-slate-900">
                      {config.firebase.projectId || 'Unconfigured'}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Firestore Database ID</p>
                    <p className="mt-1 font-mono font-semibold text-slate-900">
                      {config.firebase.databaseId}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Admin SDK / REST Mode</p>
                    <p className="mt-1 font-mono text-slate-800">
                      {config.firebase.adminCredentialMode}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">App Runtime URL</p>
                    <p className="mt-1 font-mono text-slate-800">
                      {config.environment.appUrl}
                    </p>
                  </div>
                </div>
              )}

            {/* Stored Workspace Category Values + Admin Notes */}
            <div className="mt-6 border-t border-slate-100 pt-5">
              <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
                Persisted Category Policy Values
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700">
                {JSON.stringify(currentSetting?.values || {}, null, 2)}
              </pre>

              {canManageSettings && (
                <form onSubmit={handleSaveCategorySetting} className="mt-4 space-y-3">
                  <div>
                    <label
                      htmlFor="cat-notes"
                      className="block text-xs font-medium text-slate-700"
                    >
                      Governance Notes for {activeMeta.label}
                    </label>
                    <input
                      id="cat-notes"
                      type="text"
                      value={settingNotes}
                      onChange={(e) => setSettingNotes(e.target.value)}
                      placeholder="Record internal policy or review confirmation"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save Category Policy
                  </button>
                </form>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
