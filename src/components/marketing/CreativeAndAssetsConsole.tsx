'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Image as ImageIcon, Palette, RefreshCw } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type {
  BrandProfile,
  CanvaExportJobRecord,
  ContentFormat,
  CreativeBriefRecord,
  MediaAssetRecord,
  SocialPlatformId,
} from '@/types/domain';

interface CreativeResponse {
  briefs: CreativeBriefRecord[];
  exportJobs: CanvaExportJobRecord[];
  canvaCapabilityBoundary?: {
    restConnectApiSupported: readonly string[];
    outOfScopeForRestApi: readonly string[];
  };
  canvaStatus?: {
    oauthConfigured: boolean;
    readinessState: string;
  };
}

export function CreativeAndAssetsConsole({
  view,
}: {
  view: 'creative-studio' | 'assets';
}) {
  const { activeWorkspace } = useWorkspace();
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [creativeData, setCreativeData] = useState<CreativeResponse | null>(null);
  const [assets, setAssets] = useState<MediaAssetRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [briefForm, setBriefForm] = useState({
    brandId: '',
    title: '',
    format: 'single_image' as ContentFormat,
    targetPlatform: 'instagram' as SocialPlatformId,
    aspectRatio: '4:5' as CreativeBriefRecord['aspectRatio'],
    headlineText: '',
    supportingCopy: '',
    visualDirection: '',
    canvaTemplateId: '',
  });

  const [assetForm, setAssetForm] = useState({
    brandId: '',
    fileName: '',
    mimeType: 'image/png',
    sizeBytes: '1450000',
    width: '1080',
    height: '1350',
    durationSeconds: '',
    source: 'upload' as MediaAssetRecord['source'],
  });

  const loadAll = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const [brandsRes, creativeRes, assetsRes] = await Promise.all([
        apiRequest<{ brands: BrandProfile[] }>(`/api/workspaces/${activeWorkspace.id}/brands`),
        apiRequest<CreativeResponse>(`/api/workspaces/${activeWorkspace.id}/marketing/creative`),
        apiRequest<{ assets: MediaAssetRecord[] }>(`/api/workspaces/${activeWorkspace.id}/marketing/assets`),
      ]);
      setBrands(brandsRes.brands);
      setCreativeData(creativeRes);
      setAssets(assetsRes.assets);
      if (brandsRes.brands.length > 0) {
        setBriefForm((f) => ({ ...f, brandId: f.brandId || brandsRes.brands[0].id }));
        setAssetForm((f) => ({ ...f, brandId: f.brandId || brandsRes.brands[0].id }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load studio data.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleCreateBrief(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/marketing/creative`, {
        method: 'POST',
        body: JSON.stringify({
          ...briefForm,
          canvaTemplateId: briefForm.canvaTemplateId || undefined,
        }),
      });
      setNotice('Brand creative brief created with automatic brand identity rules & prohibited claims.');
      setBriefForm((f) => ({
        ...f,
        title: '',
        headlineText: '',
        supportingCopy: '',
        visualDirection: '',
      }));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create creative brief.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRegisterAsset(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ asset: MediaAssetRecord; deduplicated: boolean }>(
        `/api/workspaces/${activeWorkspace.id}/marketing/assets`,
        {
          method: 'POST',
          body: JSON.stringify({
            brandId: assetForm.brandId || undefined,
            fileName: assetForm.fileName,
            mimeType: assetForm.mimeType,
            sizeBytes: Number(assetForm.sizeBytes),
            width: assetForm.width ? Number(assetForm.width) : undefined,
            height: assetForm.height ? Number(assetForm.height) : undefined,
            durationSeconds: assetForm.durationSeconds ? Number(assetForm.durationSeconds) : undefined,
            source: assetForm.source,
          }),
        },
      );
      setNotice(
        res.deduplicated
          ? 'Exact SHA-256 duplicate detected — returned existing validated asset.'
          : `Media asset registered (${res.asset.processingState}, compatible with ${res.asset.compatiblePlatforms.length} platform(s)).`,
      );
      setAssetForm((f) => ({ ...f, fileName: '' }));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register media asset.');
    } finally {
      setSaving(false);
    }
  }

  if (!activeWorkspace) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Select a workspace to open {view === 'creative-studio' ? 'Creative Studio' : 'Media Assets'}.
      </div>
    );
  }

  const brandMap = new Map(brands.map((b) => [b.id, b.name]));

  if (view === 'creative-studio') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
              Phase 4 · Brand Creative Studio &amp; Canva Connect REST
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
              Creative Studio
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Generate brand-governed creative briefs and export designs from Canva Connect REST API into Firebase Storage.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
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

        {/* Canva Connect Capability Boundary */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                Canva Connect REST API Status
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-600">
              State: {creativeData?.canvaStatus?.readinessState || 'not_configured'} · OAuth:{' '}
              {creativeData?.canvaStatus?.oauthConfigured ? 'Configured' : 'Not configured'}
            </span>
          </div>
          <div className="mt-3 grid gap-4 text-xs sm:grid-cols-2">
            <div>
              <p className="font-mono uppercase text-slate-500">Supported via Connect REST API</p>
              <ul className="mt-1.5 space-y-1 text-slate-700">
                {(creativeData?.canvaCapabilityBoundary?.restConnectApiSupported || []).map((s, i) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-mono uppercase text-slate-500">Explicitly Out of Scope (Boundary)</p>
              <ul className="mt-1.5 space-y-1 text-slate-600">
                {(creativeData?.canvaCapabilityBoundary?.outOfScopeForRestApi || []).map((s, i) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <form
            onSubmit={handleCreateBrief}
            className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"
          >
            <h2 className="text-sm font-semibold text-slate-900">New Brand Creative Brief</h2>
            <div>
              <label className="block text-xs font-medium text-slate-700">Brand</label>
              <select
                value={briefForm.brandId}
                onChange={(e) => setBriefForm((f) => ({ ...f, brandId: e.target.value }))}
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Brief Title</label>
              <input
                type="text"
                required
                value={briefForm.title}
                onChange={(e) => setBriefForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g., MAGNARC Precision Arc Carousel"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Platform</label>
                <select
                  value={briefForm.targetPlatform}
                  onChange={(e) =>
                    setBriefForm((f) => ({ ...f, targetPlatform: e.target.value as SocialPlatformId }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
                >
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                  <option value="linkedin">LinkedIn</option>
                  <option value="youtube">YouTube</option>
                  <option value="tiktok">TikTok</option>
                  <option value="google_business_profile">GBP</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Aspect Ratio</label>
                <select
                  value={briefForm.aspectRatio}
                  onChange={(e) =>
                    setBriefForm((f) => ({
                      ...f,
                      aspectRatio: e.target.value as CreativeBriefRecord['aspectRatio'],
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm font-mono"
                >
                  <option value="4:5">4:5 (Feed)</option>
                  <option value="1:1">1:1 (Square)</option>
                  <option value="9:16">9:16 (Reel/Short)</option>
                  <option value="16:9">16:9 (YouTube)</option>
                  <option value="1.91:1">1.91:1 (Landscape)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Headline Text</label>
              <input
                type="text"
                required
                value={briefForm.headlineText}
                onChange={(e) => setBriefForm((f) => ({ ...f, headlineText: e.target.value }))}
                placeholder="Concise, verified on-image headline"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Visual Direction</label>
              <textarea
                required
                rows={3}
                value={briefForm.visualDirection}
                onChange={(e) => setBriefForm((f) => ({ ...f, visualDirection: e.target.value }))}
                placeholder="Composition, lighting, product focus, safe text margins..."
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Generating Brief...' : 'Create Brand Creative Brief'}
            </button>
          </form>

          <div className="space-y-4 lg:col-span-2">
            {(creativeData?.briefs || []).map((brief) => (
              <div key={brief.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{brief.title}</p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {brandMap.get(brief.brandId) || brief.brandId} · {brief.targetPlatform} ·{' '}
                      {brief.aspectRatio} · Color {brief.brandColorHex}
                    </p>
                  </div>
                  {brief.canvaEditUrl && (
                    <a
                      href={brief.canvaEditUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                    >
                      Open in Canva <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <p className="mt-2 text-sm font-medium text-slate-800">
                  Headline: {brief.headlineText}
                </p>
                <p className="mt-1 text-xs text-slate-600">{brief.visualDirection}</p>
                {brief.mandatoryRules.length > 0 && (
                  <p className="mt-2 font-mono text-[11px] text-slate-500">
                    Mandatory Rules: {brief.mandatoryRules.join(' · ')}
                  </p>
                )}
              </div>
            ))}
            {(!creativeData || creativeData.briefs.length === 0) && (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                No creative briefs yet. Create a brief to inject brand visual rules and prohibited claims automatically.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
            Phase 4 · Firebase Storage Media Pipeline
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
            Media Asset Library
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            MIME/size/resolution validation, SHA-256 deduplication, resumable session detection (&gt;10 MB), and per-platform compatibility.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
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
          onSubmit={handleRegisterAsset}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"
        >
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">Register &amp; Validate Asset</h2>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Brand</label>
            <select
              value={assetForm.brandId}
              onChange={(e) => setAssetForm((f) => ({ ...f, brandId: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Workspace Shared</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">File Name</label>
            <input
              type="text"
              required
              value={assetForm.fileName}
              onChange={(e) => setAssetForm((f) => ({ ...f, fileName: e.target.value }))}
              placeholder="e.g., greenweld-inverter-hero.png"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">MIME Type</label>
              <select
                value={assetForm.mimeType}
                onChange={(e) => setAssetForm((f) => ({ ...f, mimeType: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm font-mono"
              >
                <option value="image/png">image/png</option>
                <option value="image/jpeg">image/jpeg</option>
                <option value="image/webp">image/webp</option>
                <option value="video/mp4">video/mp4</option>
                <option value="video/quicktime">video/quicktime</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Size (bytes)</label>
              <input
                type="number"
                required
                min="1"
                value={assetForm.sizeBytes}
                onChange={(e) => setAssetForm((f) => ({ ...f, sizeBytes: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Width</label>
              <input
                type="number"
                value={assetForm.width}
                onChange={(e) => setAssetForm((f) => ({ ...f, width: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Height</label>
              <input
                type="number"
                value={assetForm.height}
                onChange={(e) => setAssetForm((f) => ({ ...f, height: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Duration (s)</label>
              <input
                type="number"
                value={assetForm.durationSeconds}
                onChange={(e) => setAssetForm((f) => ({ ...f, durationSeconds: e.target.value }))}
                placeholder="video"
                className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-mono"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Validating...' : 'Register & Validate Asset'}
          </button>
        </form>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white lg:col-span-2">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Specs</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Compatible Platforms</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assets.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{a.fileName}</p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {a.mimeType} · {a.source} · {a.sha256.slice(0, 10)}
                    </p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-slate-700">
                    {(a.sizeBytes / (1024 * 1024)).toFixed(2)} MB
                    {a.width && a.height ? ` · ${a.width}×${a.height}` : ''}
                    {a.aspectRatio ? ` (${a.aspectRatio})` : ''}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    <span className={a.processingState === 'rejected' ? 'text-rose-700' : 'text-emerald-700'}>
                      {a.processingState}
                    </span>
                    {a.validationErrors.length > 0 && (
                      <p className="mt-1 text-[11px] text-rose-700">{a.validationErrors[0]}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                    {a.compatiblePlatforms.length > 0 ? a.compatiblePlatforms.join(' · ') : 'None'}
                  </td>
                </tr>
              ))}
              {assets.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                    No media assets registered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
