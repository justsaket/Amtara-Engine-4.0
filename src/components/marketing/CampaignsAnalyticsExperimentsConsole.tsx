'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, FlaskConical, RefreshCw, Target } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type {
  AdCampaignRecord,
  AnalyticsSnapshotRecord,
  BrandProfile,
  CampaignBudgetPolicy,
  PerformanceExperimentRecord,
  SocialPlatformId,
} from '@/types/domain';
import type { AggregatedAnalyticsSummary } from '@/lib/marketing/analytics-optimizer';

export function CampaignsAnalyticsExperimentsConsole({
  view,
}: {
  view: 'campaigns' | 'analytics' | 'experiments';
}) {
  const { activeWorkspace } = useWorkspace();
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [campaigns, setCampaigns] = useState<AdCampaignRecord[]>([]);
  const [budgetPolicies, setBudgetPolicies] = useState<CampaignBudgetPolicy[]>([]);
  const [snapshots, setSnapshots] = useState<AnalyticsSnapshotRecord[]>([]);
  const [summary, setSummary] = useState<AggregatedAnalyticsSummary | null>(null);
  const [experiments, setExperiments] = useState<PerformanceExperimentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [policyForm, setPolicyForm] = useState({
    brandId: '',
    currency: 'INR' as 'INR' | 'USD',
    enabled: false,
    maxDailySpend: '2500',
    maxMonthlySpend: '50000',
    ownerExplicitAuthorization: false,
  });

  const [campaignForm, setCampaignForm] = useState({
    brandId: '',
    name: '',
    objective: 'leads' as AdCampaignRecord['objective'],
    dailyBudget: '1500',
    totalBudget: '15000',
    currency: 'INR' as 'INR' | 'USD',
    audienceSummary: '',
    requestLaunchApproval: false,
  });

  const [snapshotForm, setSnapshotForm] = useState({
    brandId: '',
    platform: 'instagram' as AnalyticsSnapshotRecord['platform'],
    sourceApi: 'instagram_graph_insights_v21',
    attributionNote: 'Direct platform post insights',
    currency: 'INR' as 'INR' | 'USD',
    impressions: '',
    engagements: '',
    clicks: '',
    leadsAttributed: '',
    spendAmount: '',
  });

  const [expForm, setExpForm] = useState({
    brandId: '',
    title: '',
    hypothesis: '',
    platform: 'linkedin' as SocialPlatformId,
    primaryMetric: 'engagements' as PerformanceExperimentRecord['primaryMetric'],
    minSampleSize: '100',
  });

  const loadAll = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const brandsRes = await apiRequest<{ brands: BrandProfile[] }>(
        `/api/workspaces/${activeWorkspace.id}/brands`,
      );
      setBrands(brandsRes.brands);
      const firstBrand = brandsRes.brands[0]?.id || '';
      setPolicyForm((f) => ({ ...f, brandId: f.brandId || firstBrand }));
      setCampaignForm((f) => ({ ...f, brandId: f.brandId || firstBrand }));
      setSnapshotForm((f) => ({ ...f, brandId: f.brandId || firstBrand }));
      setExpForm((f) => ({ ...f, brandId: f.brandId || firstBrand }));

      if (view === 'campaigns') {
        const res = await apiRequest<{
          campaigns: AdCampaignRecord[];
          budgetPolicies: CampaignBudgetPolicy[];
        }>(`/api/workspaces/${activeWorkspace.id}/marketing/campaigns`);
        setCampaigns(res.campaigns);
        setBudgetPolicies(res.budgetPolicies);
      } else {
        const res = await apiRequest<{
          snapshots: AnalyticsSnapshotRecord[];
          summary: AggregatedAnalyticsSummary;
          experiments: PerformanceExperimentRecord[];
        }>(`/api/workspaces/${activeWorkspace.id}/marketing/analytics`);
        setSnapshots(res.snapshots);
        setSummary(res.summary);
        setExperiments(res.experiments);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load performance data.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, view]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleSaveBudgetPolicy(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/marketing/campaigns`, {
        method: 'PUT',
        body: JSON.stringify({
          brandId: policyForm.brandId,
          currency: policyForm.currency,
          enabled: policyForm.enabled,
          maxDailySpend: policyForm.maxDailySpend ? Number(policyForm.maxDailySpend) : null,
          maxMonthlySpend: policyForm.maxMonthlySpend ? Number(policyForm.maxMonthlySpend) : null,
          ownerExplicitAuthorization: policyForm.ownerExplicitAuthorization,
        }),
      });
      setNotice('Brand paid-ads budget policy saved.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save budget policy.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateCampaign(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{
        dryRun: { valid: boolean; errors: string[] };
      }>(`/api/workspaces/${activeWorkspace.id}/marketing/campaigns`, {
        method: 'POST',
        body: JSON.stringify({
          brandId: campaignForm.brandId,
          name: campaignForm.name,
          objective: campaignForm.objective,
          dailyBudget: campaignForm.dailyBudget ? Number(campaignForm.dailyBudget) : null,
          totalBudget: campaignForm.totalBudget ? Number(campaignForm.totalBudget) : null,
          currency: campaignForm.currency,
          audienceSummary: campaignForm.audienceSummary,
          requestLaunchApproval: campaignForm.requestLaunchApproval,
        }),
      });
      setNotice(
        res.dryRun.valid
          ? 'Draft campaign created and passed dry-run budget cap validation.'
          : `Draft campaign saved (blocked from launch): ${res.dryRun.errors.join(' ')}`,
      );
      setCampaignForm((f) => ({ ...f, name: '', audienceSummary: '' }));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create campaign draft.');
    } finally {
      setSaving(false);
    }
  }

  async function handleIngestSnapshot(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      const parseOptionalNum = (val: string) => (val.trim() === '' ? null : Number(val));
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/marketing/analytics`, {
        method: 'POST',
        body: JSON.stringify({
          kind: 'snapshot',
          payload: {
            brandId: snapshotForm.brandId,
            platform: snapshotForm.platform,
            periodStart: weekAgo.toISOString(),
            periodEnd: now.toISOString(),
            timezone: activeWorkspace.timezone || 'Asia/Kolkata',
            sourceApi: snapshotForm.sourceApi,
            attributionNote: snapshotForm.attributionNote,
            currency: snapshotForm.spendAmount.trim() ? snapshotForm.currency : undefined,
            engagementDefinition: 'likes + comments + shares + saves',
            metrics: {
              impressions: parseOptionalNum(snapshotForm.impressions),
              reach: null,
              engagements: parseOptionalNum(snapshotForm.engagements),
              clicks: parseOptionalNum(snapshotForm.clicks),
              videoViews: null,
              followersDelta: null,
              leadsAttributed: parseOptionalNum(snapshotForm.leadsAttributed),
              spendAmount: parseOptionalNum(snapshotForm.spendAmount),
              revenueAmount: null,
            },
          },
        }),
      });
      setNotice('Verified analytics snapshot recorded (unprovided metrics preserved as null).');
      setSnapshotForm((f) => ({ ...f, impressions: '', engagements: '', clicks: '', leadsAttributed: '', spendAmount: '' }));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to ingest analytics snapshot.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateExperiment(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/marketing/analytics`, {
        method: 'POST',
        body: JSON.stringify({
          kind: 'experiment_create',
          payload: {
            ...expForm,
            minSampleSize: Number(expForm.minSampleSize),
          },
        }),
      });
      setNotice('Experiment created. Collect verified snapshots then evaluate to propose a Phase 3 candidate brand memory.');
      setExpForm((f) => ({ ...f, title: '', hypothesis: '' }));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create experiment.');
    } finally {
      setSaving(false);
    }
  }

  async function handleEvaluateExperiment(experimentId: string) {
    if (!activeWorkspace) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{
        experiment: PerformanceExperimentRecord;
        candidateMemoryId?: string;
      }>(`/api/workspaces/${activeWorkspace.id}/marketing/analytics`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'experiment_evaluate', experimentId }),
      });
      setNotice(
        res.candidateMemoryId
          ? `Experiment evaluated (${res.experiment.status}). Proposed Phase 3 Brand Memory candidate ${res.candidateMemoryId} for human review.`
          : `Experiment evaluated (${res.experiment.status}): ${res.experiment.confidenceNote}`,
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to evaluate experiment.');
    }
  }

  if (!activeWorkspace) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Select a workspace to continue.
      </div>
    );
  }

  const brandMap = new Map(brands.map((b) => [b.id, b.name]));

  if (view === 'campaigns') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
              Phase 4 · Paid Media Budget Controls (Meta Marketing API)
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
              Paid Campaigns &amp; Budget Caps
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Paid ad spend is disabled by default per brand. Every live campaign requires positive numeric caps, owner authorization, dry-run validation, and Central Action Gateway approval.
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

        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</div>}

        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={handleSaveBudgetPolicy} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Brand Paid Budget Cap Policy</h2>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={policyForm.brandId}
                onChange={(e) => setPolicyForm((f) => ({ ...f, brandId: e.target.value }))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <select
                value={policyForm.currency}
                onChange={(e) => setPolicyForm((f) => ({ ...f, currency: e.target.value as 'INR' | 'USD' }))}
                className="rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Max Daily Cap</label>
                <input
                  type="number"
                  min="1"
                  value={policyForm.maxDailySpend}
                  onChange={(e) => setPolicyForm((f) => ({ ...f, maxDailySpend: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Max Monthly Cap</label>
                <input
                  type="number"
                  min="1"
                  value={policyForm.maxMonthlySpend}
                  onChange={(e) => setPolicyForm((f) => ({ ...f, maxMonthlySpend: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-slate-700">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={policyForm.enabled}
                  onChange={(e) => setPolicyForm((f) => ({ ...f, enabled: e.target.checked }))}
                />
                Enable Paid Ads for Brand
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={policyForm.ownerExplicitAuthorization}
                  onChange={(e) =>
                    setPolicyForm((f) => ({ ...f, ownerExplicitAuthorization: e.target.checked }))
                  }
                />
                Owner Explicit Authorization
              </label>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              Save Budget Cap Policy
            </button>
          </form>

          <form onSubmit={handleCreateCampaign} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-900">Create Draft Campaign &amp; Dry-Run</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={campaignForm.brandId}
                onChange={(e) => setCampaignForm((f) => ({ ...f, brandId: e.target.value }))}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <select
                value={campaignForm.objective}
                onChange={(e) =>
                  setCampaignForm((f) => ({ ...f, objective: e.target.value as AdCampaignRecord['objective'] }))
                }
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="leads">Leads</option>
                <option value="traffic">Traffic</option>
                <option value="awareness">Awareness</option>
                <option value="engagement">Engagement</option>
                <option value="sales">Sales</option>
              </select>
            </div>
            <input
              type="text"
              required
              value={campaignForm.name}
              onChange={(e) => setCampaignForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Campaign name"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                value={campaignForm.dailyBudget}
                onChange={(e) => setCampaignForm((f) => ({ ...f, dailyBudget: e.target.value }))}
                placeholder="Daily"
                className="rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs"
              />
              <input
                type="number"
                value={campaignForm.totalBudget}
                onChange={(e) => setCampaignForm((f) => ({ ...f, totalBudget: e.target.value }))}
                placeholder="Total"
                className="rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs"
              />
              <select
                value={campaignForm.currency}
                onChange={(e) => setCampaignForm((f) => ({ ...f, currency: e.target.value as 'INR' | 'USD' }))}
                className="rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs"
              >
                <option value="INR">INR</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <textarea
              required
              rows={2}
              value={campaignForm.audienceSummary}
              onChange={(e) => setCampaignForm((f) => ({ ...f, audienceSummary: e.target.value }))}
              placeholder="Target geography, industry, and audience segment..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              Validate Dry-Run &amp; Save Draft
            </button>
          </form>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Campaign Plans ({campaigns.length}) · Active Budget Policies ({budgetPolicies.length})
          </h2>
          <div className="mt-3 divide-y divide-slate-100">
            {campaigns.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{c.name}</p>
                  <p className="font-mono text-[11px] text-slate-500">
                    {brandMap.get(c.brandId) || c.brandId} · {c.objective} · {c.status} · Daily:{' '}
                    {c.dailyBudget ?? '—'} {c.currency} · Total: {c.totalBudget ?? '—'} {c.currency}
                  </p>
                </div>
                <span className="font-mono text-xs text-slate-600">
                  Dry-Run: {c.status === 'dry_run_validated' || c.status === 'pending_owner_approval' || c.status === 'active' ? 'PASSED' : 'DRAFT / BLOCKED'}
                </span>
              </div>
            ))}
            {campaigns.length === 0 && (
              <p className="py-6 text-sm text-slate-500">No campaign drafts created yet.</p>
            )}
          </div>
        </section>
      </div>
    );
  }

  if (view === 'analytics') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
              Phase 4 · Null-Preserving Verified Analytics
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
              Cross-Platform Analytics Console
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Uncollected metrics remain null (never fabricated as zero), spend totals stay separated by currency, and ROAS is omitted unless verified revenue exists.
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

        {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</div>}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="font-mono text-[11px] uppercase text-slate-500">Impressions</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {summary?.impressions === null || summary?.impressions === undefined
                ? 'Not collected'
                : summary.impressions.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="font-mono text-[11px] uppercase text-slate-500">Engagements</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {summary?.engagements === null || summary?.engagements === undefined
                ? 'Not collected'
                : summary.engagements.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="font-mono text-[11px] uppercase text-slate-500">Attributed Leads</p>
            <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-slate-900">
              {summary?.leadsAttributed === null || summary?.leadsAttributed === undefined
                ? 'Not collected'
                : summary.leadsAttributed.toLocaleString()}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="font-mono text-[11px] uppercase text-slate-500">ROAS</p>
            <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-slate-900">
              {!summary || Object.values(summary.roasByCurrency).every((v) => v === null)
                ? 'Omitted (no verified revenue)'
                : Object.entries(summary.roasByCurrency)
                    .filter(([, v]) => v !== null)
                    .map(([cur, v]) => `${cur} ${(v as number).toFixed(2)}x`)
                    .join(' · ')}
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={handleIngestSnapshot} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-900">Record Verified Snapshot</h2>
            </div>
            <select
              value={snapshotForm.brandId}
              onChange={(e) => setSnapshotForm((f) => ({ ...f, brandId: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <select
              value={snapshotForm.platform}
              onChange={(e) =>
                setSnapshotForm((f) => ({
                  ...f,
                  platform: e.target.value as AnalyticsSnapshotRecord['platform'],
                }))
              }
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="linkedin">LinkedIn</option>
              <option value="youtube">YouTube</option>
              <option value="tiktok">TikTok</option>
              <option value="google_business_profile">GBP</option>
              <option value="meta_ads">Meta Ads</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min="0"
                value={snapshotForm.impressions}
                onChange={(e) => setSnapshotForm((f) => ({ ...f, impressions: e.target.value }))}
                placeholder="Impressions (blank=null)"
                className="rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs"
              />
              <input
                type="number"
                min="0"
                value={snapshotForm.engagements}
                onChange={(e) => setSnapshotForm((f) => ({ ...f, engagements: e.target.value }))}
                placeholder="Engagements"
                className="rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs"
              />
              <input
                type="number"
                min="0"
                value={snapshotForm.clicks}
                onChange={(e) => setSnapshotForm((f) => ({ ...f, clicks: e.target.value }))}
                placeholder="Clicks"
                className="rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs"
              />
              <input
                type="number"
                min="0"
                value={snapshotForm.leadsAttributed}
                onChange={(e) => setSnapshotForm((f) => ({ ...f, leadsAttributed: e.target.value }))}
                placeholder="Leads"
                className="rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              Save Verified Snapshot
            </button>
          </form>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white lg:col-span-2">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Brand &amp; Platform</th>
                  <th className="px-4 py-3 text-right">Impressions</th>
                  <th className="px-4 py-3 text-right">Engagements</th>
                  <th className="px-4 py-3 text-right">Clicks</th>
                  <th className="px-4 py-3 text-right">Leads</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {snapshots.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">
                        {brandMap.get(s.brandId) || s.brandId} · {s.platform}
                      </p>
                      <p className="font-mono text-[11px] text-slate-500">{s.sourceApi}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {s.metrics.impressions === null ? '—' : s.metrics.impressions.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {s.metrics.engagements === null ? '—' : s.metrics.engagements.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {s.metrics.clicks === null ? '—' : s.metrics.clicks.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {s.metrics.leadsAttributed === null ? '—' : s.metrics.leadsAttributed.toLocaleString()}
                    </td>
                  </tr>
                ))}
                {snapshots.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                      No analytics snapshots collected yet.
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
            Phase 4 · Optimization Loop → Phase 3 Brand Memory
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
            Marketing Experiments Engine
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Evaluates real collected snapshots against minimum sample thresholds and proposes candidate memories into Phase 3 Brand Memory for human review.
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

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={handleCreateExperiment} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">New Experiment</h2>
          </div>
          <select
            value={expForm.brandId}
            onChange={(e) => setExpForm((f) => ({ ...f, brandId: e.target.value }))}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <input
            type="text"
            required
            value={expForm.title}
            onChange={(e) => setExpForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Experiment title"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <textarea
            required
            rows={3}
            value={expForm.hypothesis}
            onChange={(e) => setExpForm((f) => ({ ...f, hypothesis: e.target.value }))}
            placeholder="Testable hypothesis..."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={expForm.platform}
              onChange={(e) => setExpForm((f) => ({ ...f, platform: e.target.value as SocialPlatformId }))}
              className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
            >
              <option value="linkedin">LinkedIn</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="youtube">YouTube</option>
            </select>
            <input
              type="number"
              min="10"
              value={expForm.minSampleSize}
              onChange={(e) => setExpForm((f) => ({ ...f, minSampleSize: e.target.value }))}
              placeholder="Min sample"
              className="rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            Create Experiment
          </button>
        </form>

        <div className="space-y-3 lg:col-span-2">
          {experiments.map((exp) => (
            <div key={exp.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{exp.title}</p>
                  <p className="font-mono text-[11px] text-slate-500">
                    {brandMap.get(exp.brandId) || exp.brandId} · {exp.platform} · Metric:{' '}
                    {exp.primaryMetric} · Min Sample: {exp.minSampleSize} · Status: {exp.status}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleEvaluateExperiment(exp.id)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                >
                  Evaluate Now
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-700">{exp.hypothesis}</p>
              {exp.confidenceNote && (
                <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                  {exp.confidenceNote}
                  {exp.proposedMemoryId && (
                    <span className="block font-mono text-[11px] text-emerald-700 mt-1">
                      Proposed Phase 3 Candidate Memory: {exp.proposedMemoryId}
                    </span>
                  )}
                </p>
              )}
            </div>
          ))}
          {experiments.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              No experiments configured yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
