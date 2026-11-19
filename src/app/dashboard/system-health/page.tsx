'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type { ProviderCapabilityMatrixEntry } from '@/lib/marketing/providers/types';
import type { WorkspaceIntegrityAuditResult } from '@/lib/server/migrations';
import type { StructuredLogEntry } from '@/lib/server/observability';

interface SystemHealthResponse {
  checkedAt: string;
  workspace: { id: string; name: string; role: string; timezone: string };
  subsystems: Array<{
    id: string;
    label: string;
    status: string;
    detail: string;
    latencyMs?: number;
  }>;
  providerMatrix: ProviderCapabilityMatrixEntry[];
  agentExecution: {
    totalRuns: number;
    failedRuns: number;
    totalUsageRecords: number;
    estimatedCostUsd: number;
  };
  publishingQueue: {
    scheduledCount: number;
    publishedCount: number;
    failedOrUnknownCount: number;
    failedSample: Array<{
      id: string;
      platform: string;
      status: string;
      lastErrorCode?: string;
      lastErrorMessage?: string;
      scheduledForUtc: string;
    }>;
  };
  deployment: {
    nodeEnv: string;
    isVercel: boolean;
    vercelEnv: string | null;
    commitSha: string | null;
    cronConfigured: string;
    realGoogleTestsEnabled: boolean;
  };
  integrityAudit: WorkspaceIntegrityAuditResult | null;
  recentLogs: StructuredLogEntry[];
}

function statusTone(status: string): string {
  switch (status) {
    case 'healthy':
    case 'connected':
      return 'text-emerald-700';
    case 'warning':
    case 'degraded':
    case 'authorization_required':
    case 'app_review_required':
    case 'paused':
      return 'text-amber-700';
    case 'error':
      return 'text-rose-700';
    default:
      return 'text-slate-500';
  }
}

