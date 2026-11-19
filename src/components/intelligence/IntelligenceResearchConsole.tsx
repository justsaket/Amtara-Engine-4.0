'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import {
  Check,
  Compass,
  ExternalLink,
  FilePlus2,
  Search,
  X,
} from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { hasPermission } from '@/lib/rbac';
import type {
  AgentArtifactPayload,
  BrandProfile,
  ClaimEvidenceRecord,
  ResearchSourceRecord,
} from '@/types/domain';

export function IntelligenceResearchConsole() {
  const { activeWorkspace } = useWorkspace();
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [sources, setSources] = useState<ResearchSourceRecord[]>([]);
  const [claims, setClaims] = useState<ClaimEvidenceRecord[]>([]);
  const [artifacts, setArtifacts] = useState<AgentArtifactPayload[]>([]);

  const [query, setQuery] = useState('');
  const [urlsText, setUrlsText] = useState('');
  const [includeSeoAudit, setIncludeSeoAudit] = useState(true);
  const [running, setRunning] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canRunResearch = hasPermission(activeWorkspace?.role, 'research:run');
  const canApproveMemory = hasPermission(activeWorkspace?.role, 'memory:approve');

  const loadData = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const [brandRes, intRes] = await Promise.all([
        apiRequest<{ brands: BrandProfile[] }>(
          `/api/workspaces/${activeWorkspace.id}/brands`,
        ),
        apiRequest<{
          sources: ResearchSourceRecord[];
          claims: ClaimEvidenceRecord[];
          artifacts: AgentArtifactPayload[];
        }>(`/api/workspaces/${activeWorkspace.id}/ai/intelligence`),
      ]);
      setBrands(brandRes.brands);
      if (!selectedBrandId && brandRes.brands[0]) {
        setSelectedBrandId(brandRes.brands[0].id);
      }
      setSources(intRes.sources);
      setClaims(intRes.claims);
      setArtifacts(intRes.artifacts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Research & Market Radar.');
    }
  }, [activeWorkspace, selectedBrandId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleRunResearch(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !query.trim() || !canRunResearch) return;
    setRunning(true);
    setFeedback(null);
    setError(null);
    try {
      const urlsToInspect = urlsText
        .split('\n')
        .map((u) => u.trim())
        .filter((u) => u.startsWith('https://') || u.startsWith('http://'));

      const res = await apiRequest<{
        run: { status: string; finalSummary?: string };
      }>(`/api/workspaces/${activeWorkspace.id}/ai/intelligence`, {
        method: 'POST',
        body: JSON.stringify({
          brandId: selectedBrandId || undefined,
          query: query.trim(),
          urlsToInspect,
          includeSeoAudit,
        }),
      });
      setFeedback(`Research mission finished with status: ${res.run.status}.`);
      setQuery('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Research execution failed.');
    } finally {
      setRunning(false);
    }
  }

  async function handleClaimAction(
    claimId: string,
    action: 'promote_to_memory' | 'reject' | 'create_brief',
  ) {
    if (!activeWorkspace) return;
    setFeedback(null);
    setError(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/ai/intelligence`, {
        method: 'POST',
        body: JSON.stringify({
          claimId,
          action,
          brandId: selectedBrandId || undefined,
        }),
      });
      setFeedback(
        action === 'promote_to_memory'
          ? 'Claim promoted to approved research memory.'
          : action === 'reject'
            ? 'Claim rejected and recorded in rejection_memory guardrails.'
            : 'Created research-backed content brief in Content Strategy.',
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to apply claim action.');
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
            Phase 3 · Agents 02 & 03
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900">
            Market Radar & Search Research
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            SSRF-guarded source fetching, grounded search research, conflict detection, and verified claim promotion.
          </p>
        </div>

        <div>
          <label
            htmlFor="res-brand"
            className="block font-mono text-[10px] uppercase tracking-wider text-slate-500"
          >
            Brand Context
          </label>
          <select
            id="res-brand"
            value={selectedBrandId}
            onChange={(e) => setSelectedBrandId(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900"
          >
            <option value="">Workspace-Wide</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {feedback && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
          {feedback}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
          {error}
        </div>
      )}

      {/* Research Launcher */}
      <form
        onSubmit={handleRunResearch}
        className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Compass className="h-4 w-4 text-blue-700" />
          Launch Grounded Research Mission
        </h2>

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <label htmlFor="res-query" className="block text-xs font-medium text-slate-700">
              Research Question or Competitor / SEO Topic
            </label>
            <textarea
              id="res-query"
              rows={3}
              value={query}
              disabled={running || !canRunResearch}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Example: Analyze emerging search demand around automated welding workflows and map content gaps."
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label htmlFor="res-urls" className="block text-xs font-medium text-slate-700">
              Optional Public URLs to Inspect (one per line · SSRF guarded)
            </label>
            <textarea
              id="res-urls"
              rows={3}
              value={urlsText}
              disabled={running || !canRunResearch}
              onChange={(e) => setUrlsText(e.target.value)}
              placeholder="https://example.com/article"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={includeSeoAudit}
              onChange={(e) => setIncludeSeoAudit(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Include Agent 03 Search Visibility cluster audit
          </label>

          <button
            type="submit"
            disabled={running || !query.trim() || !canRunResearch}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Search className="h-3.5 w-3.5" />
            {running ? 'Researching…' : 'Run Market & Search Intelligence'}
          </button>
        </div>
      </form>

      {/* Evaluated Claims Ledger */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Claim Evidence Ledger ({claims.length})
        </h2>
        {claims.length === 0 ? (
          <p className="text-xs text-slate-500">
            No claims evaluated yet. Run a research mission or AI Command to inspect verified vs unverified assertions.
          </p>
        ) : (
          <div className="space-y-3">
            {claims.map((clm) => (
              <div
                key={clm.id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-900">
                    {clm.verificationStatus} · {Math.round(clm.confidence * 100)}% confidence ·{' '}
                    {clm.reviewState}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {clm.supportingSourceIds.length} supporting ·{' '}
                    {clm.contradictingSourceIds.length} contradicting
                  </span>
                </div>
                <p className="font-medium text-slate-900">{clm.claimText}</p>
                <p className="text-slate-600">{clm.rationale}</p>
                {clm.conflictNote && (
                  <p className="font-medium text-rose-700">{clm.conflictNote}</p>
                )}

                {canApproveMemory && clm.reviewState === 'open' && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void handleClaimAction(clm.id, 'promote_to_memory')}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-50"
                    >
                      <Check className="h-3 w-3" />
                      Promote to Memory
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleClaimAction(clm.id, 'create_brief')}
                      className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-white px-2.5 py-1 text-[11px] font-medium text-blue-800 hover:bg-blue-50"
                    >
                      <FilePlus2 className="h-3 w-3" />
                      Create Content Brief
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleClaimAction(clm.id, 'reject')}
                      className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-800 hover:bg-rose-50"
                    >
                      <X className="h-3 w-3" />
                      Reject Claim
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Deduplicated Sources & Reports */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Deduplicated Source Library ({sources.length})
          </h2>
          {sources.length === 0 ? (
            <p className="text-xs text-slate-500">No external sources retrieved yet.</p>
          ) : (
            <div className="space-y-3">
              {sources.map((src) => (
                <div
                  key={src.id}
                  className="rounded-lg border border-slate-200 p-3 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"
                    >
                      {src.title}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <span className="font-mono text-[10px] text-slate-500">
                      {src.domain}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-slate-600">{src.snippet}</p>
                  <p className="font-mono text-[10px] text-slate-400">
                    Reliability {Math.round(src.reliabilityScore * 100)}% · Retrieved{' '}
                    {new Date(src.retrievedAt).toLocaleString()}
                    {src.publishedAt ? ` · Published ${src.publishedAt}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Market & SEO Reports ({artifacts.length})
          </h2>
          {artifacts.length === 0 ? (
            <p className="text-xs text-slate-500">No Market Radar or Search Visibility reports yet.</p>
          ) : (
            <div className="space-y-4">
              {artifacts.slice(0, 6).map((art) => (
                <div
                  key={art.id}
                  className="rounded-lg border border-slate-200 p-4 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{art.title}</span>
                    <span className="font-mono text-[10px] text-slate-500">
                      {art.agentId} · {art.verificationStatus}
                    </span>
                  </div>
                  <div className="prose prose-xs max-w-none text-slate-700">
                    <Markdown>{art.contentMarkdown.slice(0, 1200)}</Markdown>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
