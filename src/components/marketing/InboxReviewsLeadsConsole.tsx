'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquare, RefreshCw, Star, UserPlus } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type {
  BrandProfile,
  LeadRecord,
  ReviewRecord,
  SocialConversationRecord,
  SocialPlatformId,
} from '@/types/domain';

type EnrichedConversation = SocialConversationRecord & {
  messagingWindowStatus?: { allowed: boolean; reason: string };
};

export function InboxReviewsLeadsConsole({
  view,
}: {
  view: 'inbox' | 'reviews' | 'leads';
}) {
  const { activeWorkspace } = useWorkspace();
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [conversations, setConversations] = useState<EnrichedConversation[]>([]);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [gbpState, setGbpState] = useState<string>('not_requested');
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [inboxForm, setInboxForm] = useState({
    brandId: '',
    platform: 'instagram' as SocialPlatformId,
    channelType: 'dm' as SocialConversationRecord['channelType'],
    participantName: '',
    messageText: '',
    messagingWindowType: 'standard_24h' as SocialConversationRecord['messagingWindowType'],
  });

  const [reviewForm, setReviewForm] = useState({
    brandId: '',
    platform: 'google_business_profile' as 'google_business_profile' | 'facebook',
    locationName: '',
    reviewerName: '',
    rating: 5 as 1 | 2 | 3 | 4 | 5,
    comment: '',
  });

  const [leadForm, setLeadForm] = useState({
    brandId: '',
    fullName: '',
    companyName: '',
    email: '',
    phone: '',
    sourceChannel: 'instagram' as LeadRecord['sourceChannel'],
    consentStatus: 'inbound_inquiry_only' as LeadRecord['consentStatus'],
    consentProvenance: '',
    notes: '',
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
      const defaultBrandId = brandsRes.brands[0]?.id || '';
      setInboxForm((f) => ({ ...f, brandId: f.brandId || defaultBrandId }));
      setReviewForm((f) => ({ ...f, brandId: f.brandId || defaultBrandId }));
      setLeadForm((f) => ({ ...f, brandId: f.brandId || defaultBrandId }));

      if (view === 'inbox') {
        const res = await apiRequest<{ conversations: EnrichedConversation[] }>(
          `/api/workspaces/${activeWorkspace.id}/marketing/inbox`,
        );
        setConversations(res.conversations);
      } else if (view === 'reviews') {
        const res = await apiRequest<{
          reviews: ReviewRecord[];
          gbpReadiness: { state: string };
        }>(`/api/workspaces/${activeWorkspace.id}/marketing/reviews`);
        setReviews(res.reviews);
        setGbpState(res.gbpReadiness.state);
      } else {
        const res = await apiRequest<{ leads: LeadRecord[] }>(
          `/api/workspaces/${activeWorkspace.id}/marketing/leads`,
        );
        setLeads(res.leads);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load queue.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, view]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleIngestConversation(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const expiresAt =
        inboxForm.channelType === 'dm'
          ? new Date(Date.now() + 24 * 3600 * 1000).toISOString()
          : undefined;
      const res = await apiRequest<{ note: string }>(
        `/api/workspaces/${activeWorkspace.id}/marketing/inbox`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'ingest_message',
            ...inboxForm,
            messagingWindowExpiresAt: expiresAt,
          }),
        },
      );
      setNotice(res.note);
      setInboxForm((f) => ({ ...f, participantName: '', messageText: '' }));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log conversation.');
    } finally {
      setSaving(false);
    }
  }

  async function handleConversationAction(
    conversationId: string,
    action: 'draft_reply' | 'request_approval' | 'escalate' | 'resolve',
    replyText?: string,
  ) {
    if (!activeWorkspace) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ note: string }>(
        `/api/workspaces/${activeWorkspace.id}/marketing/inbox`,
        {
          method: 'POST',
          body: JSON.stringify({ action, conversationId, replyText }),
        },
      );
      setNotice(res.note);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    }
  }

  async function handleIngestReview(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ note: string }>(
        `/api/workspaces/${activeWorkspace.id}/marketing/reviews`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'ingest_review',
            ...reviewForm,
          }),
        },
      );
      setNotice(res.note);
      setReviewForm((f) => ({ ...f, reviewerName: '', comment: '' }));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record review.');
    } finally {
      setSaving(false);
    }
  }

  async function handleReviewWorkflow(
    reviewId: string,
    action: 'draft_reply' | 'request_approval' | 'escalate',
  ) {
    if (!activeWorkspace) return;
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ note: string }>(
        `/api/workspaces/${activeWorkspace.id}/marketing/reviews`,
        {
          method: 'POST',
          body: JSON.stringify({ action, reviewId }),
        },
      );
      setNotice(res.note);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review action failed.');
    }
  }

  async function handleCreateLead(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/marketing/leads`, {
        method: 'POST',
        body: JSON.stringify({
          ...leadForm,
          email: leadForm.email || undefined,
          phone: leadForm.phone || undefined,
          companyName: leadForm.companyName || undefined,
          notes: leadForm.notes || undefined,
        }),
      });
      setNotice('Lead created with explicit consent provenance.');
      setLeadForm((f) => ({
        ...f,
        fullName: '',
        companyName: '',
        email: '',
        phone: '',
        consentProvenance: '',
        notes: '',
      }));
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create lead.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAdvanceLeadStage(leadId: string, stage: LeadRecord['stage']) {
    if (!activeWorkspace) return;
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/marketing/leads`, {
        method: 'PATCH',
        body: JSON.stringify({ leadId, stage }),
      });
      setNotice(`Lead moved to ${stage}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update lead stage.');
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

  if (view === 'inbox') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
              Phase 4 · Policy-Aware Social Inbox
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
              Social Inbox &amp; Messaging Guardrails
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Enforces Meta 24h standard / 72h Click-to-Message windows, detects legal/refund/safety sensitive topics, and routes replies through the Central Action Gateway.
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
          <form onSubmit={handleIngestConversation} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-900">Log Inbound Interaction</h2>
            </div>
            <select
              value={inboxForm.brandId}
              onChange={(e) => setInboxForm((f) => ({ ...f, brandId: e.target.value }))}
              required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={inboxForm.platform}
                onChange={(e) => setInboxForm((f) => ({ ...f, platform: e.target.value as SocialPlatformId }))}
                className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
              >
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
                <option value="linkedin">LinkedIn</option>
                <option value="youtube">YouTube</option>
              </select>
              <select
                value={inboxForm.channelType}
                onChange={(e) =>
                  setInboxForm((f) => ({
                    ...f,
                    channelType: e.target.value as SocialConversationRecord['channelType'],
                    messagingWindowType: e.target.value === 'comment' ? 'comment_public' : 'standard_24h',
                  }))
                }
                className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
              >
                <option value="dm">Direct Message</option>
                <option value="comment">Public Comment</option>
                <option value="mention">Mention</option>
              </select>
            </div>
            <input
              type="text"
              required
              value={inboxForm.participantName}
              onChange={(e) => setInboxForm((f) => ({ ...f, participantName: e.target.value }))}
              placeholder="Customer name or handle"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <textarea
              required
              rows={3}
              value={inboxForm.messageText}
              onChange={(e) => setInboxForm((f) => ({ ...f, messageText: e.target.value }))}
              placeholder="Inbound customer message..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              Ingest &amp; Evaluate Policy
            </button>
          </form>

          <div className="space-y-3 lg:col-span-2">
            {conversations.map((c) => (
              <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {c.participantName} · {c.platform} ({c.channelType})
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {brandMap.get(c.brandId) || c.brandId} · Status: {c.status} · Window:{' '}
                      {c.messagingWindowStatus?.allowed ? 'OPEN' : 'BLOCKED'}
                      {c.sensitiveTopicDetected ? ` · SENSITIVE (${c.sensitiveTopicReason || 'flagged'})` : ''}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-sm text-slate-800">
                  {c.messages[c.messages.length - 1]?.text || c.aiSummary || 'No message text recorded.'}
                </p>
                {c.draftReply && (
                  <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                    <span className="font-mono font-semibold">Draft Reply:</span> {c.draftReply}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void handleConversationAction(
                        c.id,
                        'draft_reply',
                        `Thank you for reaching out to ${brandMap.get(c.brandId) || 'our team'}. Our specialist is reviewing your request and will share verified details shortly.`,
                      )
                    }
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Generate Safe Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConversationAction(c.id, 'request_approval')}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Send to Approvals
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConversationAction(c.id, 'escalate')}
                    className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50"
                  >
                    Escalate
                  </button>
                </div>
              </div>
            ))}
            {conversations.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                No inbox conversations recorded yet.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'reviews') {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
              Phase 4 · 8-Category Review &amp; Reputation Manager
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
              Reviews &amp; GBP Readiness
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              GBP API Access State:{' '}
              <span className="font-mono font-semibold text-slate-900">{gbpState}</span> · Negative, billing, defect, and safety reviews always escalate to human approval.
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
          <form onSubmit={handleIngestReview} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-900">Classify &amp; Log Review</h2>
            </div>
            <select
              value={reviewForm.brandId}
              onChange={(e) => setReviewForm((f) => ({ ...f, brandId: e.target.value }))}
              required
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={reviewForm.platform}
                onChange={(e) =>
                  setReviewForm((f) => ({
                    ...f,
                    platform: e.target.value as 'google_business_profile' | 'facebook',
                  }))
                }
                className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
              >
                <option value="google_business_profile">Google Business Profile</option>
                <option value="facebook">Facebook Reviews</option>
              </select>
              <select
                value={reviewForm.rating}
                onChange={(e) =>
                  setReviewForm((f) => ({ ...f, rating: Number(e.target.value) as 1 | 2 | 3 | 4 | 5 }))
                }
                className="rounded-lg border border-slate-200 px-2.5 py-2 font-mono text-xs"
              >
                {[5, 4, 3, 2, 1].map((r) => (
                  <option key={r} value={r}>{r} Star(s)</option>
                ))}
              </select>
            </div>
            <input
              type="text"
              required
              value={reviewForm.reviewerName}
              onChange={(e) => setReviewForm((f) => ({ ...f, reviewerName: e.target.value }))}
              placeholder="Reviewer name"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <textarea
              required
              rows={3}
              value={reviewForm.comment}
              onChange={(e) => setReviewForm((f) => ({ ...f, comment: e.target.value }))}
              placeholder="Customer review text..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              Classify &amp; Draft Safe Reply
            </button>
          </form>

          <div className="space-y-3 lg:col-span-2">
            {reviews.map((rev) => (
              <div key={rev.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">
                    {rev.reviewerName} · {rev.rating}/5 ★ · {rev.category}
                  </p>
                  <span className="font-mono text-xs text-slate-600">{rev.replyStatus}</span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-slate-500">
                  {brandMap.get(rev.brandId) || rev.brandId} · {rev.platform}
                  {rev.escalationRequired ? ' · ESCALATION REQUIRED' : ''}
                </p>
                <p className="mt-2 text-sm text-slate-800">{rev.comment}</p>
                {rev.aiDraftReply && (
                  <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                    <span className="font-mono font-semibold">Brand-Safe Draft:</span> {rev.aiDraftReply}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleReviewWorkflow(rev.id, 'draft_reply')}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Draft Reply
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleReviewWorkflow(rev.id, 'request_approval')}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Request Human Approval
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleReviewWorkflow(rev.id, 'escalate')}
                    className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50"
                  >
                    Escalate
                  </button>
                </div>
              </div>
            ))}
            {reviews.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                No reviews classified yet.
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
            Phase 4 · Consent-Tracked Lead CRM
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
            Lead Pipeline &amp; Follow-Up Governance
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Tracks explicit consent provenance for every lead and blocks external outreach to opted-out or unconfirmed contacts.
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
        <form onSubmit={handleCreateLead} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">Add Consented Lead</h2>
          </div>
          <select
            value={leadForm.brandId}
            onChange={(e) => setLeadForm((f) => ({ ...f, brandId: e.target.value }))}
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <input
            type="text"
            required
            value={leadForm.fullName}
            onChange={(e) => setLeadForm((f) => ({ ...f, fullName: e.target.value }))}
            placeholder="Contact full name"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={leadForm.companyName}
            onChange={(e) => setLeadForm((f) => ({ ...f, companyName: e.target.value }))}
            placeholder="Company / Dealership (optional)"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="email"
              value={leadForm.email}
              onChange={(e) => setLeadForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="Email"
              className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
            />
            <input
              type="text"
              value={leadForm.phone}
              onChange={(e) => setLeadForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="Phone"
              className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={leadForm.sourceChannel}
              onChange={(e) =>
                setLeadForm((f) => ({ ...f, sourceChannel: e.target.value as LeadRecord['sourceChannel'] }))
              }
              className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
            >
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="linkedin">LinkedIn</option>
              <option value="website">Website Form</option>
              <option value="manual">Manual Entry</option>
            </select>
            <select
              value={leadForm.consentStatus}
              onChange={(e) =>
                setLeadForm((f) => ({ ...f, consentStatus: e.target.value as LeadRecord['consentStatus'] }))
              }
              className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
            >
              <option value="explicit_opt_in">Explicit Opt-In</option>
              <option value="inbound_inquiry_only">Inbound Inquiry Only</option>
              <option value="unconfirmed">Unconfirmed</option>
              <option value="opted_out">Opted Out</option>
            </select>
          </div>
          <input
            type="text"
            required
            value={leadForm.consentProvenance}
            onChange={(e) => setLeadForm((f) => ({ ...f, consentProvenance: e.target.value }))}
            placeholder="Consent proof (e.g., Submitted website quote form)"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            Save Lead
          </button>
        </form>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white lg:col-span-2">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 font-mono text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Lead &amp; Brand</th>
                <th className="px-4 py-3">Consent Status</th>
                <th className="px-4 py-3">Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">
                      {l.fullName} {l.companyName ? `· ${l.companyName}` : ''}
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {brandMap.get(l.brandId) || l.brandId} · {l.sourceChannel} · {l.email || l.phone || 'No direct contact'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p className="font-mono text-slate-800">{l.consentStatus}</p>
                    <p className="text-[11px] text-slate-500">{l.consentProvenance}</p>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={l.stage}
                      onChange={(e) =>
                        void handleAdvanceLeadStage(l.id, e.target.value as LeadRecord['stage'])
                      }
                      className="rounded-lg border border-slate-200 px-2 py-1 font-mono text-xs"
                    >
                      {['NEW', 'IDENTIFIED', 'QUALIFICATION_PENDING', 'QUALIFIED', 'FOLLOW_UP', 'CONVERTED', 'LOST', 'ARCHIVED'].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-sm text-slate-500">
                    No leads captured yet.
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
