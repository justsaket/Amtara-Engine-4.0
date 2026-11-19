'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Calendar as CalendarIcon, RefreshCw } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type {
  BrandProfile,
  ConnectedSocialAccount,
  MarketingContentItem,
  ScheduledPostRecord,
  SocialPlatformId,
} from '@/types/domain';

const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Asia/Dubai',
  'Asia/Singapore',
];

export function PublishingCalendarConsole() {
  const { activeWorkspace } = useWorkspace();
  const [posts, setPosts] = useState<ScheduledPostRecord[]>([]);
  const [contentItems, setContentItems] = useState<MarketingContentItem[]>([]);
  const [accounts, setAccounts] = useState<ConnectedSocialAccount[]>([]);
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [viewMode, setViewMode] = useState<'agenda' | 'day' | 'week' | 'month'>('agenda');
  const [displayTz, setDisplayTz] = useState('Asia/Kolkata');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [form, setForm] = useState({
    brandId: '',
    contentItemId: '',
    platform: 'linkedin' as SocialPlatformId,
    accountId: '',
    scheduledForLocal: new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 16),
    timezone: 'Asia/Kolkata',
  });

  const loadCalendar = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const [calRes, contentRes, pubRes, brandsRes] = await Promise.all([
        apiRequest<{ scheduledPosts: ScheduledPostRecord[] }>(
          `/api/workspaces/${activeWorkspace.id}/marketing/calendar`,
        ),
        apiRequest<{ items: MarketingContentItem[] }>(
          `/api/workspaces/${activeWorkspace.id}/marketing/content`,
        ),
        apiRequest<{ accounts: ConnectedSocialAccount[] }>(
          `/api/workspaces/${activeWorkspace.id}/marketing/publishing`,
        ),
        apiRequest<{ brands: BrandProfile[] }>(
          `/api/workspaces/${activeWorkspace.id}/brands`,
        ),
      ]);
      setPosts(calRes.scheduledPosts);
      setContentItems(contentRes.items);
      setAccounts(pubRes.accounts);
      setBrands(brandsRes.brands);
      setDisplayTz(activeWorkspace.timezone || 'Asia/Kolkata');
      setForm((prev) => ({
        ...prev,
        brandId: prev.brandId || brandsRes.brands[0]?.id || '',
        contentItemId: prev.contentItemId || contentRes.items[0]?.id || '',
        accountId: prev.accountId || pubRes.accounts[0]?.id || '',
        timezone: prev.timezone || activeWorkspace.timezone || 'Asia/Kolkata',
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load publishing calendar.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  async function handleSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const utcIso = new Date(form.scheduledForLocal).toISOString();
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/marketing/calendar`, {
        method: 'POST',
        body: JSON.stringify({
          brandId: form.brandId,
          contentItemId: form.contentItemId,
          platform: form.platform,
          accountId: form.accountId,
          scheduledForUtc: utcIso,
          timezone: form.timezone,
        }),
      });
      setNotice('Scheduled post persisted to durable Firestore queue (dispatched via Vercel Cron).');
      await loadCalendar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to schedule post.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePostAction(
    scheduledPostId: string,
    action: 'cancel' | 'duplicate' | 'reconcile_check',
  ) {
    if (!activeWorkspace) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ detail: string }>(
        `/api/workspaces/${activeWorkspace.id}/marketing/calendar`,
        {
          method: 'PATCH',
          body: JSON.stringify({ scheduledPostId, action }),
        },
      );
      setNotice(res.detail);
      await loadCalendar();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update scheduled post.');
    }
  }

  function formatInTz(iso: string): string {
    try {
      return new Intl.DateTimeFormat('en-IN', {
        timeZone: displayTz,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  if (!activeWorkspace) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Select a workspace to open the Publishing Calendar.
      </div>
    );
  }

  const nowMs = Date.now();
  const visiblePosts = posts.filter((p) => {
    const t = Date.parse(p.scheduledForUtc);
    if (viewMode === 'day') return Math.abs(t - nowMs) <= 24 * 3600 * 1000;
    if (viewMode === 'week') return Math.abs(t - nowMs) <= 7 * 24 * 3600 * 1000;
    if (viewMode === 'month') return Math.abs(t - nowMs) <= 31 * 24 * 3600 * 1000;
    return true;
  });

  const contentMap = new Map(contentItems.map((c) => [c.id, c.title]));
  const brandMap = new Map(brands.map((b) => [b.id, b.name]));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
            Phase 4 · Durable Firestore Scheduler &amp; Vercel Cron
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
            Unified Publishing Calendar
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Schedule approved content in UTC with IANA timezone rendering, idempotency locks, and safe cancellation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Display timezone"
            value={displayTz}
            onChange={(e) => setDisplayTz(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-xs text-slate-700"
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void loadCalendar()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
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

      {/* View Switcher */}
      <div className="flex flex-wrap items-center gap-2">
        {(['agenda', 'day', 'week', 'month'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setViewMode(m)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize ${
              viewMode === m
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {m} View
          </button>
        ))}
        <span className="ml-auto font-mono text-xs text-slate-500">
          {visiblePosts.length} scheduled job(s)
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <form
          onSubmit={handleSchedule}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"
        >
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">Schedule Release</h2>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Brand</label>
            <select
              value={form.brandId}
              onChange={(e) => setForm((f) => ({ ...f, brandId: e.target.value }))}
              required
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Content Item</label>
            <select
              value={form.contentItemId}
              onChange={(e) => setForm((f) => ({ ...f, contentItemId: e.target.value }))}
              required
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {contentItems.length === 0 ? (
                <option value="">Create content in Content Factory first</option>
              ) : (
                contentItems.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.status})
                  </option>
                ))
              )}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Platform</label>
              <select
                value={form.platform}
                onChange={(e) =>
                  setForm((f) => ({ ...f, platform: e.target.value as SocialPlatformId }))
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
              <label className="block text-xs font-medium text-slate-700">Account</label>
              <select
                value={form.accountId}
                onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                required
                className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
              >
                {accounts.length === 0 ? (
                  <option value="">No connected account</option>
                ) : (
                  accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName} ({a.provider})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Scheduled Date &amp; Time</label>
            <input
              type="datetime-local"
              required
              value={form.scheduledForLocal}
              onChange={(e) => setForm((f) => ({ ...f, scheduledForLocal: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={saving || accounts.length === 0 || contentItems.length === 0}
            className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Scheduling...' : 'Schedule via Action Gateway'}
          </button>
          {accounts.length === 0 && (
            <p className="text-[11px] text-slate-500">
              Connect at least one authorized social account under Publishing &amp; Accounts to schedule live releases.
            </p>
          )}
        </form>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white lg:col-span-2">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Scheduled ({displayTz})</th>
                <th className="px-4 py-3">Content &amp; Brand</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visiblePosts.map((job) => (
                <tr key={job.id}>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-slate-800">
                    {formatInTz(job.scheduledForUtc)}
                    <p className="text-[11px] text-slate-400">UTC: {job.scheduledForUtc.slice(0, 16)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">
                      {contentMap.get(job.contentItemId) || job.contentItemId}
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {brandMap.get(job.brandId) || job.brandId} · {job.platform} · attempts {job.attemptCount}/{job.maxAttempts}
                    </p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {job.status}
                    {job.lastErrorCode && (
                      <p className="text-[11px] text-rose-700">{job.lastErrorCode}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {job.status === 'publish_status_unknown' && (
                        <button
                          type="button"
                          onClick={() => void handlePostAction(job.id, 'reconcile_check')}
                          className="text-xs font-medium text-amber-700 hover:underline"
                        >
                          Reconcile
                        </button>
                      )}
                      {job.status !== 'cancelled' && job.status !== 'published' && (
                        <button
                          type="button"
                          onClick={() => void handlePostAction(job.id, 'cancel')}
                          className="text-xs font-medium text-rose-700 hover:underline"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {visiblePosts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                    No scheduled posts in this window.
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