export default function SystemHealthPage() {
  const { activeWorkspace } = useWorkspace();
  const [data, setData] = useState<SystemHealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<SystemHealthResponse>(
        `/api/workspaces/${activeWorkspace.id}/system-health`,
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load system health.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  if (!activeWorkspace) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Select a workspace to inspect live system health.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-blue-700">Observability &amp; Operations</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
            System Health Center
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Live Firestore probes, verified provider capability states, scheduler queues, and
            non-destructive schema integrity diagnostics.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadHealth()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 self-start whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Run Live Health Check
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Core Subsystems */}
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Core Subsystem Checks</h2>
              <span className="font-mono text-xs text-slate-500">
                Checked {new Date(data.checkedAt).toLocaleString()}
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {data.subsystems.map((sub) => (
                <div
                  key={sub.id}
                  className="flex flex-col justify-between gap-2 px-5 py-3.5 sm:flex-row sm:items-center"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">{sub.label}</p>
                    <p className="text-xs text-slate-600">{sub.detail}</p>
                  </div>
                  <div className="shrink-0 text-left sm:text-right">
                    <p className={`font-mono text-xs font-semibold ${statusTone(sub.status)}`}>
                      {sub.status.replace(/_/g, ' ').toUpperCase()}
                    </p>
                    {typeof sub.latencyMs === 'number' && (
                      <p className="font-mono text-[11px] tabular-nums text-slate-400">
                        {sub.latencyMs} ms
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Provider Capability Matrix */}
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  External Provider Capability Matrix
                </h2>
                <p className="text-xs text-slate-500">
                  Genuine OAuth configuration and connected account states. Missing providers never block unrelated features.
                </p>
              </div>
              <Link
                href="/dashboard/publishing/accounts"
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                Manage accounts
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[11px] text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Provider</th>
                    <th className="px-4 py-3">Readiness State</th>
                    <th className="px-4 py-3">OAuth Configured</th>
                    <th className="px-4 py-3">Platform Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.providerMatrix.map((row) => (
                    <tr key={row.provider}>
                      <td className="px-5 py-3 font-medium text-slate-900">{row.displayName}</td>
                      <td className={`px-4 py-3 font-mono text-xs font-medium ${statusTone(row.readinessState)}`}>
                        {row.readinessState}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">
                        {row.oauthConfigured ? 'configured' : 'not_configured'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{row.appReviewNotes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Runtime, Queue & Integrity Audit */}
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Deployment &amp; Scheduler Runtime
              </h2>
              <dl className="mt-4 divide-y divide-slate-100 text-xs">
                <div className="flex justify-between py-2.5">
                  <dt className="text-slate-500">Environment</dt>
                  <dd className="font-mono text-slate-900">
                    {data.deployment.vercelEnv || data.deployment.nodeEnv}
                  </dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-slate-500">Commit SHA</dt>
                  <dd className="font-mono text-slate-900">
                    {data.deployment.commitSha ? data.deployment.commitSha.slice(0, 10) : 'Local build'}
                  </dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-slate-500">Cron Dispatcher</dt>
                  <dd className="font-mono text-slate-900">{data.deployment.cronConfigured}</dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-slate-500">AI Runs / Failed</dt>
                  <dd className="font-mono tabular-nums text-slate-900">
                    {data.agentExecution.totalRuns} / {data.agentExecution.failedRuns}
                  </dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-slate-500">Scheduled / Failed Jobs</dt>
                  <dd className="font-mono tabular-nums text-slate-900">
                    {data.publishingQueue.scheduledCount} / {data.publishingQueue.failedOrUnknownCount}
                  </dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-slate-500">Real Google Live Tests</dt>
                  <dd className="font-mono text-slate-900">
                    {data.deployment.realGoogleTestsEnabled ? 'Enabled (explicit)' : 'Disabled (safe default)'}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Database Schema Integrity &amp; Backup Posture
              </h2>
              {data.integrityAudit ? (
                <div className="mt-3 space-y-3 text-xs text-slate-600">
                  <p className="font-mono text-slate-800">
                    Target Schema: v{data.integrityAudit.targetSchemaVersion} ·{' '}
                    {data.integrityAudit.totalDocumentsScanned} docs scanned ·{' '}
                    <span className={data.integrityAudit.healthy ? 'text-emerald-700' : 'text-rose-700'}>
                      {data.integrityAudit.healthy ? 'No blocking errors' : 'Errors detected'}
                    </span>
                  </p>
                  <p>{data.integrityAudit.backupReadiness.note}</p>
                  {data.integrityAudit.findings.length > 0 ? (
                    <ul className="divide-y divide-slate-100 border-t border-slate-100">
                      {data.integrityAudit.findings.slice(0, 6).map((f, idx) => (
                        <li key={idx} className="py-2">
                          <span className="font-mono font-medium text-slate-900">
                            {f.severity.toUpperCase()} · {f.collection}/{f.documentId}
                          </span>
                          <p className="mt-0.5 text-slate-600">{f.detail}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-emerald-700">
                      Zero orphan references, duplicate job keys, or expired leases detected.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">Integrity audit unavailable.</p>
              )}
            </section>
          </div>

          {/* Failed/Ambiguous Jobs needing Recovery */}
          {data.publishingQueue.failedSample.length > 0 && (
            <section className="rounded-xl border border-rose-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-rose-900">
                  Jobs Requiring Operator Recovery
                </h2>
                <Link
                  href="/dashboard/publishing"
                  className="text-xs font-medium text-blue-700 hover:underline"
                >
                  Open Publishing Recovery
                </Link>
              </div>
              <div className="mt-3 divide-y divide-slate-100 text-xs">
                {data.publishingQueue.failedSample.map((job) => (
                  <div key={job.id} className="flex flex-col justify-between gap-1 py-2.5 sm:flex-row">
                    <div>
                      <span className="font-mono font-medium text-slate-900">
                        {job.platform} · {job.status}
                      </span>
                      <p className="text-slate-600">
                        {job.lastErrorCode || 'UNKNOWN'}: {job.lastErrorMessage || 'Inspect attempt log'}
                      </p>
                    </div>
                    <span className="font-mono text-slate-400">
                      {new Date(job.scheduledForUtc).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
