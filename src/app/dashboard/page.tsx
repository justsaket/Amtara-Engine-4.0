'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Cpu,
  HeartPulse,
  PenTool,
  RefreshCw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type { OnboardingProgressSummary } from '@/lib/onboarding/progress';
import type { BrandGrowthReadinessSummary } from '@/lib/marketing/growth-controller';
import type {
  MarketingActivityItem,
  NotificationRecord,
  WorkspaceEmergencyStopState,
} from '@/types/domain';

interface ExecutiveOverviewData {
  workspace: {
    id: string;
    name: string;
    timezone: string;
    role: string;
  };
  selectedBrandId: string | null;
  brands: Array<{
    id: string;
    name: string;
    primaryColor: string;
    industry?: string;
    status: string;
  }>;
  onboarding: OnboardingProgressSummary;
  emergencyStop: WorkspaceEmergencyStopState;
  totals: {
    brands: number;
    connectedAccounts: number;
    contentItems: number;
    scheduledPosts: number;
    publishedPosts: number;
    pendingApprovals: number;
    failedOrUnknownJobs: number;
    openConversations: number;
    unansweredReviews: number;
    activeLeads: number;
    observedImpressions: number | null;
    observedEngagements: number | null;
    appsScriptProjects: number;
    googleConnections: number;
    aiRunsTotal: number;
    aiTokensTotal: number;
    aiEstimatedCostUsd: number;
    mediaAssets: number;
    unreadNotifications: number;
  };
  brandSummaries: BrandGrowthReadinessSummary[];
  recentRuns: Array<{
    id: string;
    brandId: string;
    prompt: string;
    status: string;
    executionMode: string;
    createdAt: string;
    completedAt?: string;
  }>;
  recentActivities: MarketingActivityItem[];
  unreadAlerts: NotificationRecord[];
  capabilities: {
    aiConfigured: boolean;
    activeAiProviders: string[];
    googleOAuthConfigured: boolean;
    databaseReady: boolean;
    encryptedVaultReady: boolean;
  };
  generatedAt: string;
}

