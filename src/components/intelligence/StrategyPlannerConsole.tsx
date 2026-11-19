'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { Calendar, FileText, PenTool, Sparkles } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { hasPermission } from '@/lib/rbac';
import type {
  BrandProfile,
  ContentDraftRecord,
  StrategyPlanRecord,
} from '@/types/domain';

export function StrategyPlannerConsole() {
  const { activeWorkspace } = useWorkspace();
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [plans, setPlans] = useState<StrategyPlanRecord[]>([]);
  const [drafts, setDrafts] = useState<ContentDraftRecord[]>([]);

  // Strategy generator form
  const [horizonDays, setHorizonDays] = useState<7 | 14 | 30>(14);
  const [objective, setObjective] = useState('');
  const [channels, setChannels] = useState<string[]>(['linkedin', 'blog']);

  // Draft writer form
  const [draftChannel, setDraftChannel] = useState<ContentDraftRecord['channel']>('linkedin');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftTopic, setDraftTopic] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canWrite = hasPermission(activeWorkspace?.role, 'strategy:write');

  const loadData = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const [brandRes, strRes] = await Promise.all([
        apiRequest<{ brands: BrandProfile[] }>(
          `/api/workspaces/${activeWorkspace.id}/brands`,
        ),
        apiRequest<{ plans: StrategyPlanRecord[]; drafts: ContentDraftRecord[] }>(
          `/api/workspaces/${activeWorkspace.id}/ai/strategy${selectedBrandId ? `?brandId=${encodeURIComponent(selectedBrandId)}` : ''}`,
        ),
      ]);
      setBrands(brandRes.brands);
      if (!selectedBrandId && brandRes.brands[0]) {
        setSelectedBrandId(brandRes.brands[0].id);
      }
      setPlans(strRes.plans);
      setDrafts(strRes.drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Content Strategy workspace.');
    }
  }, [activeWorkspace, selectedBrandId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function toggleChannel(ch: string) {
    setChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch],
    );
  }

  async function handleGenerateStrategy(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !selectedBrandId || !objective.trim() || !canWrite) return;
    setSubmitting(true);
    setFeedback(null);
    setError(null);
    try {
      const res = await apiRequest<{
        plan: StrategyPlanRecord;
        run: { status: string };
      }>(`/api/workspaces/${activeWorkspace.id}/ai/strategy`, {
        method: 'POST',
        body: JSON.stringify({
          brandId: selectedBrandId,
          horizonDays,
          objective: objective.trim(),
          focusChannels: channels.length > 0 ? channels : ['linkedin'],
        }),
      });
      setFeedback(`Saved ${res.plan.title} (${res.run.status}).`);
      setObjective('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate strategy plan.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGenerateDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !selectedBrandId || !draftTitle.trim() || !draftTopic.trim() || !canWrite) return;
    setSubmitting(true);
    setFeedback(null);
    setError(null);
    try {
      const res = await apiRequest<{
        draft: ContentDraftRecord;
        run: { status: string };
      }>(`/api/workspaces/${activeWorkspace.id}/ai/strategy`, {
        method: 'POST',
        body: JSON.stringify({
          mode: 'content_draft',
          brandId: selectedBrandId,
          channel: draftChannel,
          title: draftTitle.trim(),
          topic: draftTopic.trim(),
        }),
      });
      setFeedback(`Saved Phase 3 draft "${res.draft.title}" (${res.draft.status}).`);
      setDraftTitle('');
      setDraftTopic('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create content draft.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
            Phase 3 · Agents 04, 05 & 06
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900">
            Content Strategy & Draft Studio
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Generate brand-grounded 7/14/30-day calendars and channel drafts. All items stop cleanly as Phase 3 drafts awaiting Phase 4 publishing approval.
          </p>
        </div>

        <div>
          <label
            htmlFor="str-brand"
            className="block font-mono text-[10px] uppercase tracking-wider text-slate-500"
          >
            Active Brand
          </label>
          <select
            id="str-brand"
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

      <div className="grid gap-6 lg:grid-cols-2">
        <form
          onSubmit={handleGenerateStrategy}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Calendar className="h-4 w-4 text-blue-700" />
            Generate Content Strategy Calendar
          </h2>

          <div>
            <label htmlFor="str-horizon" className="block text-xs font-medium text-slate-700">
              Planning Horizon
            </label>
            <select
              id="str-horizon"
              value={horizonDays}
              onChange={(e) => setHorizonDays(Number(e.target.value) as 7 | 14 | 30)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            >
              <option value={7}>7-Day Sprint Plan</option>
              <option value={14}>14-Day Multi-Channel Plan</option>
              <option value={30}>30-Day Editorial Roadmap</option>
            </select>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-700">Focus Channels</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {['linkedin', 'instagram', 'blog', 'email', 'short_video_script', 'ad_copy'].map(
                (ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => toggleChannel(ch)}
                    className={`rounded-md border px-2.5 py-1 font-mono text-[11px] ${
                      channels.includes(ch)
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700'
                    }`}
                  >
                    {ch}
                  </button>
                ),
              )}
            </div>
          </div>

          <div>
            <label htmlFor="str-obj" className="block text-xs font-medium text-slate-700">
              Campaign Objective
            </label>
            <textarea
              id="str-obj"
              rows={2}
              value={objective}
              disabled={submitting || !canWrite}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Example: Build technical authority among plant engineering buyers without unverified metrics."
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !objective.trim() || !selectedBrandId || !canWrite}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Generate Strategy Plan
          </button>
        </form>

        <form
          onSubmit={handleGenerateDraft}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <PenTool className="h-4 w-4 text-slate-700" />
            Create Single-Channel Draft Asset
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="drf-ch" className="block text-xs font-medium text-slate-700">
                Channel
              </label>
              <select
                id="drf-ch"
                value={draftChannel}
                onChange={(e) =>
                  setDraftChannel(e.target.value as ContentDraftRecord['channel'])
                }
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              >
                <option value="linkedin">LinkedIn Post</option>
                <option value="blog">SEO Blog Outline / Article</option>
                <option value="instagram">Instagram Carousel</option>
                <option value="short_video_script">Short Video Script</option>
                <option value="email">Newsletter / Email</option>
                <option value="ad_copy">Ad Copy Brief</option>
              </select>
            </div>
            <div>
              <label htmlFor="drf-title" className="block text-xs font-medium text-slate-700">
                Draft Title
              </label>
              <input
                id="drf-title"
                type="text"
                value={draftTitle}
                disabled={submitting || !canWrite}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Example: Precision Welding Reliability Note"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
          </div>

          <div>
            <label htmlFor="drf-topic" className="block text-xs font-medium text-slate-700">
              Topic & Key Angle
            </label>
            <textarea
              id="drf-topic"
              rows={2}
              value={draftTopic}
              disabled={submitting || !canWrite}
              onChange={(e) => setDraftTopic(e.target.value)}
              placeholder="Outline key buyer challenge, brand pillar, and call-to-action..."
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
            />
          </div>

          <button
            type="submit"
            disabled={
              submitting || !draftTitle.trim() || !draftTopic.trim() || !selectedBrandId || !canWrite
            }
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5" />
            Save Content Draft
          </button>
        </form>
      </div>

      {/* Strategy Plans & Drafts List */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Saved Strategy Plans ({plans.length})
          </h2>
          {plans.length === 0 ? (
            <p className="text-xs text-slate-500">No strategy plans created yet.</p>
          ) : (
            <div className="space-y-3">
              {plans.map((p) => {
                let parsedMd = '';
                try {
                  parsedMd = (JSON.parse(p.itemsJson) as { markdown?: string }).markdown || '';
                } catch {
                  parsedMd = '';
                }
                return (
                  <div
                    key={p.id}
                    className="rounded-lg border border-slate-200 p-4 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{p.title}</span>
                      <span className="font-mono text-[10px] text-slate-500">
                        {p.horizonDays}d · {p.status}
                      </span>
                    </div>
                    <p className="text-slate-600">{p.objective}</p>
                    {parsedMd && (
                      <div className="prose prose-xs max-w-none border-t border-slate-100 pt-2 text-slate-700">
                        <Markdown>{parsedMd.slice(0, 900)}</Markdown>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Phase 3 Content Drafts ({drafts.length})
          </h2>
          {drafts.length === 0 ? (
            <p className="text-xs text-slate-500">No drafts saved yet.</p>
          ) : (
            <div className="space-y-3">
              {drafts.map((d) => (
                <div
                  key={d.id}
                  className="rounded-lg border border-slate-200 p-4 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{d.title}</span>
                    <span className="font-mono text-[10px] text-slate-500">
                      {d.channel} · QA {d.qaScore}/100 · {d.status}
                    </span>
                  </div>
                  <div className="prose prose-xs max-w-none text-slate-700">
                    <Markdown>{d.bodyMarkdown.slice(0, 900)}</Markdown>
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
