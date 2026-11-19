'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { hasPermission } from '@/lib/rbac';
import type {
  EvaluatedGoogleCapability,
  GoogleCapabilityId,
  GoogleConnectionRecord,
} from '@/types/domain';

interface PlatformOAuthStatus {
  configured: boolean;
  source: 'env' | 'server_vault' | 'local_file' | 'unset';
  maskedClientId?: string;
  redirectUri: string;
  redirectUriOrigin: string;
  canSaveFromUi: boolean;
  persistenceMode: string;
  updatedAt?: string;
}

interface ConnectionsPayload {
  connections: GoogleConnectionRecord[];
  activeConnection: GoogleConnectionRecord | null;
  capabilities: EvaluatedGoogleCapability[];
  platformOAuthConfigured: boolean;
}

const ALL_CAPABILITIES: GoogleCapabilityId[] = [
  'google_identity',
  'apps_script_projects',
  'apps_script_deployments',
  'drive_discovery',
  'apps_script_processes',
  'apps_script_execution',
];

export function GoogleOAuthHub({
  returnPath = '/dashboard/integrations',
  onConnectionChanged,
}: {
  returnPath?: string;
  onConnectionChanged?: () => void;
}) {
  const { activeWorkspace } = useWorkspace();
  const searchParams = useSearchParams();

  const [platformStatus, setPlatformStatus] = useState<PlatformOAuthStatus | null>(null);
  const [data, setData] = useState<ConnectionsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showPlatformForm, setShowPlatformForm] = useState(false);
  const [clientIdInput, setClientIdInput] = useState('');
  const [clientSecretInput, setClientSecretInput] = useState('');
  const [copiedUri, setCopiedUri] = useState(false);

  const canConfigure = hasPermission(activeWorkspace?.role, 'integrations:configure');
  const canConnect = hasPermission(activeWorkspace?.role, 'google:connect');
  const canDisconnect = hasPermission(activeWorkspace?.role, 'google:disconnect');

  const callbackStatus = searchParams.get('google_status');
  const callbackEmail = searchParams.get('google_email');
  const callbackError = searchParams.get('google_error');

  const loadAll = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    try {
      const [plat, conns] = await Promise.all([
        apiRequest<PlatformOAuthStatus>('/api/integrations/google/platform-config'),
        apiRequest<ConnectionsPayload>(
          `/api/workspaces/${activeWorkspace.id}/google/connections`,
        ),
      ]);
      setPlatformStatus(plat);
      setData(conns);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load Google connectivity state.',
      );
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (callbackStatus === 'connected') {
      setNotice(
        `Connected external Google account${callbackEmail ? ` (${callbackEmail})` : ''} cleanly via explicit OAuth consent.`,
      );
    } else if (callbackStatus === 'error' && callbackError) {
      setError(callbackError);
    }
  }, [callbackStatus, callbackEmail, callbackError]);

  async function handleCopyRedirectUri() {
    if (!platformStatus?.redirectUri) return;
    try {
      await navigator.clipboard.writeText(platformStatus.redirectUri);
      setCopiedUri(true);
      setTimeout(() => setCopiedUri(false), 2000);
    } catch {
      setNotice(`Authorized Redirect URI: ${platformStatus.redirectUri}`);
    }
  }

  async function handleSavePlatformConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !canConfigure) return;
    setBusyAction('save_platform');
    setError(null);
    setNotice(null);
    try {
      const saved = await apiRequest<PlatformOAuthStatus>(
        '/api/integrations/google/platform-config',
        {
          method: 'POST',
          body: JSON.stringify({
            workspaceId: activeWorkspace.id,
            clientId: clientIdInput.trim(),
            clientSecret: clientSecretInput.trim(),
          }),
        },
      );
      setPlatformStatus(saved);
      setClientSecretInput('');
      setShowPlatformForm(false);
      setNotice('Encrypted Platform Google OAuth Web Client saved cleanly.');
      await loadAll();
      onConnectionChanged?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to save Google OAuth configuration.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function startOAuthFlow(
    intent: 'connect' | 'incremental_scope' | 'reauthorize',
    capabilityIds: GoogleCapabilityId[],
  ) {
    if (!activeWorkspace || !canConnect) return;
    setBusyAction(`oauth_${intent}`);
    setError(null);
    try {
      const res = await apiRequest<{ authorizeUrl: string }>(
        '/api/integrations/google/authorize',
        {
          method: 'POST',
          body: JSON.stringify({
            workspaceId: activeWorkspace.id,
            intent,
            capabilityIds,
            returnPath,
          }),
        },
      );
      window.location.assign(res.authorizeUrl);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to initiate Google authorization.',
      );
      setBusyAction(null);
    }
  }

  async function handleToggleShare(conn: GoogleConnectionRecord) {
    if (!activeWorkspace || !canConnect) return;
    setBusyAction(`share_${conn.id}`);
    setError(null);
    try {
      await apiRequest(
        `/api/workspaces/${activeWorkspace.id}/google/connections/${conn.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            sharedWithWorkspace: !conn.sharedWithWorkspace,
          }),
        },
      );
      setNotice(
        conn.sharedWithWorkspace
          ? `Restricted ${conn.googleEmail} to personal owner access only.`
          : `Shared ${conn.googleEmail} cleanly with workspace editors/admins.`,
      );
      await loadAll();
      onConnectionChanged?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to update connection sharing.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleVerifyConnection(conn: GoogleConnectionRecord) {
    if (!activeWorkspace) return;
    setBusyAction(`verify_${conn.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ tokenValid: boolean; scopes: string[] }>(
        `/api/workspaces/${activeWorkspace.id}/google/connections/${conn.id}`,
        { method: 'POST' },
      );
      setNotice(
        res.tokenValid
          ? `Verified live Google token for ${conn.googleEmail} (${res.scopes.length} active scope(s)).`
          : `Google token verification reported an expired or invalid grant for ${conn.googleEmail}.`,
      );
      await loadAll();
      onConnectionChanged?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Live Google token verification failed.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDisconnect(conn: GoogleConnectionRecord) {
    if (!activeWorkspace || !canDisconnect) return;
    setBusyAction(`disconnect_${conn.id}`);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ revokedUpstream: boolean; detail?: string }>(
        `/api/workspaces/${activeWorkspace.id}/google/connections/${conn.id}`,
        { method: 'DELETE' },
      );
      setNotice(
        `Disconnected ${conn.googleEmail} and wiped encrypted vault tokens (upstream revoke: ${res.revokedUpstream ? 'confirmed' : 'cleaned locally'}).`,
      );
      await loadAll();
      onConnectionChanged?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to revoke Google connection.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
          <span>{notice}</span>
        </div>
      )}

      {/* 1. One-Time Platform Google OAuth App Setup Card */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-blue-700" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                Platform Google OAuth App Configuration
              </h2>
            </div>
            <p className="text-xs text-slate-600">
              One-time setup per environment. Client Secret is encrypted via AES-256-GCM and never
              returned to browsers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-slate-700">
              {platformStatus?.configured
                ? `Configured (${platformStatus.source.replace(/_/g, ' ')})`
                : 'Not configured'}
            </span>
            {canConfigure && (
              <button
                type="button"
                onClick={() => setShowPlatformForm((v) => !v)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
              >
                {showPlatformForm
                  ? 'Cancel'
                  : platformStatus?.configured
                    ? 'Update OAuth Client'
                    : 'Configure Google OAuth App'}
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Redirect URI Helper */}
        {platformStatus && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Authorized Redirect URI (Add in Google Cloud Console)
                </p>
                <p className="mt-1 truncate font-mono text-xs text-slate-900">
                  {platformStatus.redirectUri}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopyRedirectUri}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedUri ? 'Copied' : 'Copy URI'}
              </button>
            </div>
            {platformStatus.maskedClientId && (
              <p className="mt-2 font-mono text-[11px] text-slate-500">
                Active Client ID: {platformStatus.maskedClientId} · Vault: {platformStatus.persistenceMode}
              </p>
            )}
          </div>
        )}

        {showPlatformForm && canConfigure && (
          <form onSubmit={handleSavePlatformConfig} className="mt-4 space-y-4 border-t border-slate-100 pt-4">
            {!platformStatus?.canSaveFromUi && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Stateless Vercel runtime without Firebase Admin SA detected: set{' '}
                <code>GOOGLE_INTEGRATION_CLIENT_ID</code> and{' '}
                <code>GOOGLE_INTEGRATION_CLIENT_SECRET</code> in Vercel Project Environment Variables.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="google-oauth-client-id"
                  className="block text-xs font-medium text-slate-700"
                >
                  Google OAuth Client ID
                </label>
                <input
                  id="google-oauth-client-id"
                  type="text"
                  required
                  value={clientIdInput}
                  onChange={(e) => setClientIdInput(e.target.value)}
                  placeholder="123456789-abc.apps.googleusercontent.com"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="google-oauth-client-secret"
                  className="block text-xs font-medium text-slate-700"
                >
                  Google OAuth Client Secret
                </label>
                <input
                  id="google-oauth-client-secret"
                  type="password"
                  required
                  value={clientSecretInput}
                  onChange={(e) => setClientSecretInput(e.target.value)}
                  placeholder="GOCSPX-..."
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
              >
                Google Cloud Credentials <ExternalLink className="h-3 w-3" />
              </a>
              <button
                type="submit"
                disabled={busyAction === 'save_platform'}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busyAction === 'save_platform' ? 'Encrypting & Saving…' : 'Save OAuth Client'}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* 2. Connected Google Accounts & Workspace Isolation */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Authorized Google Connections
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Separate from your Antara sign-in identity. Tokens stay encrypted per user unless shared explicitly.
            </p>
          </div>

          {canConnect && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!platformStatus?.configured || busyAction !== null}
                onClick={() =>
                  startOAuthFlow('connect', [
                    'google_identity',
                    'apps_script_projects',
                    'apps_script_deployments',
                    'drive_discovery',
                    'apps_script_processes',
                  ])
                }
                className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {data?.activeConnection ? 'Connect Another Google Account' : 'Connect Google Workspace'}
              </button>
            </div>
          )}
        </div>

        {loading && !data ? (
          <p className="mt-4 text-sm text-slate-500">Loading workspace Google connections…</p>
        ) : !data || data.connections.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-5 text-sm text-slate-600">
            <p className="font-medium text-slate-900">No external Google account connected yet.</p>
            <p className="mt-1 text-xs text-slate-600">
              {platformStatus?.configured
                ? 'Click "Connect Google Workspace" above to grant explicit offline OAuth consent for Apps Script & Drive discovery.'
                : 'Configure your Google OAuth Web Client above first, then authorize a Google account.'}
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {data.connections.map((conn) => (
              <div
                key={conn.id}
                className="rounded-lg border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">
                        {conn.googleEmail}
                      </span>
                      <span
                        className={`font-mono text-[11px] font-semibold uppercase ${
                          conn.status === 'connected'
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {conn.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-slate-500">
                      Owner: {conn.userEmail || conn.userId} · Offline Refresh:{' '}
                      {conn.hasRefreshToken ? 'Available' : 'Missing'} · Scopes:{' '}
                      {conn.grantedScopes.length}
                    </p>
                    {conn.lastErrorMessage && (
                      <p className="flex items-center gap-1.5 text-xs text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        {conn.lastErrorMessage}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleVerifyConnection(conn)}
                      disabled={busyAction !== null}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Verify
                    </button>

                    {canConnect && (
                      <button
                        type="button"
                        onClick={() => handleToggleShare(conn)}
                        disabled={busyAction !== null}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Users className="h-3.5 w-3.5" />
                        {conn.sharedWithWorkspace ? 'Shared with Team' : 'Personal Only'}
                      </button>
                    )}

                    {canConnect && conn.status !== 'connected' && (
                      <button
                        type="button"
                        onClick={() => startOAuthFlow('reauthorize', ALL_CAPABILITIES)}
                        disabled={busyAction !== null}
                        className="rounded-md bg-blue-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-800"
                      >
                        Reauthorize
                      </button>
                    )}

                    {canDisconnect && (
                      <button
                        type="button"
                        onClick={() => handleDisconnect(conn)}
                        disabled={busyAction !== null}
                        aria-label={`Disconnect ${conn.googleEmail}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Revoke & Wipe
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 3. Granular Google Capability Matrix & Incremental Consent */}
      {data && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Google Workspace & Apps Script Capabilities
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Each capability evaluates real OAuth scopes independently and supports incremental consent.
              </p>
            </div>
            <a
              href="https://script.google.com/home/usersettings"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
            >
              Google Apps Script User Settings <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {data.capabilities.map((cap) => (
              <div
                key={cap.id}
                className="flex flex-col justify-between rounded-lg border border-slate-200 p-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{cap.name}</h3>
                    <span
                      className={`font-mono text-[11px] font-semibold ${
                        cap.availability === 'AVAILABLE'
                          ? 'text-emerald-700'
                          : cap.availability === 'PERMISSION_REQUIRED'
                            ? 'text-amber-700'
                            : 'text-slate-600'
                      }`}
                    >
                      {cap.availability}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    API: {cap.requiredApi} · Risk: {cap.riskCategory}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">
                    {cap.reason}
                  </p>
                </div>

                {cap.availability === 'PERMISSION_REQUIRED' && canConnect && (
                  <div className="mt-3 border-t border-slate-100 pt-2.5">
                    <button
                      type="button"
                      onClick={() => startOAuthFlow('incremental_scope', [cap.id])}
                      disabled={busyAction !== null}
                      className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-100"
                    >
                      Grant {cap.name} Scope
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
