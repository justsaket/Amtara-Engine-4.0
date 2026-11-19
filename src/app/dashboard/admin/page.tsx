'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type { SchemaMigrationDefinition, WorkspaceIntegrityAuditResult } from '@/lib/server/migrations';

interface AdminConsoleResponse {
  generatedAt: string;
  accessRole: string;
  workspace: { id: string; name: string; timezone: string; status: string };
  members: Array<{
    uid: string;
    email: string;
    displayName: string;
    role: string;
    status: string;
  }>;
  integrationsHealth: {
    googleConnections: Array<{
      id: string;
      googleEmail: string;
      status: string;
      scopesCount: number;
      hasRefreshToken: boolean;
      lastVerifiedAt?: string;
    }>;
    socialAccounts: Array<{
      id: string;
      provider: string;
      displayName: string;
      status: string;
      readinessState: string;
      scopesCount: number;
    }>;
  };
  reliabilityMetrics: {
    scheduledJobsTotal: number;
    scheduledJobsFailedOrUnknown: number;
    jobFailureRatePercent: number | null;
    aiRunsTotal: number;
    aiRunsFailed: number;
    aiFailureRatePercent: number | null;
    aiEstimatedCostUsd: number;
    auditEventsCount: number;
  };
  configurationClassification: Array<{
    id: string;
    label: string;
    classification: string;
    source: string;
  }>;
  migrations: SchemaMigrationDefinition[];
  integrityAudit: WorkspaceIntegrityAuditResult;
}

export default function PlatformAdminPage() {
  const { activeWorkspace } = useWorkspace();
  const [data, setData] = useState<AdminConsoleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAdmin = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<AdminConsoleResponse>(
        `/api/workspaces/${activeWorkspace.id}/admin-console`,
      );
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Restricted to Workspace Owners and Administrators.',
      );
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadAdmin();
  }, [loadAdmin]);

  if (!activeWorkspace) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Select a workspace to open the Administrator Console.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-blue-700">Restricted Governance View</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
            Platform Administrator Console
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Operational reliability, member governance, schema migrations, and integration health.
            Raw user OAuth tokens and encrypted envelopes are strictly excluded.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAdmin()}
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

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Workspace Members</p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {data.members.length}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Job Failure Rate</p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {data.reliabilityMetrics.jobFailureRatePercent === null
                  ? '—'
                  : `${data.reliabilityMetrics.jobFailureRatePercent}%`}
              </p>
              <p className="mt-1 font-mono text-[11px] text-slate-500">
                {data.reliabilityMetrics.scheduledJobsFailedOrUnknown}/{data.reliabilityMetrics.scheduledJobsTotal} jobs
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">AI Run Failure Rate</p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {data.reliabilityMetrics.aiFailureRatePercent === null
                  ? '—'
                  : `${data.reliabilityMetrics.aiFailureRatePercent}%`}
              </p>
              <p className="mt-1 font-mono text-[11px] text-slate-500">
                {data.reliabilityMetrics.aiRunsFailed}/{data.reliabilityMetrics.aiRunsTotal} runs
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Audit Events Logged</p>
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {data.reliabilityMetrics.auditEventsCount}
              </p>
            </div>
          </div>

          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Workspace Members</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[11px] text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Member</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.members.map((m) => (
                    <tr key={m.uid}>
                      <td className="px-5 py-3 font-medium text-slate-900">{m.displayName || m.uid}</td>
                      <td className="px-4 py-3 text-slate-600">{m.email}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-800">{m.role}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{m.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Schema Migration Registry</h2>
              <p className="text-xs text-slate-500">
                Forward-compatible schema versions across Phases 1–5. Destructive migrations are never run automatically.
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {data.migrations.map((mig) => (
                <div key={mig.version} className="px-5 py-3.5">
                  <p className="text-sm font-medium text-slate-900">
                    <span className="font-mono text-xs text-blue-700">v{mig.version}</span> ·{' '}
                    {mig.phase} — {mig.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">{mig.description}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