export default function DashboardOverviewPage() {
  const { activeWorkspace } = useWorkspace();
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [data, setData] = useState<ExecutiveOverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOnboardingChecklist, setShowOnboardingChecklist] = useState(true);

  const loadExecutiveOverview = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const qs = selectedBrandId ? `?brandId=${encodeURIComponent(selectedBrandId)}` : '';
      const res = await apiRequest<ExecutiveOverviewData>(
        `/api/workspaces/${activeWorkspace.id}/executive-overview${qs}`,
      );
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load workspace executive overview.',
      );
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, selectedBrandId]);

  useEffect(() => {
    void loadExecutiveOverview();
  }, [loadExecutiveOverview]);

  if (!activeWorkspace) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Select or initialize a workspace to open your Antara Engine overview.
      </div>
    );
  }

  const totals = data?.totals;

  return (
    <div className="space-y-8">
      {/* Header & Brand Scope */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-blue-700">Executive Workspace Overview</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            {activeWorkspace.name}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Live workspace operations, AI orchestration, approvals, publishing readiness, and
            system health across all active brands.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="overview-brand-filter" className="sr-only">
            Filter by brand
          </label>
          <select
            id="overview-brand-filter"
            value={selectedBrandId}
            onChange={(e) => setSelectedBrandId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-blue-700 focus:outline-none"
          >
            <option value="">All Brands ({data?.brands.length ?? activeWorkspace.brandCount})</option>
            {(data?.brands || []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void loadExecutiveOverview()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <Link
            href="/dashboard/content/new"
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            <PenTool className="h-3.5 w-3.5" />
            New Content
          </Link>
        </div>
      </div>

      {/* Emergency Stop Banner */}
      {data?.emergencyStop.globalStopped && (
        <div
          role="alert"
          className="flex flex-col justify-between gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4 sm:flex-row sm:items-center"
        >
          <div>
            <p className="text-xs font-semibold text-rose-800">Global Emergency Stop Active</p>
            <p className="mt-0.5 text-sm text-rose-900">
              All automated publishing, outbound replies, and scheduled dispatches are halted.
              {data.emergencyStop.reason ? ` Reason: ${data.emergencyStop.reason}` : ''}
            </p>
          </div>
          <Link
            href="/dashboard/autonomy"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-100"
          >
            Manage Stop Controls <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* Loading Skeleton (first load only) */}
      {!data && loading && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-busy="true">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white p-4"
            />
          ))}
        </div>
      )}

      {/* Primary KPI Grid — Real Persisted Counts Only */}
      {data && totals && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Pending Approvals</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {totals.pendingApprovals}
            </p>
            <Link
              href="/dashboard/approvals"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
            >
              Review queue <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Scheduled / Published</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {totals.scheduledPosts} <span className="text-slate-300">/</span> {totals.publishedPosts}
            </p>
            <Link
              href="/dashboard/calendar"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
            >
              Content calendar <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Connected Channels &amp; Google</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {totals.connectedAccounts + totals.googleConnections}
            </p>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              {totals.connectedAccounts} social · {totals.googleConnections} Google · {totals.appsScriptProjects} scripts
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Recovery Attention</p>
            <p
              className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${
                totals.failedOrUnknownJobs > 0 ? 'text-rose-700' : 'text-slate-900'
              }`}
            >
              {totals.failedOrUnknownJobs}
            </p>
            <Link
              href="/dashboard/publishing"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
            >
              Publishing recovery <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">AI Orchestrator Runs</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {totals.aiRunsTotal}
            </p>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              {totals.aiTokensTotal.toLocaleString()} tokens · ${totals.aiEstimatedCostUsd.toFixed(4)} est.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Inbox &amp; Reviews</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {totals.openConversations} <span className="text-slate-300">/</span> {totals.unansweredReviews}
            </p>
            <Link
              href="/dashboard/inbox"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
            >
              Open engagement <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Active Leads</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {totals.activeLeads}
            </p>
            <Link
              href="/dashboard/leads"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
            >
              Manage pipeline <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Observed Impressions</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {totals.observedImpressions === null
                ? 'Not collected'
                : totals.observedImpressions.toLocaleString()}
            </p>
            <Link
              href="/dashboard/analytics"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
            >
              View analytics <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

      {/* Resumable 9-Stage Workspace Readiness & Onboarding Progress */}
      {data && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Workspace Onboarding &amp; Capability Readiness
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Required core: {data.onboarding.completedRequiredCount}/{data.onboarding.totalRequiredCount} ·
                Optional channels &amp; integrations: {data.onboarding.completedOptionalCount}/{data.onboarding.totalOptionalCount} ·
                Overall {data.onboarding.completionPercent}%
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowOnboardingChecklist((v) => !v)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {showOnboardingChecklist ? 'Hide Checklist' : 'Show Checklist'}
            </button>
          </div>

          {showOnboardingChecklist && (
            <div className="divide-y divide-slate-100">
              {data.onboarding.stages.map((stage) => (
                <div
                  key={stage.id}
                  className="flex flex-col justify-between gap-2 px-5 py-3 sm:flex-row sm:items-center"
                >
                  <div className="flex items-start gap-3">
                    {stage.completed ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {stage.label}
                        <span className="ml-2 font-mono text-[11px] font-normal text-slate-500">
                          {stage.required ? 'Required' : 'Optional'} · {stage.completed ? 'Ready' : 'Not configured'}
                        </span>
                      </p>
                      <p className="text-xs text-slate-600">{stage.detail}</p>
                    </div>
                  </div>
                  <Link
                    href={stage.actionHref}
                    className="shrink-0 text-xs font-medium text-blue-700 hover:underline"
                  >
                    {stage.actionLabel}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Brand Execution Table */}
      {data && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Brand Operations Summary</h2>
              <p className="text-xs text-slate-500">
                Persisted brand pipelines and null-preserving metrics. Uncollected figures remain blank rather than zeroed.
              </p>
            </div>
            <Link
              href="/dashboard/brands"
              className="text-xs font-medium text-blue-700 hover:underline"
            >
              Manage brands
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[740px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[11px] text-slate-500">
                <tr>
                  <th className="px-5 py-3">Brand</th>
                  <th className="px-4 py-3">Autonomy Mode</th>
                  <th className="px-4 py-3 text-right">Drafts</th>
                  <th className="px-4 py-3 text-right">Approvals</th>
                  <th className="px-4 py-3 text-right">Scheduled</th>
                  <th className="px-4 py-3 text-right">Published</th>
                  <th className="px-4 py-3 text-right">Impressions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.brandSummaries.map((b) => (
                  <tr key={b.brandId} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{b.brandName}</p>
                      <p className="font-mono text-[11px] text-slate-500">
                        {b.connectedAccountsCount} channel(s) · {b.activeLeadsCount} lead(s)
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {b.paused ? 'PAUSED' : b.autonomyMode}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                      {b.draftContentCount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                      {b.pendingApprovalsCount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                      {b.scheduledPostsCount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                      {b.publishedPostsCount}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                      {b.latestObservedImpressions === null
                        ? 'Not collected'
                        : b.latestObservedImpressions.toLocaleString()}
                    </td>
                  </tr>
                ))}
                {data.brandSummaries.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-500">
                      No brand profiles found for the current filter. Create a brand under Management / Brands.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent AI Runs & Recent Marketing Activity */}
      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Recent AI Orchestration Runs</h2>
              <Link href="/dashboard/ai" className="text-xs font-medium text-blue-700 hover:underline">
                Open Command Center
              </Link>
            </div>
            <div className="mt-3 divide-y divide-slate-100">
              {data.recentRuns.map((run) => (
                <div key={run.id} className="py-3">
                  <p className="truncate text-sm font-medium text-slate-800">{run.prompt}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                    {run.status} · {run.executionMode} · {new Date(run.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
              {data.recentRuns.length === 0 && (
                <p className="py-6 text-sm text-slate-500">
                  No AI orchestration runs recorded yet. Launch a brief in AI Command Center.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Recent Execution Activity</h2>
              <Link
                href="/dashboard/activity"
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                Full timeline
              </Link>
            </div>
            <div className="mt-3 divide-y divide-slate-100">
              {data.recentActivities.map((act) => (
                <div key={act.id} className="py-3">
                  <p className="truncate text-sm text-slate-800">{act.summary}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                    {act.category} · {act.action} · {act.status} ·{' '}
                    {new Date(act.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
              {data.recentActivities.length === 0 && (
                <p className="py-6 text-sm text-slate-500">
                  No marketing execution events logged yet.
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Direct Launch Shortcuts */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'AI Command Center',
            detail: 'Coordinate 9 specialist agents',
            href: '/dashboard/ai',
            icon: Cpu,
          },
          {
            label: 'Publishing & Accounts',
            detail: 'Connect channels & recover jobs',
            href: '/dashboard/publishing',
            icon: Send,
          },
          {
            label: 'Autonomy & Safety',
            detail: 'Modes A/B/C & Emergency Stop',
            href: '/dashboard/autonomy',
            icon: ShieldAlert,
          },
          {
            label: 'System Health',
            detail: 'Live DB latency & provider matrix',
            href: '/dashboard/system-health',
            icon: HeartPulse,
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.href}
              href={card.href}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3.5 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">{card.label}</p>
                <p className="text-xs text-slate-500">{card.detail}</p>
              </div>
              <Icon className="h-4 w-4 shrink-0 text-slate-500" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
