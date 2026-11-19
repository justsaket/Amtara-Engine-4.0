'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type { AuditLog, AutonomousConfigSnapshot } from '@/types/domain';

export default function SecurityAndAuditPage() {
  const { activeWorkspace } = useWorkspace();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [config, setConfig] = useState<AutonomousConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  const loadSecurity = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await apiRequest<AutonomousConfigSnapshot>('/api/config/status').catch(
        () => null,
      );
      if (cfg) setConfig(cfg);
      if (activeWorkspace) {
        const res = await apiRequest<{ logs: AuditLog[] }>(
          `/api/workspaces/${activeWorkspace.id}/audit`,
        );
        setLogs(res.logs);
      }
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadSecurity();
  }, [loadSecurity]);

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
          Security Posture & Immutable Audit Trail
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900">
          Security & Audit Logs
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Inspect encryption separation invariants, role enforcement, and append-only
          workspace audit logs.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Lock className="h-4 w-4 text-blue-700" />
            Credential Vault Law
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-900">
            Master Key Isolated
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Master encryption keys never reside inside Firestore alongside encrypted
            credentials (`{config?.secrets.encryptionKeyVersion || 'v1'}`).
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <ShieldCheck className="h-4 w-4 text-blue-700" />
            Tenant Isolation Gate
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-900">
            Active Membership Required
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Firestore rules and API guards deny cross-workspace reads, shadow keys, and
            role escalation.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <ShieldCheck className="h-4 w-4 text-blue-700" />
            Test Isolation Default
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-900">
            Live Google Tests: {config?.capabilities.realGoogleTestsEnabled ? 'ON' : 'OFF'}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            External live Google API integration tests stay disabled by default.
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">
            Workspace Audit Events
          </h2>
          <p className="text-xs text-slate-500">
            Append-only log enforced by Firestore security rules (`allow update, delete: if false`).
          </p>
        </div>

        <div className="divide-y divide-slate-100">
          {loading ? (
            <p className="px-6 py-8 text-sm text-slate-500">Loading audit events…</p>
          ) : logs.length === 0 ? (
            <p className="px-6 py-8 text-sm text-slate-500">
              No audit log records available in this workspace yet.
            </p>
          ) : (
            logs.map((evt) => (
              <div
                key={evt.id}
                className="flex flex-col justify-between gap-2 px-6 py-3.5 sm:flex-row sm:items-center"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {evt.summary || evt.action}
                  </p>
                  <p className="font-mono text-[11px] text-slate-500">
                    {evt.action} · actor {evt.actorEmail || evt.actorUid} · {evt.resourceType}/
                    {evt.resourceId}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[11px] text-slate-400">
                  {new Date(evt.createdAt).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
