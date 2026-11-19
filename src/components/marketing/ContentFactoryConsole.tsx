'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Plus, RefreshCw, ShieldAlert } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type {
  BrandProfile,
  ContentFormat,
  MarketingContentItem,
  MediaAssetRecord,
  SocialPlatformId,
} from '@/types/domain';

const PLATFORMS: { id: SocialPlatformId; label: string }[] = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook Pages' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'google_business_profile', label: 'Google Business Profile' },
];

const FORMATS: { id: ContentFormat; label: string }[] = [
  { id: 'text_post', label: 'Text Post' },
  { id: 'single_image', label: 'Single Image' },
  { id: 'carousel', label: 'Carousel' },
  { id: 'reel', label: 'Reel' },
  { id: 'short_video', label: 'Short Video' },
  { id: 'youtube_video', label: 'YouTube Video' },
  { id: 'gbp_update', label: 'GBP Local Update' },
  { id: 'blog_article', label: 'Blog / Article Draft' },
];

export function ContentFactoryConsole({
  mode,
  contentId,
}: {
  mode: 'list' | 'new' | 'detail';
  contentId?: string;
}) {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const [items, setItems] = useState<MarketingContentItem[]>([]);
  const [activeItem, setActiveItem] = useState<MarketingContentItem | null>(null);
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [assets, setAssets] = useState<MediaAssetRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filterBrandId, setFilterBrandId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Form state (for new and detail editing)
  const [form, setForm] = useState({
    brandId: '',
    title: '',
    format: 'text_post' as ContentFormat,
    objective: '',
    campaignTag: '',
    hook: '',
    body: '',
    cta: '',
    hashtagsText: '',
    targetPlatforms: ['linkedin'] as SocialPlatformId[],
    mediaAssetIds: [] as string[],
    changeNote: '',
  });

  const loadWorkspaceData = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const [brandsRes, assetsRes] = await Promise.all([
        apiRequest<{ brands: BrandProfile[] }>(`/api/workspaces/${activeWorkspace.id}/brands`),
        apiRequest<{ assets: MediaAssetRecord[] }>(`/api/workspaces/${activeWorkspace.id}/marketing/assets`),
      ]);
      setBrands(brandsRes.brands);
      setAssets(assetsRes.assets);

      if (mode === 'list') {
        const res = await apiRequest<{ items: MarketingContentItem[] }>(
          `/api/workspaces/${activeWorkspace.id}/marketing/content`,
        );
        setItems(res.items);
      } else if (mode === 'new') {
        if (brandsRes.brands.length > 0) {
          setForm((prev) => ({ ...prev, brandId: prev.brandId || brandsRes.brands[0].id }));
        }
      } else if (mode === 'detail' && contentId) {
        const res = await apiRequest<{ item: MarketingContentItem }>(
          `/api/workspaces/${activeWorkspace.id}/marketing/content/${contentId}`,
        );
        setActiveItem(res.item);
        setForm({
          brandId: res.item.brandId,
          title: res.item.title,
          format: res.item.format,
          objective: res.item.objective || '',
          campaignTag: res.item.campaignTag || '',
          hook: res.item.hook || '',
          body: res.item.body,
          cta: res.item.cta || '',
          hashtagsText: res.item.hashtags.join(', '),
          targetPlatforms: res.item.targetPlatforms,
          mediaAssetIds: res.item.mediaAssetIds,
          changeNote: '',
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load content factory.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, mode, contentId]);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  function togglePlatform(p: SocialPlatformId) {
    setForm((prev) => {
      const exists = prev.targetPlatforms.includes(p);
      if (exists && prev.targetPlatforms.length === 1) return prev;
      return {
        ...prev,
        targetPlatforms: exists
          ? prev.targetPlatforms.filter((x) => x !== p)
          : [...prev.targetPlatforms, p],
      };
    });
  }

  function toggleMedia(assetId: string) {
    setForm((prev) => ({
      ...prev,
      mediaAssetIds: prev.mediaAssetIds.includes(assetId)
        ? prev.mediaAssetIds.filter((x) => x !== assetId)
        : [...prev.mediaAssetIds, assetId],
    }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const hashtags = form.hashtagsText
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiRequest<{ item: MarketingContentItem }>(
        `/api/workspaces/${activeWorkspace.id}/marketing/content`,
        {
          method: 'POST',
          body: JSON.stringify({
            brandId: form.brandId,
            title: form.title,
            format: form.format,
            objective: form.objective || undefined,
            campaignTag: form.campaignTag || undefined,
            hook: form.hook || undefined,
            body: form.body,
            cta: form.cta || undefined,
            hashtags,
            targetPlatforms: form.targetPlatforms,
            mediaAssetIds: form.mediaAssetIds,
          }),
        },
      );
      router.push(`/dashboard/content/${res.item.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create content draft.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(submitForReview: boolean) {
    if (!activeWorkspace || !contentId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const hashtags = form.hashtagsText
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await apiRequest<{
        item: MarketingContentItem;
        approvalInvalidated: boolean;
      }>(`/api/workspaces/${activeWorkspace.id}/marketing/content/${contentId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: form.title,
          format: form.format,
          objective: form.objective || undefined,
          campaignTag: form.campaignTag || undefined,
          hook: form.hook || undefined,
          body: form.body,
          cta: form.cta || undefined,
          hashtags,
          targetPlatforms: form.targetPlatforms,
          mediaAssetIds: form.mediaAssetIds,
          changeNote: form.changeNote || (submitForReview ? 'Submitted for human approval' : 'Updated draft'),
          submitForReview,
        }),
      });
      setActiveItem(res.item);
      setForm((prev) => ({ ...prev, changeNote: '' }));
      setNotice(
        res.approvalInvalidated
          ? 'Saved new version. Previous approval was automatically invalidated because the payload hash changed.'
          : submitForReview
            ? 'Submitted to Approvals Queue with payload hash verification.'
            : 'Saved new immutable content version and re-ran Quality Gate.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save content changes.');
    } finally {
      setSaving(false);
    }
  }

  if (!activeWorkspace) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Select a workspace to open Content Factory.
      </div>
    );
  }

  if (mode === 'list') {
    const filtered = items.filter((item) => {
      if (filterBrandId && item.brandId !== filterBrandId) return false;
      if (filterStatus && item.status !== filterStatus) return false;
      return true;
    });
    const brandMap = new Map(brands.map((b) => [b.id, b.name]));

    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
              Phase 4 · Unified Content Management System
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
              Content Factory
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              5-stage content production with brand knowledge QA checks, platform variants, and SHA-256 payload versioning.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadWorkspaceData()}
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
              Create Content
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={filterBrandId}
            onChange={(e) => setFilterBrandId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
          >
            <option value="">All Brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
          >
            <option value="">All Lifecycle States</option>
            {['DRAFTED', 'NEEDS_REVISION', 'WAITING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'FAILED'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span className="font-mono text-xs text-slate-500">
            Showing {filtered.length} of {items.length} item(s)
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3">Title &amp; Brand</th>
                <th className="px-4 py-3">Format &amp; Platforms</th>
                <th className="px-4 py-3">Lifecycle</th>
                <th className="px-4 py-3">Quality Gate</th>
                <th className="px-4 py-3 text-right">Version</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-slate-900">{item.title}</p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {brandMap.get(item.brandId) || item.brandId} · {item.payloadHash.slice(0, 10)}
                    </p>
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="text-xs font-medium text-slate-800">{item.format}</p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {item.targetPlatforms.join(' · ')}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs text-slate-700">
                    {item.status}
                  </td>
                  <td className="px-4 py-3.5 font-mono text-xs">
                    {item.qualityCheck?.passed ? (
                      <span className="text-emerald-700">PASSED ({item.qualityCheck.score}/100)</span>
                    ) : (
                      <span className="text-amber-700">
                        {item.qualityCheck?.warnings.filter((w) => w.severity === 'error').length || 0} error(s)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-slate-600">
                    v{item.currentVersion}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Link
                      href={`/dashboard/content/${item.id}`}
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      Open Studio
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                    No content items yet. Create your first brand-verified draft to run Quality Gate checks and generate platform variants.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/dashboard/content"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Content Factory
          </Link>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-slate-900">
            {mode === 'new' ? 'Create Content Draft' : activeItem?.title || 'Content Studio'}
          </h1>
          {activeItem && (
            <p className="mt-1 font-mono text-xs text-slate-500">
              Status: {activeItem.status} · Version v{activeItem.currentVersion} · Hash:{' '}
              {activeItem.payloadHash.slice(0, 14)}
              {activeItem.approvedPayloadHash
                ? ` · Approved Hash: ${activeItem.approvedPayloadHash.slice(0, 14)}`
                : ''}
            </p>
          )}
        </div>

        {mode === 'detail' && activeItem && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleUpdate(false)}
              disabled={saving}
              className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Version & Run QA'}
            </button>
            <button
              type="button"
              onClick={() => void handleUpdate(true)}
              disabled={saving}
              className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Submit for Human Approval
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          {notice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <form
          onSubmit={mode === 'new' ? handleCreate : (e) => { e.preventDefault(); void handleUpdate(false); }}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Brand Profile</label>
              <select
                value={form.brandId}
                disabled={mode === 'detail'}
                onChange={(e) => setForm((f) => ({ ...f, brandId: e.target.value }))}
                required
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50"
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Content Format</label>
              <select
                value={form.format}
                onChange={(e) => setForm((f) => ({ ...f, format: e.target.value as ContentFormat }))}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {FORMATS.map((fmt) => (
                  <option key={fmt.id} value={fmt.id}>{fmt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Title</label>
            <input
              type="text"
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g., GreenWeld 3-Phase Inverter Duty Cycle Field Guide"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Hook</label>
              <input
                type="text"
                value={form.hook}
                onChange={(e) => setForm((f) => ({ ...f, hook: e.target.value }))}
                placeholder="Opening scroll-stopping line"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Campaign Tag</label>
              <input
                type="text"
                value={form.campaignTag}
                onChange={(e) => setForm((f) => ({ ...f, campaignTag: e.target.value }))}
                placeholder="e.g., q2_industrial_growth"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Main Body Copy</label>
            <textarea
              required
              rows={7}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder="Write factual, brand-verified copy without unverified guarantees..."
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Call To Action (CTA)</label>
              <input
                type="text"
                value={form.cta}
                onChange={(e) => setForm((f) => ({ ...f, cta: e.target.value }))}
                placeholder="e.g., Request dealer spec sheet via official website"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Hashtags (comma separated)</label>
              <input
                type="text"
                value={form.hashtagsText}
                onChange={(e) => setForm((f) => ({ ...f, hashtagsText: e.target.value }))}
                placeholder="#GreenWeld, #WeldingEngineering"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-700">Target Publishing Platforms</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PLATFORMS.map((p) => {
                const checked = form.targetPlatforms.includes(p.id);
                return (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
                      checked
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePlatform(p.id)}
                      className="sr-only"
                    />
                    {p.label}
                  </label>
                );
              })}
            </div>
          </div>

          {assets.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-700">
                Attached Media Assets ({form.mediaAssetIds.length} selected)
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {assets.slice(0, 8).map((a) => {
                  const selected = form.mediaAssetIds.includes(a.id);
                  return (
                    <label
                      key={a.id}
                      className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                        selected ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
                      }`}
                    >
                      <span className="truncate font-medium text-slate-800">{a.fileName}</span>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleMedia(a.id)}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {mode === 'detail' && (
            <div>
              <label className="block text-xs font-medium text-slate-700">Version Change Note</label>
              <input
                type="text"
                value={form.changeNote}
                onChange={(e) => setForm((f) => ({ ...f, changeNote: e.target.value }))}
                placeholder="Describe what changed in this revision"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          )}

          {mode === 'new' && (
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Running Quality Gate & Creating...' : 'Create Content & Generate Platform Variants'}
            </button>
          )}
        </form>

        {/* Right Side: Quality Gate, Variants & Version History */}
        <div className="space-y-4">
          {activeItem?.qualityCheck && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Quality Gate Report</h2>
                {activeItem.qualityCheck.passed ? (
                  <span className="inline-flex items-center gap-1 font-mono text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> PASSED
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-mono text-xs font-medium text-rose-700">
                    <ShieldAlert className="h-3.5 w-3.5" /> BLOCKED
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-[11px] text-slate-500">
                Score: {activeItem.qualityCheck.score}/100 · Brand facts checked:{' '}
                {activeItem.qualityCheck.brandFactsChecked} · Duplicate risk:{' '}
                {activeItem.qualityCheck.duplicateRisk}
              </p>

              {activeItem.qualityCheck.warnings.filter((w) => w.severity === 'error').length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                  <p className="font-mono text-[11px] font-semibold uppercase text-rose-700">
                    Blocking Issues
                  </p>
                  {activeItem.qualityCheck.warnings
                    .filter((w) => w.severity === 'error')
                    .map((issue, idx) => (
                      <p key={idx} className="text-xs text-rose-800">
                        • [{issue.code}] {issue.message}
                      </p>
                    ))}
                </div>
              )}

              {activeItem.qualityCheck.warnings.filter((w) => w.severity === 'warning').length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                  <p className="font-mono text-[11px] font-semibold uppercase text-amber-700">
                    Warnings
                  </p>
                  {activeItem.qualityCheck.warnings
                    .filter((w) => w.severity === 'warning')
                    .map((w, idx) => (
                      <p key={idx} className="text-xs text-amber-800">
                        • [{w.code}] {w.message}
                      </p>
                    ))}
                </div>
              )}
            </section>
          )}

          {activeItem && activeItem.variants.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Generated Platform Variants
              </h2>
              <div className="mt-3 space-y-3">
                {activeItem.variants.map((v) => (
                  <div key={v.platform} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between font-mono text-[11px] text-slate-600">
                      <span className="uppercase font-semibold text-slate-900">{v.platform}</span>
                      <span>
                        {v.caption.length} chars · {v.hashtags.length} tag(s)
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-xs text-slate-700 line-clamp-4">
                      {v.caption}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeItem && activeItem.versions.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">Immutable Version History</h2>
              <div className="mt-3 divide-y divide-slate-100">
                {[...activeItem.versions].reverse().map((ver) => (
                  <div key={ver.version} className="py-2.5 text-xs">
                    <div className="flex items-center justify-between font-mono text-slate-900">
                      <span>v{ver.version}</span>
                      <span className="text-slate-500">{ver.payloadHash.slice(0, 12)}</span>
                    </div>
                    <p className="mt-0.5 text-slate-600">{ver.changeNote}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
