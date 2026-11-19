'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Calendar,
  CheckSquare,
  PenTool,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type {
  BrandGrowthObjective,
  BrandProfile,
  MarketingActivityItem,
  WorkspaceEmergencyStopState,
} from '@/types/domain';
import type { WorkspaceMarketingOverview } from '@/lib/marketing/growth-controller';

interface OverviewApiResponse {
  overview: WorkspaceMarketingOverview;
  objectives: BrandGrowthObjective[];
  emergencyStop: WorkspaceEmergencyStopState;
  recentActivities: MarketingActivityItem[];
  brands: BrandProfile[];
}

export function MarketingOverviewConsole() {
  const { activeWorkspace } = useWorkspace();
  const [data, setData] = useState<OverviewApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [goalForm, setGoalForm] = useState({
    brandId: '',
    period: 'monthly' as 'weekly' | 'monthly' | 'quarterly',
    title: '',
    targetMetric: 'published_posts',
    targetValue: '12',
    unit: 'posts',
    priority: 'high' as 'high' | 'medium' | 'low',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const loadOverview = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<OverviewApiResponse>(
        `/api/workspaces/${activeWorkspace.id}/marketing/overview`,
      );
      setData(res);
      if (res.brands.length > 0) {
        setGoalForm((prev) => ({
          ...prev,
          brandId: prev.brandId || res.brands[0].id,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load marketing overview.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function handleCreateObjective(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !goalForm.brandId) return;
    setSubmitting(true);
    setError(null);
    setStatusMessage(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/marketing/overview`, {
        method: 'POST',
        body: JSON.stringify({
          brandId: goalForm.brandId,
          period: goalForm.period,
          title: goalForm.title,
          targetMetric: goalForm.targetMetric,
          targetValue: Number(goalForm.targetValue),
          unit: goalForm.unit,
          priority: goalForm.priority,
          notes: goalForm.notes || undefined,
        }),
      });
      setStatusMessage('Growth objective saved.');
      setGoalForm((prev) => ({ ...prev, title: '', notes: '' }));
      setShowGoalForm(false);
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create growth objective.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!activeWorkspace) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Select or create a workspace to open the Marketing Growth Controller.
      </div>
    );
  }

  const ov = data?.overview;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
            Phase 4 · Brand Growth Controller
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
            Autonomous Marketing Overview
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Live multi-brand production pipeline, approvals, scheduled releases, and verified analytics for{' '}
            <span className="font-medium text-slate-900">{activeWorkspace.name}</span>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadOverview()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <Link
            href="/dashboard/content/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" />
            New Content Draft
          </Link>
        </div>
      </div>

      {data?.emergencyStop.globalStopped && (
        <div className="flex flex-col justify-between gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4 sm:flex-row sm:items-center">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-rose-800">
              Global Emergency Stop Active
            </p>
            <p className="mt-0.5 text-sm text-rose-900">
              All external publishing, replies, and cron dispatches are halted.{' '}
              {data.emergencyStop.reason ? `Reason: ${data.emergencyStop.reason}` : ''}
            </p>
          </div>
          <Link
            href="/dashboard/autonomy"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-100"
          >
            Manage Controls
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      )}
      {statusMessage && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {statusMessage}
        </div>
      )}

      {/* Top KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
            Pending Approvals
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {ov?.totals.pendingApprovals ?? 0}
          </p>
          <Link
            href="/dashboard/approvals"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
          >
            Review queue <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
            Scheduled Posts
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {ov?.totals.scheduledPosts ?? 0}
          </p>
          <Link
            href="/dashboard/calendar"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
          >
            Open calendar <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
            Connected Channels
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {ov?.totals.connectedAccounts ?? 0}
          </p>
          <Link
            href="/dashboard/publishing/accounts"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
          >
            Connect accounts <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
            Recovery Attention
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {ov?.totals.failedOrUnknownJobs ?? 0}
          </p>
          <Link
            href="/dashboard/publishing"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
          >
            Inspect publishing <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Quick Action Bar */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: 'Content Factory', href: '/dashboard/content', icon: PenTool, detail: '5-stage CMS & QA' },
          { label: 'Publishing Calendar', href: '/dashboard/calendar', icon: Calendar, detail: 'IANA TZ scheduler' },
          { label: 'Approval Center', href: '/dashboard/approvals', icon: CheckSquare, detail: 'Hash-bound signoff' },
          { label: 'Publishing & Recovery', href: '/dashboard/publishing', icon: Send, detail: '6 social adapters' },
          { label: 'Autonomy & Stop', href: '/dashboard/autonomy', icon: ShieldAlert, detail: 'Modes A / B / C' },
        ].map((tile) => {
          const Icon = tile.icon;
          return (
            <Link
              key={tile.href}
              href={tile.href}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">{tile.label}</p>
                <p className="text-xs text-slate-500">{tile.detail}</p>
              </div>
              <Icon className="h-4 w-4 shrink-0 text-slate-500" />
            </Link>
          );
        })}
      </div>

      {/* Brand-by-Brand Operational Table */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Brand Execution Readiness
            </h2>
            <p className="text-xs text-slate-500">
              Verified counts and null-preserving analytics per brand profile. Missing metrics remain uncollected rather than zeroed.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500">
            {ov?.brandSummaries.length ?? 0} brand(s)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3">Brand</th>
                <th className="px-4 py-3">Autonomy</th>
                <th className="px-4 py-3 text-right">Drafts</th>
                <th className="px-4 py-3 text-right">Pending Apr.</th>
                <th className="px-4 py-3 text-right">Scheduled</th>
                <th className="px-4 py-3 text-right">Published</th>
                <th className="px-4 py-3 text-right">Inbox / Reviews</th>
                <th className="px-4 py-3 text-right">Impressions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(ov?.brandSummaries || []).map((b) => (
                <tr key={b.brandId} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-slate-900">{b.brandName}</p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {b.connectedAccountsCount} connected · {b.activeLeadsCount} active lead(s)
                    </p>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs text-slate-700">
                    {b.autonomyMode}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-900">
                    {b.draftContentCount}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-900">
                    {b.pendingApprovalsCount}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-900">
                    {b.scheduledPostsCount}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-900">
                    {b.publishedPostsCount}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-700">
                    {b.openConversationsCount} / {b.unansweredReviewsCount}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums text-slate-600">
                    {b.latestObservedImpressions === null
                      ? 'Not collected'
                      : b.latestObservedImpressions.toLocaleString()}
                  </td>
                </tr>
              ))}
              {(!ov || ov.brandSummaries.length === 0) && (
                <tr>
                  <td colSpan={8} className="px-5 py-8 text-center text-sm text-slate-500">
                    No brand profiles found in this workspace yet. Add brands in Brand Profiles.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Daily Priorities & Growth Objectives */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Immediate Operational Priorities
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Computed deterministically from live workspace queues.
          </p>
          <ul className="mt-4 divide-y divide-slate-100">
            {(ov?.brandSummaries || [])
              .flatMap((b) =>
                b.operationalPriorities.map((p) => ({
                  brandName: b.brandName,
                  ...p,
                })),
              )
              .slice(0, 10)
              .map((item, idx) => (
                <li key={`${item.brandName}-${item.category}-${idx}`} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      <span className="font-mono text-xs text-slate-400">
                        {String(idx + 1).padStart(2, '0')} · {item.priority.toUpperCase()} · {item.brandName} ·{' '}
                      </span>
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{item.detail}</p>
                  </div>
                  <Link
                    href={item.route}
                    className="shrink-0 text-xs font-medium text-blue-700 hover:underline"
                  >
                    Open
                  </Link>
                </li>
              ))}
            {(!ov || ov.brandSummaries.every((b) => b.operationalPriorities.length === 0)) && (
              <li className="py-6 text-sm text-slate-500">
                All operational queues are clear. Create content in Content Factory or connect social accounts.
              </li>
            )}
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Brand Growth Objectives
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Weekly, monthly, and quarterly targets per brand.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowGoalForm((v) => !v)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {showGoalForm ? 'Cancel' : 'Add Objective'}
            </button>
          </div>

          {showGoalForm && (
            <form onSubmit={handleCreateObjective} className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Brand</label>
                  <select
                    value={goalForm.brandId}
                    onChange={(e) => setGoalForm((f) => ({ ...f, brandId: e.target.value }))}
                    required
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                  >
                    {(data?.brands || []).map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Period</label>
                  <select
                    value={goalForm.period}
                    onChange={(e) =>
                      setGoalForm((f) => ({
                        ...f,
                        period: e.target.value as 'weekly' | 'monthly' | 'quarterly',
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Objective Title</label>
                <input
                  type="text"
                  required
                  value={goalForm.title}
                  onChange={(e) => setGoalForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g., Publish 12 verified industrial welding tips"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Metric</label>
                  <input
                    type="text"
                    required
                    value={goalForm.targetMetric}
                    onChange={(e) => setGoalForm((f) => ({ ...f, targetMetric: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Target</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={goalForm.targetValue}
                    onChange={(e) => setGoalForm((f) => ({ ...f, targetValue: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Unit</label>
                  <input
                    type="text"
                    required
                    value={goalForm.unit}
                    onChange={(e) => setGoalForm((f) => ({ ...f, unit: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Save Objective'}
              </button>
            </form>
          )}

          <div className="mt-4 divide-y divide-slate-100">
            {(data?.objectives || []).map((obj) => (
              <div key={obj.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{obj.title}</p>
                  <p className="font-mono text-[11px] text-slate-500">
                    {obj.period.toUpperCase()} · {obj.targetMetric} · Priority: {obj.priority}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-xs tabular-nums text-slate-700">
                  {obj.currentValue === null ? '—' : obj.currentValue} / {obj.targetValue} {obj.unit}
                </p>
              </div>
            ))}
            {(!data || data.objectives.length === 0) && (
              <p className="py-6 text-sm text-slate-500">
                No growth objectives defined yet. Add a weekly or monthly objective to anchor campaign priorities.
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Recent Marketing Activity */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Recent Marketing Activity</h2>
          <Link
            href="/dashboard/activity"
            className="text-xs font-medium text-blue-700 hover:underline"
          >
            View full activity center
          </Link>
        </div>
        <div className="mt-3 divide-y divide-slate-100">
          {(data?.recentActivities || []).slice(0, 8).map((act) => (
            <div key={act.id} className="flex flex-col justify-between gap-1 py-2.5 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-800">{act.summary}</p>
                <p className="font-mono text-[11px] text-slate-500">
                  {act.category} · {act.action} · {act.status}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-slate-400">
                {new Date(act.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
          {(!data || data.recentActivities.length === 0) && (
            <p className="py-6 text-sm text-slate-500">
              No marketing execution events recorded yet.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
