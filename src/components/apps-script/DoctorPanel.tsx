'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  XCircle,
} from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type { GoogleDoctorReport } from '@/types/domain';

export function DoctorPanel({ selectedScriptId }: { selectedScriptId?: string }) {
  const { activeWorkspace } = useWorkspace();
  const [report, setReport] = useState<GoogleDoctorReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDoctor = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const qs = selectedScriptId
        ? `?scriptId=${encodeURIComponent(selectedScriptId)}`
        : '';
      const res = await apiRequest<{ report: GoogleDoctorReport }>(
        `/api/workspaces/${activeWorkspace.id}/google/doctor${qs}`,
      );
      setReport(res.report);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to run Google Integration Doctor.',
      );
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, selectedScriptId]);

  useEffect(() => {
    void runDoctor();
  }, [runDoctor]);

  return (
    <div className="space-y-6">
      {/* Header & Summary Card */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Stethoscope className="h-4 w-4 text-blue-700" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                Google Integration Doctor
              </h2>
            </div>
            <p className="text-xs text-slate-600">
              16-point automated verification covering Platform OAuth, token vault, live scopes, Drive API, Apps Script User Settings toggle, and deployments.
            </p>
          </div>
          <button
            type="button"
            onClick={runDoctor}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Running Diagnostics…' : 'Run Live Diagnostics'}
          </button>
        </div>

        {/* Google Account Toggle Notice */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/70 p-4 text-xs text-slate-800">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
            <div>
              <p className="font-semibold text-slate-900">
                Prerequisite in Google Account: Google Apps Script API Toggle
              </p>
              <p className="mt-0.5 text-slate-600">
                Even after granting OAuth scopes, Google requires each connected Google user to turn ON the Google Apps Script API toggle in their personal Apps Script settings.
              </p>
            </div>
          </div>
          <a
            href="https://script.google.com/home/usersettings"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-white px-3 py-1.5 font-medium text-blue-700 hover:bg-blue-50"
          >
            Open Apps Script Settings <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        {report && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-3.5">
              <p className="font-mono text-[11px] uppercase text-slate-500">Overall Readiness</p>
              <p
                className={`mt-1 font-display text-sm font-semibold ${
                  report.overallReady ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {report.overallReady ? 'Ready for Operations' : 'Action Required'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3.5">
              <p className="font-mono text-[11px] uppercase text-slate-500">Connected Google Account</p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                {report.connectedEmail || 'Not connected'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3.5">
              <p className="font-mono text-[11px] uppercase text-slate-500">Passing Checks</p>
              <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-900">
                {report.checks.filter((c) => c.status === 'pass').length} / {report.checks.length}
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* Checklist Items */}
      {report && (
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
          {report.checks.map((item) => (
            <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="flex min-w-0 items-start gap-3">
                {item.status === 'pass' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : item.status === 'error' ? (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">{item.label}</p>
                    <span className="font-mono text-[11px] text-slate-500">{item.code}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600">{item.detail}</p>
                </div>
              </div>
              {item.actionUrl && (
                <a
                  href={item.actionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-slate-50"
                >
                  {item.actionLabel || 'Open Console'} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
