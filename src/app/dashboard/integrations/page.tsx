'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { GoogleOAuthHub } from '@/components/apps-script/GoogleOAuthHub';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { hasPermission } from '@/lib/rbac';
import type { AutonomousConfigSnapshot, IntegrationRecord } from '@/types/domain';

export default function IntegrationsPage() {
  const { activeWorkspace } = useWorkspace();
  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [config, setConfig] = useState<AutonomousConfigSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConfigure = hasPermission(
    activeWorkspace?.role,
    'integrations:configure',
  );

  const loadData = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    try {
      const [intRes, cfgRes] = await Promise.all([
        apiRequest<{ integrations: IntegrationRecord[] }>(
          `/api/workspaces/${activeWorkspace.id}/integrations`,
        ),
        apiRequest<AutonomousConfigSnapshot>('/api/config/status'),
      ]);
      setIntegrations(intRes.integrations);
      setConfig(cfgRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function toggleDisabled(item: IntegrationRecord) {
    if (!activeWorkspace || !canConfigure) return;
    setError(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/integrations`, {
        method: 'POST',
        body: JSON.stringify({
          provider: item.provider,
          category: item.category,
          requestedScopes: item.requestedScopes || [],
          disabled: item.status !== 'disabled',
        }),
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update integration.');
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
            Phase 2 · Universal Google Access & Capability Matrix
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900">
            Integrations & External Authorization
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Connect Google Workspace & Apps Script via explicit OAuth consent while keeping unrelated future adapters cleanly isolated.
          </p>
        </div>

        <Link
          href="/dashboard/apps-script"
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
        >
          Open Apps Script Center <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-5 text-sm text-slate-800">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
        <div>
          <p className="font-semibold text-slate-900">
            Explicit Consent Separation Guarantee
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            Signing into Antara Engine never automatically authorizes Google Workspace,
            Apps Script, YouTube, Meta, LinkedIn, TikTok, or Canva. Google tokens are encrypted
            with AES-256-GCM bound to your workspace and connection ID.
          </p>
        </div>
      </div>

      {/* Live Phase 2 Google Connectivity Hub */}
      <Suspense
        fallback={
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
            Loading Google OAuth hub…
          </div>
        }
      >
        <GoogleOAuthHub
          returnPath="/dashboard/integrations"
          onConnectionChanged={loadData}
        />
      </Suspense>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {/* Workspace Provider Capability Matrix */}
      <section className="space-y-4">
        <h2 className="font-display text-base font-semibold text-slate-900">
          All Workspace Integration Adapters
        </h2>
        {loading ? (
          <p className="text-sm text-slate-500">Loading integration capabilities…</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {integrations.map((item) => (
              <div
                key={item.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {item.provider.replace(/_/g, ' ').toUpperCase()}
                    </h3>
                    <span className="font-mono text-[11px] font-semibold uppercase text-slate-700">
                      {item.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    Category: {item.category} · Class: {item.capabilityClass}
                  </p>
                  <p className="mt-2 text-xs text-slate-600">
                    {item.accountEmail
                      ? `Connected account: ${item.accountEmail} (${item.grantedScopes.length} scopes granted).`
                      : item.provider === 'gemini_ai' && config?.capabilities.geminiConfigured
                        ? 'Server-side GEMINI_API_KEY detected cleanly for Phase 3 agents.'
                        : item.provider.startsWith('google_')
                          ? 'Authorize via Google OAuth panel above when ready.'
                          : 'Optional until Phase 4 social/creative activation.'}
                  </p>
                </div>

                {canConfigure && !item.provider.startsWith('google_') && (
                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                    <span className="font-mono text-[11px] text-slate-400">
                      Optional Adapter Slot
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleDisabled(item)}
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {item.status === 'disabled' ? 'Enable Slot' : 'Disable Adapter'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
