'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';

interface UsageResponse {
  measuredAt: string;
  disclaimer: string;
  aiUsage: {
    totalRequests: number;
    todayRequests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedApplicationCostUsd: number;
    providerReportedCostUsd: number | null;
    byModel: Array<{
      provider: string;
      model: string;
      requests: number;
      totalTokens: number;
      estimatedCostUsd: number;
    }>;
  };
  storage: {
    assetsCount: number;
    totalBytes: number;
    totalMb: number;
  };
  publishing: {
    scheduledJobsTotal: number;
    publishAttemptsTotal: number;
  };
  advertising: {
    draftOrActiveCampaigns: number;
    enabledBudgetPolicies: number;
    providerReportedAdSpend: number | null;
    note: string;
  };
  infrastructureBilling: {
    firebaseReadWriteCost: number | null;
    vercelBandwidthCost: number | null;
    status: string;
    note: string;
  };
  thresholds: {
    monthlyAiWarningUsd: number;
    dailyAiRequestsWarning: number;
    storageWarningMb: number;
  };
  warnings: string[];
}

export default function UsageAndCostsPage() {
  const { activeWorkspace } = useWorkspace();
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({
    monthlyAiWarningUsd: '25',
    dailyAiRequestsWarning: '200',
    storageWarningMb: '500',
  });

  const loadUsage = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<UsageResponse>(
        `/api/workspaces/${activeWorkspace.id}/usage`,
      );
      setData(res);
      setForm({
        monthlyAiWarningUsd: String(res.thresholds.monthlyAiWarningUsd),
        dailyAiRequestsWarning: String(res.thresholds.dailyAiRequestsWarning),
        storageWarningMb: String(res.thresholds.storageWarningMb),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load usage data.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  async function handleSaveThresholds(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/usage`, {
        method: 'PUT',
        body: JSON.stringify({
          monthlyAiWarningUsd: Number(form.monthlyAiWarningUsd),
          dailyAiRequestsWarning: Number(form.dailyAiRequestsWarning),
          storageWarningMb: Number(form.storageWarningMb),
        }),
      });
      setNotice('Usage warning thresholds updated.');
      await loadUsage();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save thresholds.');
    } finally {
      setSaving(false);
    }
  }

  if (!activeWorkspace) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Select a workspace to inspect usage and cost visibility.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-blue-700">Resource &amp; Cost Governance</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
            Usage &amp; Costs
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Transparent separation between estimated application AI usage, provider-reported
            billing, and unavailable infrastructure invoice metrics.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadUsage()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 self-start whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {notice}
        </div>
      )}

      {data && (
        <>
          {data.warnings.length > 0 && (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Configured Usage Threshold Warnings</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {data.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Metric Cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">AI Requests (Total / Today)</p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {data.aiUsage.totalRequests} <span className="text-slate-300">/</span>{' '}
                {data.aiUsage.todayRequests}
              </p>
              <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-500">
                {data.aiUsage.totalTokens.toLocaleString()} total tokens
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Estimated App AI Cost</p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                ${data.aiUsage.estimatedApplicationCostUsd.toFixed(4)}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Provider-reported: {data.aiUsage.providerReportedCostUsd ?? 'Unavailable'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Media Storage Used</p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {data.storage.totalMb} MB
              </p>
              <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-500">
                {data.storage.assetsCount} validated asset(s)
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Publishing Operations</p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {data.publishing.scheduledJobsTotal}
              </p>
              <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-500">
                {data.publishing.publishAttemptsTotal} provider attempt(s)
              </p>
            </div>
          </div>

          {/* Model Breakdown */}
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">AI Usage by Provider &amp; Model</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[11px] text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Provider</th>
                    <th className="px-4 py-3">Model</th>
                    <th className="px-4 py-3 text-right">Requests</th>
                    <th className="px-4 py-3 text-right">Tokens</th>
                    <th className="px-4 py-3 text-right">Est. Cost (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.aiUsage.byModel.map((row) => (
                    <tr key={`${row.provider}-${row.model}`}>
                      <td className="px-5 py-3 font-medium text-slate-900">{row.provider}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.model}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{row.requests}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {row.totalTokens.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        ${row.estimatedCostUsd.toFixed(6)}
                      </td>
                    </tr>
                  ))}
                  {data.aiUsage.byModel.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">
                        No AI model invocations recorded yet in this workspace.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Threshold Form & Honest Billing Boundary */}
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">Warning Thresholds</h2>
              <p className="mt-1 text-xs text-slate-500">{data.disclaimer}</p>
              <form onSubmit={handleSaveThresholds} className="mt-4 space-y-4">
                <div>
                  <label htmlFor="th-ai-usd" className="block text-xs font-medium text-slate-700">
                    Monthly Estimated AI Warning (USD)
                  </label>
                  <input
                    id="th-ai-usd"
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={form.monthlyAiWarningUsd}
                    onChange={(e) => setForm((f) => ({ ...f, monthlyAiWarningUsd: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="th-daily-req" className="block text-xs font-medium text-slate-700">
                    Daily AI Requests Warning
                  </label>
                  <input
                    id="th-daily-req"
                    type="number"
                    min="5"
                    step="1"
                    required
                    value={form.dailyAiRequestsWarning}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, dailyAiRequestsWarning: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="th-storage-mb" className="block text-xs font-medium text-slate-700">
                    Media Storage Warning (MB)
                  </label>
                  <input
                    id="th-storage-mb"
                    type="number"
                    min="10"
                    step="10"
                    required
                    value={form.storageWarningMb}
                    onChange={(e) => setForm((f) => ({ ...f, storageWarningMb: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Thresholds'}
                </button>
              </form>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                External Billing &amp; Paid Ads Boundaries
              </h2>
              <dl className="mt-4 divide-y divide-slate-100 text-xs">
                <div className="py-3">
                  <dt className="font-medium text-slate-800">Firebase &amp; Vercel Billing</dt>
                  <dd className="mt-1 text-slate-600">
                    Not available from application runtime ({data.infrastructureBilling.status}).{' '}
                    {data.infrastructureBilling.note}
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="font-medium text-slate-800">Paid Advertising Spend</dt>
                  <dd className="mt-1 text-slate-600">
                    {data.advertising.draftOrActiveCampaigns} campaign record(s),{' '}
                    {data.advertising.enabledBudgetPolicies} enabled budget policy(ies).{' '}
                    {data.advertising.note}
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
