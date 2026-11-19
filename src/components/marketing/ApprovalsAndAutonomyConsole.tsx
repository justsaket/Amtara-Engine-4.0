'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckSquare, OctagonAlert, RefreshCw, ShieldAlert } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type {
  ApprovalRequestRecord,
  BrandAutonomyPolicy,
  BrandProfile,
  SocialPlatformId,
  WorkspaceEmergencyStopState,
} from '@/types/domain';

const ALL_PLATFORMS: SocialPlatformId[] = [
  'instagram',
  'facebook',
  'youtube',
  'linkedin',
  'tiktok',
  'google_business_profile',
];

export function ApprovalsAndAutonomyConsole({
  view,
}: {
  view: 'approvals' | 'autonomy';
}) {
  const { activeWorkspace } = useWorkspace();
  const [approvals, setApprovals] = useState<ApprovalRequestRecord[]>([]);
  const [policies, setPolicies] = useState<BrandAutonomyPolicy[]>([]);
  const [emergencyStop, setEmergencyStop] = useState<WorkspaceEmergencyStopState | null>(null);
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stopReason, setStopReason] = useState('');
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});

  const [policyForm, setPolicyForm] = useState({
    brandId: '',
    publishingMode: 'APPROVAL_REQUIRED' as BrandAutonomyPolicy['publishingMode'],
    allowedAutoPlatforms: [] as SocialPlatformId[],
    maxAutoPostsPerDay: 2,
    commentReplyPolicy: 'approval_required' as BrandAutonomyPolicy['commentReplyPolicy'],
    dmReplyPolicy: 'approval_required' as BrandAutonomyPolicy['dmReplyPolicy'],
    reviewReplyPolicy: 'approval_required' as BrandAutonomyPolicy['reviewReplyPolicy'],
    leadOutreachPolicy: 'internal_tasks_only' as BrandAutonomyPolicy['leadOutreachPolicy'],
    paidAdsPolicy: 'disabled' as BrandAutonomyPolicy['paidAdsPolicy'],
    requireQualityGatePass: true,
    blockSensitiveTopicsAuto: true,
    paused: false,
  });

  const loadData = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const [brandsRes, apprRes, autoRes] = await Promise.all([
        apiRequest<{ brands: BrandProfile[] }>(`/api/workspaces/${activeWorkspace.id}/brands`),
        apiRequest<{ approvals: ApprovalRequestRecord[] }>(
          `/api/workspaces/${activeWorkspace.id}/marketing/approvals`,
        ),
        apiRequest<{
          policies: BrandAutonomyPolicy[];
          emergencyStop: WorkspaceEmergencyStopState;
        }>(`/api/workspaces/${activeWorkspace.id}/marketing/autonomy`),
      ]);
      setBrands(brandsRes.brands);
      setApprovals(apprRes.approvals);
      setPolicies(autoRes.policies);
      setEmergencyStop(autoRes.emergencyStop);

      if (brandsRes.brands.length > 0) {
        const targetBrandId = policyForm.brandId || brandsRes.brands[0].id;
        const existing = autoRes.policies.find((p) => p.brandId === targetBrandId);
        if (existing) {
          setPolicyForm({
            brandId: existing.brandId,
            publishingMode: existing.publishingMode,
            allowedAutoPlatforms: existing.allowedAutoPlatforms,
            maxAutoPostsPerDay: existing.maxAutoPostsPerDay,
            commentReplyPolicy: existing.commentReplyPolicy,
            dmReplyPolicy: existing.dmReplyPolicy,
            reviewReplyPolicy: existing.reviewReplyPolicy,
            leadOutreachPolicy: existing.leadOutreachPolicy,
            paidAdsPolicy: existing.paidAdsPolicy,
            requireQualityGatePass: existing.requireQualityGatePass,
            blockSensitiveTopicsAuto: existing.blockSensitiveTopicsAuto,
            paused: existing.paused,
          });
        } else {
          setPolicyForm((prev) => ({ ...prev, brandId: targetBrandId }));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load governance controls.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, policyForm.brandId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleApprovalDecision(
    approvalId: string,
    action: 'approve' | 'reject' | 'hold' | 'cancel',
  ) {
    if (!activeWorkspace) return;
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/marketing/approvals`, {
        method: 'PATCH',
        body: JSON.stringify({
          approvalId,
          action,
          note: decisionNotes[approvalId] || undefined,
        }),
      });
      setNotice(`Approval ${approvalId} marked as ${action}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit approval decision.');
    }
  }

  async function handleSavePolicy(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !policyForm.brandId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/marketing/autonomy`, {
        method: 'PUT',
        body: JSON.stringify({
          ...policyForm,
          allowedAutoFormats: ['text_post', 'single_image', 'gbp_update'],
          pausedPlatforms: [],
        }),
      });
      setNotice('Brand autonomy policy updated and enforced immediately by the Central Action Gateway.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save autonomy policy.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleEmergencyStop(nextGlobalStopped: boolean) {
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/marketing/autonomy`, {
        method: 'POST',
        body: JSON.stringify({
          globalStopped: nextGlobalStopped,
          reason:
            stopReason.trim() ||
            (nextGlobalStopped
              ? 'Activated from Antara Autonomy Console'
              : 'Cleared after operator verification'),
        }),
      });
      setNotice(
        nextGlobalStopped
          ? 'GLOBAL EMERGENCY STOP ACTIVATED. All external writes & cron jobs are halted.'
          : 'Global Emergency Stop cleared.',
      );
      setStopReason('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update emergency stop state.');
    } finally {
      setSaving(false);
    }
  }

  if (!activeWorkspace) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
        Select a workspace to open {view === 'approvals' ? 'Approvals Queue' : 'Autonomy & Safety'}.
      </div>
    );
  }

  const brandMap = new Map(brands.map((b) => [b.id, b.name]));

  if (view === 'approvals') {
    const pendingCount = approvals.filter((a) => a.status === 'pending').length;

    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
              Phase 4 · Human-in-the-Loop Governance
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
              Approvals Queue
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Every approval is cryptographically bound to the exact content payload hash. Editing copy, media, or destination automatically invalidates prior approval.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-slate-600">{pendingCount} pending</span>
            <button
              type="button"
              onClick={() => void loadData()}
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

        <div className="space-y-4">
          {approvals.map((req) => (
            <div key={req.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <CheckSquare className="h-4 w-4 text-slate-700" />
                    <p className="text-sm font-semibold text-slate-900">{req.summary}</p>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-slate-500">
                    {brandMap.get(req.brandId) || req.brandId} · {req.actionType} · Risk: {req.riskLevel} ·
                    Requested by: {req.requestedByType} · Hash: {req.payloadHash.slice(0, 14)}
                  </p>
                </div>
                <span className="font-mono text-xs font-semibold uppercase text-slate-800">
                  {req.status}
                </span>
              </div>

              {req.status === 'pending' && (
                <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    value={decisionNotes[req.id] || ''}
                    onChange={(e) =>
                      setDecisionNotes((prev) => ({ ...prev, [req.id]: e.target.value }))
                    }
                    placeholder="Optional reviewer note..."
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleApprovalDecision(req.id, 'approve')}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleApprovalDecision(req.id, 'hold')}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Hold
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleApprovalDecision(req.id, 'reject')}
                      className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {approvals.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              No approval requests in queue. Submit content, replies, or paid campaign plans for human signoff.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
            Phase 4 · Central Action Gateway &amp; Emergency Controls
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
            Autonomy Modes &amp; Emergency Stop
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Configure Mode A (Draft Only), Mode B (Approval Required), or Mode C (Authorized Auto-Publishing) per brand with instant workspace halt.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
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

      {/* Global Emergency Stop Control */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2">
              <OctagonAlert className="h-4 w-4 text-rose-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                Workspace Emergency Stop Switch
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Current State:{' '}
              <span className="font-mono font-semibold text-slate-900">
                {emergencyStop?.globalStopped ? 'STOPPED (ALL EXTERNAL WRITES BLOCKED)' : 'ACTIVE (POLICY ENFORCED)'}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={stopReason}
              onChange={(e) => setStopReason(e.target.value)}
              placeholder="Audit reason..."
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
            />
            {emergencyStop?.globalStopped ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleToggleEmergencyStop(false)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                Resume Operations
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleToggleEmergencyStop(true)}
                className="rounded-lg bg-rose-700 px-4 py-2 text-xs font-medium text-white hover:bg-rose-800"
              >
                Activate Emergency Stop
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Per-Brand Autonomy Policy Editor */}
      <div className="grid gap-6 lg:grid-cols-3">
        <form
          onSubmit={handleSavePolicy}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">Per-Brand Autonomy Policy</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Brand</label>
              <select
                value={policyForm.brandId}
                onChange={(e) => {
                  const id = e.target.value;
                  const found = policies.find((p) => p.brandId === id);
                  if (found) {
                    setPolicyForm({
                      brandId: id,
                      publishingMode: found.publishingMode,
                      allowedAutoPlatforms: found.allowedAutoPlatforms,
                      maxAutoPostsPerDay: found.maxAutoPostsPerDay,
                      commentReplyPolicy: found.commentReplyPolicy,
                      dmReplyPolicy: found.dmReplyPolicy,
                      reviewReplyPolicy: found.reviewReplyPolicy,
                      leadOutreachPolicy: found.leadOutreachPolicy,
                      paidAdsPolicy: found.paidAdsPolicy,
                      requireQualityGatePass: found.requireQualityGatePass,
                      blockSensitiveTopicsAuto: found.blockSensitiveTopicsAuto,
                      paused: found.paused,
                    });
                  } else {
                    setPolicyForm((f) => ({ ...f, brandId: id }));
                  }
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Publishing Mode</label>
              <select
                value={policyForm.publishingMode}
                onChange={(e) =>
                  setPolicyForm((f) => ({
                    ...f,
                    publishingMode: e.target.value as BrandAutonomyPolicy['publishingMode'],
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs"
              >
                <option value="DRAFT_ONLY">Mode A · DRAFT_ONLY</option>
                <option value="APPROVAL_REQUIRED">Mode B · APPROVAL_REQUIRED (Default)</option>
                <option value="AUTHORIZED_AUTO_PUBLISHING">Mode C · AUTHORIZED_AUTO_PUBLISHING</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Max Auto Posts / Day</label>
              <input
                type="number"
                min="0"
                max="50"
                value={policyForm.maxAutoPostsPerDay}
                onChange={(e) =>
                  setPolicyForm((f) => ({ ...f, maxAutoPostsPerDay: Number(e.target.value) }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Comment Reply Policy</label>
              <select
                value={policyForm.commentReplyPolicy}
                onChange={(e) =>
                  setPolicyForm((f) => ({
                    ...f,
                    commentReplyPolicy: e.target.value as BrandAutonomyPolicy['commentReplyPolicy'],
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
              >
                <option value="draft_only">Draft Only</option>
                <option value="approval_required">Approval Required</option>
                <option value="auto_non_sensitive">Auto (Non-Sensitive Only)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Review Reply Policy</label>
              <select
                value={policyForm.reviewReplyPolicy}
                onChange={(e) =>
                  setPolicyForm((f) => ({
                    ...f,
                    reviewReplyPolicy: e.target.value as BrandAutonomyPolicy['reviewReplyPolicy'],
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
              >
                <option value="draft_only">Draft Only</option>
                <option value="approval_required">Approval Required</option>
                <option value="auto_positive_only">Auto (4-5 Star Positive Only)</option>
              </select>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-700">
              Mode C Allowlisted Auto-Publish Platforms
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ALL_PLATFORMS.map((p) => {
                const checked = policyForm.allowedAutoPlatforms.includes(p);
                return (
                  <label
                    key={p}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                      checked
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setPolicyForm((f) => ({
                          ...f,
                          allowedAutoPlatforms: checked
                            ? f.allowedAutoPlatforms.filter((x) => x !== p)
                            : [...f.allowedAutoPlatforms, p],
                        }))
                      }
                      className="sr-only"
                    />
                    {p}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-5 pt-1 text-xs text-slate-700">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={policyForm.requireQualityGatePass}
                onChange={(e) =>
                  setPolicyForm((f) => ({ ...f, requireQualityGatePass: e.target.checked }))
                }
              />
              Require Quality Gate Pass
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={policyForm.blockSensitiveTopicsAuto}
                onChange={(e) =>
                  setPolicyForm((f) => ({ ...f, blockSensitiveTopicsAuto: e.target.checked }))
                }
              />
              Block Sensitive Topics Auto
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={policyForm.paused}
                onChange={(e) => setPolicyForm((f) => ({ ...f, paused: e.target.checked }))}
              />
              Pause This Brand
            </label>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving Policy...' : 'Save Brand Autonomy Policy'}
          </button>
        </form>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Active Brand Policies</h2>
          <div className="mt-3 divide-y divide-slate-100">
            {brands.map((b) => {
              const p = policies.find((x) => x.brandId === b.id);
              return (
                <div key={b.id} className="py-3">
                  <p className="text-sm font-medium text-slate-900">{b.name}</p>
                  <p className="font-mono text-[11px] text-slate-500">
                    {p ? p.publishingMode : 'APPROVAL_REQUIRED (default)'} · Max{' '}
                    {p?.maxAutoPostsPerDay ?? 2}/day {p?.paused ? '· PAUSED' : ''}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
