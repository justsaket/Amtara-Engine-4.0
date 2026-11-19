'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type {
  ConnectedSocialAccount,
  PublishingAttemptRecord,
  ScheduledPostRecord,
} from '@/types/domain';
import type { ProviderCapabilityMatrixEntry } from '@/lib/marketing/providers/types';

interface PublishingApiResponse {
  accounts: ConnectedSocialAccount[];
  capabilityMatrix: ProviderCapabilityMatrixEntry[];
  attempts: PublishingAttemptRecord[];
  scheduledPosts: ScheduledPostRecord[];
  recoveryQueue: ScheduledPostRecord[];
}

export function PublishingOperationsConsole({
  tab,
}: {
  tab: 'overview' | 'accounts' | 'history';
}) {
  const { activeWorkspace } = useWorkspace();
  const [data, setData] = useState<PublishingApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadPublishing = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<PublishingApiResponse>(
        `/api/workspaces/${activeWorkspace.id}/marketing/publishing`,
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load publishing console.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadPublishing();
  }, [loadPublishing]);

  useEffect(() => {
    function handleOAuthMessage(event: MessageEvent) {
      const payload = event.data as {
        type?: string;
        provider?: string;
        status?: string;
        error?: string;
      } | null;
      if (payload?.type === 'OAUTH_AUTH_SUCCESS') {
        setNotice(
          payload.status === 'authorized'
            ? `OAuth authorization callback received for ${payload.provider}. Refreshing account state.`
            : `OAuth callback for ${payload.provider}: ${payload.error || payload.status}`,
        );
        void loadPublishing();
      }
    }
    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [loadPublishing]);

  async function handleStartOAuth(
    providerKey: 'meta' | 'linkedin' | 'tiktok' | 'canva' | 'youtube' | 'gbp',
  ) {
    if (!activeWorkspace) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{
        configured: boolean;
        authorizeUrl?: string;
        redirectUri: string;
        missingEnvVars: string[];
      }>(`/api/integrations/social/${providerKey}/start`, {
        method: 'POST',
        body: JSON.stringify({ workspaceId: activeWorkspace.id }),
      });

      if (!res.configured || !res.authorizeUrl) {
        setError(
          `${providerKey.toUpperCase()} OAuth requires ${res.missingEnvVars.join(', ')} in server secrets. Registered callback URI: ${res.redirectUri}`,
        );
        return;
      }

      const popup = window.open(
        res.authorizeUrl,
        `antara_oauth_${providerKey}`,
        'width=640,height=720,noopener=no',
      );
      if (!popup) {
        setNotice(
          `Popup blocked by browser. Authorize directly via: ${res.authorizeUrl}`,
        );
      } else {
        setNotice(`Opened official ${providerKey.toUpperCase()} OAuth authorization window.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start OAuth flow.');
    }
  }

  async function handleDisconnect(accountId: string) {
    if (!activeWorkspace) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ cancelledJobsCount: number }>(
        `/api/workspaces/${activeWorkspace.id}/marketing/publishing?accountId=${encodeURIComponent(accountId)}`,
        { method: 'DELETE' },
      );
      setNotice(
        `Account disconnected and encrypted credentials revoked. Cancelled ${res.cancelledJobsCount} pending scheduled post(s).`,
      );
      await loadPublishing();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to disconnect account.');
    }
  }

  async function handleReconcile(scheduledPostId: string) {
    if (!activeWorkspace) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ detail: string }>(
        `/api/workspaces/${activeWorkspace.id}/marketing/calendar`,
        {
          method: 'PATCH',
          body: JSON.stringify({ scheduledPostId, action: 'reconcile_check' }),
        },
      );
      setNotice(res.detail);
      await loadPublishing();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reconcile post.');
    }
  }

  if (!activeWorkspace) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Select a workspace to open Publishing Operations.
      </div>
    );
  }

  function mapProviderToOAuthKey(
    provider: ProviderCapabilityMatrixEntry['provider'],
  ): 'meta' | 'linkedin' | 'tiktok' | 'canva' | 'youtube' | 'gbp' {
    if (provider === 'instagram' || provider === 'facebook' || provider === 'meta_ads') return 'meta';
    if (provider === 'google_business_profile') return 'gbp';
    return provider;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
            Phase 4 · Multi-Platform Publishing &amp; Recovery Center
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
            {tab === 'accounts'
              ? 'Connected Accounts & Capability Matrix'
              : tab === 'history'
                ? 'Publishing History & Audit'
                : 'Publishing Operations & Recovery'}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Official API adapters for Instagram, Facebook Pages, YouTube, LinkedIn, TikTok, GBP, Canva Connect, and Meta Ads.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadPublishing()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Sub-navigation tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
        {[
          { id: 'overview', label: 'Overview & Recovery', href: '/dashboard/publishing' },
          { id: 'accounts', label: 'Connected Accounts & Matrix', href: '/dashboard/publishing/accounts' },
          { id: 'history', label: 'Publishing History', href: '/dashboard/publishing/history' },
        ].map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              tab === item.id
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {notice}
        </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-mono text-[11px] uppercase text-slate-500">Connected Accounts</p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {data?.accounts.filter((a) => a.status === 'connected').length ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-mono text-[11px] uppercase text-slate-500">Publish Attempts</p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {data?.attempts.length ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-mono text-[11px] uppercase text-slate-500">Recovery Queue</p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {data?.recoveryQueue.length ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-mono text-[11px] uppercase text-slate-500">Configured Providers</p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {data?.capabilityMatrix.filter((m) => m.oauthConfigured).length ?? 0} / 8
              </p>
            </div>
          </div>

          {/* Recovery Center */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                Publishing Recovery Center (FAILED / DEAD_LETTER / PUBLISH_STATUS_UNKNOWN)
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Jobs with PUBLISH_STATUS_UNKNOWN block blind duplicate retries until provider reconciliation confirms whether the post already exists.
            </p>
            <div className="mt-4 divide-y divide-slate-100">
              {(data?.recoveryQueue || []).map((job) => (
                <div key={job.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {job.platform} · {job.status} · {job.lastErrorCode || 'RECONCILIATION_REQUIRED'}
                    </p>
                    <p className="font-mono text-xs text-slate-500">
                      Job {job.id} · {job.lastErrorMessage || 'Inspect provider status before retry.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleReconcile(job.id)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                  >
                    Run Reconciliation Check
                  </button>
                </div>
              ))}
              {(!data || data.recoveryQueue.length === 0) && (
                <p className="py-6 text-sm text-slate-500">
                  No failed, dead-letter, or ambiguous publishing jobs require recovery.
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {tab === 'accounts' && (
        <div className="space-y-6">
          {/* Active Connected Accounts */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">
              Workspace Connected Accounts
            </h2>
            <div className="mt-3 divide-y divide-slate-100">
              {(data?.accounts || []).map((acc) => (
                <div key={acc.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {acc.displayName} {acc.handle ? `(${acc.handle})` : ''}
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {acc.provider} · {acc.status} · {acc.grantedScopes.length} scope(s)
                      {acc.unauditedAppWarning ? ' · Unaudited private/draft mode' : ''}
                    </p>
                  </div>
                  {acc.status !== 'disconnected' && (
                    <button
                      type="button"
                      onClick={() => void handleDisconnect(acc.id)}
                      className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                    >
                      Disconnect &amp; Revoke
                    </button>
                  )}
                </div>
              ))}
              {(!data || data.accounts.length === 0) && (
                <p className="py-5 text-sm text-slate-500">
                  No external accounts connected yet. Use the Provider Capability Matrix below to authorize supported platforms via OAuth.
                </p>
              )}
            </div>
          </section>

          {/* 8-Provider Capability Matrix */}
          <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">
                Phase 4 Official Provider Capability Matrix (8 Providers)
              </h2>
              <p className="text-xs text-slate-500">
                Honest OAuth readiness, official API version, supported capabilities, and platform restrictions.
              </p>
            </div>
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Provider &amp; API</th>
                  <th className="px-4 py-3">Readiness</th>
                  <th className="px-4 py-3">Required Env Vars</th>
                  <th className="px-4 py-3">Restrictions / App Review</th>
                  <th className="px-5 py-3 text-right">Connect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.capabilityMatrix || []).map((entry) => (
                  <tr key={entry.provider}>
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-slate-900">{entry.displayName}</p>
                      <p className="font-mono text-[11px] text-slate-500">
                        {entry.officialApiName} · Reviewed {entry.docsReviewedDate}
                      </p>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs text-slate-800">
                      {entry.readinessState}
                      {entry.gbpAccessState && (
                        <p className="text-[11px] text-slate-500">GBP: {entry.gbpAccessState}</p>
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[11px] text-slate-600">
                      {entry.requiredEnvVars.join(', ')}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-600 max-w-xs">
                      {entry.appReviewNotes}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        type="button"
                        onClick={() => void handleStartOAuth(mapProviderToOAuthKey(entry.provider))}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                      >
                        Authorize
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {tab === 'history' && (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3">Timestamp</th>
                <th className="px-4 py-3">Platform &amp; Mode</th>
                <th className="px-4 py-3">Status &amp; Gateway</th>
                <th className="px-4 py-3">External Post / Error</th>
                <th className="px-5 py-3 text-right">Idempotency Key</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.attempts || []).map((att) => (
                <tr key={att.id}>
                  <td className="px-5 py-3 font-mono text-xs text-slate-600">
                    {new Date(att.startedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-900">
                    {att.platform} · Attempt #{att.attemptNumber}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-800">
                    {att.status}
                    <p className="text-[11px] text-slate-500">GW: {att.gatewayDecisionId}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {att.externalPostUrl ? (
                      <a
                        href={att.externalPostUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 hover:underline"
                      >
                        {att.externalPostId || att.externalPostUrl}
                      </a>
                    ) : att.errorMessage ? (
                      <span className="text-rose-700">
                        {att.errorCode}: {att.errorMessage}
                      </span>
                    ) : (
                      <span className="text-slate-500">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-[11px] text-slate-500">
                    {att.idempotencyKey.slice(0, 18)}
                  </td>
                </tr>
              ))}
              {(!data || data.attempts.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">
                    No publishing attempts logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
