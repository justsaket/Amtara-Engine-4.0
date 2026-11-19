'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, ExternalLink, RefreshCw, Workflow } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type { AppsScriptProjectRecord, MarketingActivityItem } from '@/types/domain';

interface MarketingTemplateSummary {
  key: string;
  name: string;
  description: string;
  marketingCategory: string;
  recommendedDeploymentType: string;
  defaultScopes: string[];
  filePreview: Array<{ name: string; type: string; lineCount: number }>;
}

interface MarketingAppsScriptResponse {
  templates: MarketingTemplateSummary[];
  linkedMarketingProjects: AppsScriptProjectRecord[];
  allAppsScriptProjectsCount: number;
  googleReadiness: {
    oauthConfigured: boolean;
    activeConnectionsCount: number;
    connections: Array<{
      id: string;
      googleEmail: string;
      status: string;
      scopesCount: number;
    }>;
  };
}

export function MarketingAppsScriptAndActivityConsole({
  view,
}: {
  view: 'apps-script' | 'activity';
}) {
  const { activeWorkspace } = useWorkspace();
  const [scriptData, setScriptData] = useState<MarketingAppsScriptResponse | null>(null);
  const [activities, setActivities] = useState<MarketingActivityItem[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [deployingKey, setDeployingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      if (view === 'apps-script') {
        const res = await apiRequest<MarketingAppsScriptResponse>(
          `/api/workspaces/${activeWorkspace.id}/marketing/apps-script`,
        );
        setScriptData(res);
      } else {
        const qs = categoryFilter ? `?category=${encodeURIComponent(categoryFilter)}` : '';
        const res = await apiRequest<{ activities: MarketingActivityItem[] }>(
          `/api/workspaces/${activeWorkspace.id}/marketing/activity${qs}`,
        );
        setActivities(res.activities);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load operational data.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, view, categoryFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleDeployTemplate(templateKey: string, name: string) {
    if (!activeWorkspace) return;
    setDeployingKey(templateKey);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ project: AppsScriptProjectRecord }>(
        `/api/workspaces/${activeWorkspace.id}/marketing/apps-script`,
        {
          method: 'POST',
          body: JSON.stringify({
            templateKey,
            title: `Antara — ${name}`,
            timezone: activeWorkspace.timezone || 'Asia/Kolkata',
          }),
        },
      );
      setNotice(
        `Created Google Apps Script project "${res.project.title}" (${res.project.scriptId}) via Phase 2 Control Plane.`,
      );
      await loadData();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to deploy template. Connect an authorized Google Workspace account in Apps Script Center first.',
      );
    } finally {
      setDeployingKey(null);
    }
  }

  if (!activeWorkspace) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Select a workspace to continue.
      </div>
    );
  }

  if (view === 'apps-script') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
              Phase 4 × Phase 2 · Google Apps Script Marketing Templates
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
              Marketing Apps Script Automations
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              8 ready-to-deploy marketing Apps Script templates wired directly into the Phase 2 Apps Script Control Plane (backup snapshots, versions, deployments, and triggers).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/apps-script"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Phase 2 Control Plane <ExternalLink className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</div>}

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-mono text-slate-700">
              Google OAuth Configured: {scriptData?.googleReadiness.oauthConfigured ? 'YES' : 'NO'} ·
              Active Google Connections: {scriptData?.googleReadiness.activeConnectionsCount ?? 0} ·
              Linked Marketing Script Projects: {scriptData?.linkedMarketingProjects.length ?? 0}
            </span>
            <Link href="/dashboard/apps-script" className="font-medium text-blue-700 hover:underline">
              Manage Google OAuth &amp; Triggers
            </Link>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          {(scriptData?.templates || []).map((tpl) => (
            <div key={tpl.key} className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-4 w-4 shrink-0 text-slate-700" />
                    <h2 className="text-sm font-semibold text-slate-900">{tpl.name}</h2>
                  </div>
                  <span className="font-mono text-[11px] uppercase text-slate-500">
                    {tpl.marketingCategory}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-600">{tpl.description}</p>
                <p className="mt-2 font-mono text-[11px] text-slate-500">
                  Deployment: {tpl.recommendedDeploymentType} · Files:{' '}
                  {tpl.filePreview.map((f) => `${f.name} (${f.lineCount}L)`).join(', ')}
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="font-mono text-[11px] text-slate-400">
                  {tpl.defaultScopes.length} scope(s)
                </span>
                <button
                  type="button"
                  disabled={deployingKey === tpl.key}
                  onClick={() => void handleDeployTemplate(tpl.key, tpl.name)}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {deployingKey === tpl.key ? 'Deploying...' : 'Deploy via Phase 2'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
            Phase 4 · Unified Marketing Audit &amp; Activity Timeline
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
            Marketing Activity Center
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Chronological log of content revisions, approvals, scheduled jobs, publishing attempts, autonomy changes, inbox replies, and experiments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
          >
            <option value="">All Categories</option>
            {['content', 'creative', 'publishing', 'approval', 'autonomy', 'inbox', 'review', 'lead', 'campaign', 'analytics'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3.5">
          <Activity className="h-4 w-4 text-slate-700" />
          <span className="font-mono text-xs text-slate-600">{activities.length} event(s)</span>
        </div>
        <div className="divide-y divide-slate-100">
          {activities.map((item) => (
            <div key={item.id} className="flex flex-col justify-between gap-1 px-5 py-3.5 sm:flex-row sm:items-center">
              <div className="min-w-0">
                <p className="text-sm text-slate-900">{item.summary}</p>
                <p className="font-mono text-[11px] text-slate-500">
                  {item.category} · {item.action} · {item.resourceType}:{item.resourceId} · {item.status}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-slate-400">
                {new Date(item.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
          {activities.length === 0 && (
            <p className="px-5 py-10 text-center text-sm text-slate-500">
              No marketing activity recorded for this filter yet.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
