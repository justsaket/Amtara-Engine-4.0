'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Database, Plus, ShieldAlert, X } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { hasPermission } from '@/lib/rbac';
import type {
  BrandFactCategory,
  BrandKnowledgeFact,
  BrandProfile,
  MemoryItem,
  MemoryNamespace,
  VerificationStatus,
} from '@/types/domain';

interface CategoryMeta {
  id: BrandFactCategory;
  label: string;
  description: string;
}

interface NamespaceMeta {
  id: MemoryNamespace;
  label: string;
  description: string;
}

export function BrandMemoryConsole() {
  const { activeWorkspace } = useWorkspace();
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [activeTab, setActiveTab] = useState<'knowledge' | 'memory'>('knowledge');

  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [namespaces, setNamespaces] = useState<NamespaceMeta[]>([]);
  const [facts, setFacts] = useState<BrandKnowledgeFact[]>([]);
  const [memoryItems, setMemoryItems] = useState<MemoryItem[]>([]);

  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterNamespace, setFilterNamespace] = useState<string>('all');

  // Add Fact form
  const [factCategory, setFactCategory] = useState<BrandFactCategory>('identity_and_positioning');
  const [factTitle, setFactTitle] = useState('');
  const [factStatement, setFactStatement] = useState('');
  const [factVerification, setFactVerification] = useState<VerificationStatus>('VERIFIED');
  const [factUrl, setFactUrl] = useState('');

  // Add Memory form
  const [memNamespace, setMemNamespace] = useState<MemoryNamespace>('brand_memory');
  const [memTitle, setMemTitle] = useState('');
  const [memContent, setMemContent] = useState('');

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canPropose = hasPermission(activeWorkspace?.role, 'memory:propose');
  const canApprove = hasPermission(activeWorkspace?.role, 'memory:approve');

  const loadData = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const brandRes = await apiRequest<{ brands: BrandProfile[] }>(
        `/api/workspaces/${activeWorkspace.id}/brands`,
      );
      setBrands(brandRes.brands);
      const effectiveBrandId = selectedBrandId || brandRes.brands[0]?.id || '';
      if (!selectedBrandId && effectiveBrandId) {
        setSelectedBrandId(effectiveBrandId);
      }

      const memRes = await apiRequest<{
        categories: CategoryMeta[];
        namespaces: NamespaceMeta[];
        facts: BrandKnowledgeFact[];
        memoryItems: MemoryItem[];
      }>(
        `/api/workspaces/${activeWorkspace.id}/ai/memory${effectiveBrandId ? `?brandId=${encodeURIComponent(effectiveBrandId)}` : ''}`,
      );
      setCategories(memRes.categories);
      setNamespaces(memRes.namespaces);
      setFacts(memRes.facts);
      setMemoryItems(memRes.memoryItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Brand Memory.');
    }
  }, [activeWorkspace, selectedBrandId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleAddFact(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !selectedBrandId || !canPropose) return;
    setSaving(true);
    setFeedback(null);
    setError(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/ai/memory`, {
        method: 'POST',
        body: JSON.stringify({
          kind: 'brand_fact',
          brandId: selectedBrandId,
          category: factCategory,
          title: factTitle.trim(),
          statement: factStatement.trim(),
          verificationStatus: factVerification,
          sourceUrl: factUrl.trim() || undefined,
        }),
      });
      setFeedback('Recorded structured brand knowledge fact.');
      setFactTitle('');
      setFactStatement('');
      setFactUrl('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save brand fact.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMemoryCandidate(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !canPropose) return;
    setSaving(true);
    setFeedback(null);
    setError(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/ai/memory`, {
        method: 'POST',
        body: JSON.stringify({
          brandId: selectedBrandId || undefined,
          namespace: memNamespace,
          title: memTitle.trim(),
          content: memContent.trim(),
          tags: ['manual_candidate'],
          verificationStatus: 'INFERRED',
          provenanceRef: 'dashboard:brand_memory',
        }),
      });
      setFeedback('Proposed memory candidate awaiting owner/manager approval.');
      setMemTitle('');
      setMemContent('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to propose memory item.');
    } finally {
      setSaving(false);
    }
  }

  async function handleMemoryDecision(
    memoryId: string,
    action: 'approve' | 'reject',
  ) {
    if (!activeWorkspace || !canApprove) return;
    setFeedback(null);
    setError(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/ai/memory/${memoryId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action,
          ...(action === 'reject'
            ? { reason: 'Rejected during brand memory review.' }
            : {}),
        }),
      });
      setFeedback(
        action === 'approve'
          ? 'Memory approved and enabled for bounded agent retrieval.'
          : 'Memory rejected and stored in rejection_memory guardrails.',
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update memory status.');
    }
  }

  const visibleFacts =
    filterCategory === 'all'
      ? facts
      : facts.filter((f) => f.category === filterCategory);

  const visibleMemory =
    filterNamespace === 'all'
      ? memoryItems
      : memoryItems.filter((m) => m.namespace === filterNamespace);

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
            Phase 3 · Persistent Brand Grounding
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900">
            Brand Knowledge & Persistent Memory
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            20 structured brand knowledge categories and 7 persistent memory namespaces with provenance tracking and approval gates.
          </p>
        </div>

        <div>
          <label
            htmlFor="mem-brand"
            className="block font-mono text-[10px] uppercase tracking-wider text-slate-500"
          >
            Brand Scope
          </label>
          <select
            id="mem-brand"
            value={selectedBrandId}
            onChange={(e) => setSelectedBrandId(e.target.value)}
            className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900"
          >
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

      {/* Tab Switch */}
      <div className="flex gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('knowledge')}
          className={`rounded-lg px-4 py-2 text-xs font-semibold ${
            activeTab === 'knowledge'
              ? 'bg-slate-900 text-white'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          20-Category Brand Knowledge ({facts.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('memory')}
          className={`rounded-lg px-4 py-2 text-xs font-semibold ${
            activeTab === 'memory'
              ? 'bg-slate-900 text-white'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          7-Namespace Memory ({memoryItems.length})
        </button>
      </div>

      {activeTab === 'knowledge' ? (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-7">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Structured Facts ({visibleFacts.length})
              </h2>
              <select
                aria-label="Filter knowledge category"
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="all">All 20 Categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            {visibleFacts.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-xs text-slate-500">
                No knowledge facts in this filter yet.
              </div>
            ) : (
              visibleFacts.map((fact) => (
                <div
                  key={fact.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 text-xs space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold text-blue-700">
                      {fact.category}
                    </span>
                    <span className="font-mono text-[11px] text-slate-600">
                      {fact.verificationStatus} · {fact.approvalStatus}
                    </span>
                  </div>
                  <p className="font-semibold text-slate-900">{fact.title}</p>
                  <p className="leading-relaxed text-slate-700">{fact.statement}</p>
                  <p className="font-mono text-[10px] text-slate-400">
                    Provenance: {fact.provenanceType}
                    {fact.sourceUrl ? ` · Source: ${fact.sourceUrl}` : ''}
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="lg:col-span-5">
            <form
              onSubmit={handleAddFact}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Plus className="h-4 w-4 text-blue-700" />
                Add Verified Brand Knowledge Fact
              </h3>

              <div>
                <label htmlFor="fact-cat" className="block text-xs font-medium text-slate-700">
                  Category (1–20)
                </label>
                <select
                  id="fact-cat"
                  value={factCategory}
                  onChange={(e) => setFactCategory(e.target.value as BrandFactCategory)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="fact-title" className="block text-xs font-medium text-slate-700">
                  Fact Title
                </label>
                <input
                  id="fact-title"
                  type="text"
                  required
                  value={factTitle}
                  onChange={(e) => setFactTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label htmlFor="fact-stmt" className="block text-xs font-medium text-slate-700">
                  Grounded Statement
                </label>
                <textarea
                  id="fact-stmt"
                  rows={3}
                  required
                  value={factStatement}
                  onChange={(e) => setFactStatement(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="fact-ver" className="block text-xs font-medium text-slate-700">
                    Verification Status
                  </label>
                  <select
                    id="fact-ver"
                    value={factVerification}
                    onChange={(e) => setFactVerification(e.target.value as VerificationStatus)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  >
                    <option value="VERIFIED">VERIFIED (Human Confirmed)</option>
                    <option value="SUPPORTED">SUPPORTED</option>
                    <option value="INFERRED">INFERRED</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="fact-url" className="block text-xs font-medium text-slate-700">
                    Source URL (Optional)
                  </label>
                  <input
                    id="fact-url"
                    type="url"
                    value={factUrl}
                    onChange={(e) => setFactUrl(e.target.value)}
                    placeholder="https://..."
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={saving || !canPropose || !selectedBrandId}
                className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Brand Fact'}
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-7">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Database className="h-4 w-4 text-slate-700" />
                Memory Entries ({visibleMemory.length})
              </h2>
              <select
                aria-label="Filter memory namespace"
                value={filterNamespace}
                onChange={(e) => setFilterNamespace(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="all">All 7 Namespaces</option>
                {namespaces.map((ns) => (
                  <option key={ns.id} value={ns.id}>
                    {ns.label}
                  </option>
                ))}
              </select>
            </div>

            {visibleMemory.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-xs text-slate-500">
                No memory items recorded in this namespace yet. Agent runs propose candidate memories for human review here.
              </div>
            ) : (
              visibleMemory.map((mem) => (
                <div
                  key={mem.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold text-slate-900">
                      {mem.namespace}
                    </span>
                    <span className="font-mono text-[11px] text-slate-600">
                      Status: {mem.status} · {mem.verificationStatus}
                    </span>
                  </div>
                  <p className="font-semibold text-slate-900">{mem.title}</p>
                  <p className="text-slate-700">{mem.content}</p>
                  <p className="font-mono text-[10px] text-slate-400">
                    Provenance: {mem.provenanceRef} · ~{mem.tokensEstimate} tokens
                  </p>

                  {mem.status === 'candidate' && canApprove && (
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void handleMemoryDecision(mem.id, 'approve')}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                      >
                        <Check className="h-3 w-3" />
                        Approve Memory
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMemoryDecision(mem.id, 'reject')}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-800 hover:bg-rose-100"
                      >
                        <X className="h-3 w-3" />
                        Reject to Guardrail
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="lg:col-span-5">
            <form
              onSubmit={handleAddMemoryCandidate}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldAlert className="h-4 w-4 text-slate-700" />
                Propose Candidate Memory
              </h3>

              <div>
                <label htmlFor="mem-ns" className="block text-xs font-medium text-slate-700">
                  Namespace (1–7)
                </label>
                <select
                  id="mem-ns"
                  value={memNamespace}
                  onChange={(e) => setMemNamespace(e.target.value as MemoryNamespace)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  {namespaces.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="mem-title" className="block text-xs font-medium text-slate-700">
                  Memory Title
                </label>
                <input
                  id="mem-title"
                  type="text"
                  required
                  value={memTitle}
                  onChange={(e) => setMemTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label htmlFor="mem-body" className="block text-xs font-medium text-slate-700">
                  Content
                </label>
                <textarea
                  id="mem-body"
                  rows={3}
                  required
                  value={memContent}
                  onChange={(e) => setMemContent(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={saving || !canPropose}
                className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? 'Submitting…' : 'Submit Candidate for Approval'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
