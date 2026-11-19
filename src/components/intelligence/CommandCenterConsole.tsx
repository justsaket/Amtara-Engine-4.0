'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  Layers,
  MessageSquare,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { auth } from '@/lib/firebase/client';
import { hasPermission } from '@/lib/rbac';
import type {
  AgentArtifactPayload,
  AgentExecutionEvent,
  AgentTaskRecord,
  AiConversationMessage,
  AiConversationRecord,
  AiProviderStatusDescriptor,
  BrandProfile,
  ClaimEvidenceRecord,
  OrchestratorRunRecord,
  ResearchSourceRecord,
} from '@/types/domain';

interface ProvidersResponse {
  workspaceId: string;
  timezone: string;
  aiReady: boolean;
  searchConfigured: boolean;
  providers: AiProviderStatusDescriptor[];
  usageSummary: {
    totalRecords: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalEstimatedCostUsd: number | null;
  };
}

interface CommandHistoryResponse {
  runs: OrchestratorRunRecord[];
  conversations: AiConversationRecord[];
  messages: AiConversationMessage[];
}

interface RunDetailsResponse {
  run: OrchestratorRunRecord;
  tasks: AgentTaskRecord[];
  events: AgentExecutionEvent[];
  artifacts: AgentArtifactPayload[];
}

const STARTER_PROMPTS = [
  {
    label: 'Full Brand Campaign',
    text: 'Research current market demand, identify search opportunities, and create a 14-day content strategy plus LinkedIn draft brief.',
  },
  {
    label: 'Search Visibility Audit',
    text: 'Conduct an SEO keyword cluster and AI visibility gap analysis for our priority topics without inventing traffic metrics.',
  },
  {
    label: '1-Star Review Response',
    text: 'A 1-star review arrived complaining about delayed installation instructions. Assess severity and draft two calm reply options.',
  },
  {
    label: '11 PM DM Lead Reply',
    text: 'An inbound DM lead arrived at 11 PM asking about industrial equipment timelines. Evaluate quiet-hours SLA and draft a morning reply.',
  },
] as const;

export function CommandCenterConsole() {
  const { activeWorkspace } = useWorkspace();
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [providerInfo, setProviderInfo] = useState<ProvidersResponse | null>(null);
  const [runs, setRuns] = useState<OrchestratorRunRecord[]>([]);
  const [conversations, setConversations] = useState<AiConversationRecord[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('');
  const [messages, setMessages] = useState<AiConversationMessage[]>([]);

  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [liveEvents, setLiveEvents] = useState<AgentExecutionEvent[]>([]);
  const [activeRun, setActiveRun] = useState<OrchestratorRunRecord | null>(null);
  const [activeTasks, setActiveTasks] = useState<AgentTaskRecord[]>([]);
  const [activeArtifacts, setActiveArtifacts] = useState<AgentArtifactPayload[]>([]);
  const [activeSources, setActiveSources] = useState<ResearchSourceRecord[]>([]);
  const [activeClaims, setActiveClaims] = useState<ClaimEvidenceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canRun = hasPermission(activeWorkspace?.role, 'ai:run');

  const loadWorkspaceData = useCallback(
    async (convId?: string) => {
      if (!activeWorkspace) return;
      try {
        const [brandRes, provRes, cmdRes] = await Promise.all([
          apiRequest<{ brands: BrandProfile[] }>(
            `/api/workspaces/${activeWorkspace.id}/brands`,
          ),
          apiRequest<ProvidersResponse>(
            `/api/workspaces/${activeWorkspace.id}/ai/providers`,
          ),
          apiRequest<CommandHistoryResponse>(
            `/api/workspaces/${activeWorkspace.id}/ai/command${convId ? `?conversationId=${encodeURIComponent(convId)}` : ''}`,
          ),
        ]);

        setBrands(brandRes.brands);
        if (!selectedBrandId && brandRes.brands[0]) {
          setSelectedBrandId(brandRes.brands[0].id);
        }
        setProviderInfo(provRes);
        setRuns(cmdRes.runs);
        setConversations(cmdRes.conversations);
        setMessages(cmdRes.messages);

        if (!activeRun && cmdRes.runs[0]) {
          const details = await apiRequest<RunDetailsResponse>(
            `/api/workspaces/${activeWorkspace.id}/ai/runs/${cmdRes.runs[0].id}`,
          ).catch(() => null);
          if (details) {
            setActiveRun(details.run);
            setActiveTasks(details.tasks);
            setActiveArtifacts(details.artifacts);
            setLiveEvents(details.events);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load AI Command Center.');
      }
    },
    [activeWorkspace, selectedBrandId, activeRun],
  );

  useEffect(() => {
    void loadWorkspaceData(activeConversationId || undefined);
  }, [loadWorkspaceData, activeConversationId]);

  async function inspectRun(runId: string) {
    if (!activeWorkspace) return;
    try {
      const details = await apiRequest<RunDetailsResponse>(
        `/api/workspaces/${activeWorkspace.id}/ai/runs/${runId}`,
      );
      setActiveRun(details.run);
      setActiveTasks(details.tasks);
      setActiveArtifacts(details.artifacts);
      setLiveEvents(details.events);
      setActiveSources([]);
      setActiveClaims([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed loading run trace.');
    }
  }

  async function handleExecuteCommand(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !prompt.trim() || !canRun) return;

    setRunning(true);
    setError(null);
    setLiveEvents([]);
    setActiveTasks([]);
    setActiveArtifacts([]);
    setActiveSources([]);
    setActiveClaims([]);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (auth?.currentUser) {
        headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
      }

      const res = await fetch(`/api/workspaces/${activeWorkspace.id}/ai/command`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          prompt: prompt.trim(),
          brandId: selectedBrandId || undefined,
          conversationId: activeConversationId || undefined,
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(text || `Request failed (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
          const eventLine = chunk
            .split('\n')
            .find((l) => l.startsWith('event:'))
            ?.slice(6)
            .trim();
          const dataLine = chunk
            .split('\n')
            .find((l) => l.startsWith('data:'))
            ?.slice(5)
            .trim();
          if (!eventLine || !dataLine) continue;

          const parsed = JSON.parse(dataLine) as Record<string, unknown>;
          if (eventLine === 'progress') {
            setLiveEvents((prev) => [...prev, parsed as unknown as AgentExecutionEvent]);
          } else if (eventLine === 'complete') {
            const run = parsed.run as OrchestratorRunRecord;
            setActiveRun(run);
            setActiveTasks((parsed.tasks as AgentTaskRecord[]) || []);
            setActiveArtifacts((parsed.artifacts as AgentArtifactPayload[]) || []);
            setActiveSources((parsed.sources as ResearchSourceRecord[]) || []);
            setActiveClaims((parsed.claims as ClaimEvidenceRecord[]) || []);
            if (typeof parsed.conversationId === 'string') {
              setActiveConversationId(parsed.conversationId);
            }
          } else if (eventLine === 'error') {
            setError(String(parsed.message || 'Orchestrator failed.'));
          }
        }
      }

      setPrompt('');
      await loadWorkspaceData(activeConversationId || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to execute AI command.');
    } finally {
      setRunning(false);
    }
  }

  async function handleCancelRun() {
    if (!activeWorkspace || !activeRun) return;
    try {
      await apiRequest(
        `/api/workspaces/${activeWorkspace.id}/ai/runs/${activeRun.id}`,
        {
          method: 'POST',
          body: JSON.stringify({ action: 'cancel' }),
        },
      );
      await inspectRun(activeRun.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel run.');
    }
  }

  const configuredProviders = (providerInfo?.providers || []).filter(
    (p) => p.state === 'configured',
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
            Phase 3 · Agent 01 Central Orchestrator
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900">
            AI Command Center
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Route natural-language directives through brand-grounded specialist agents. Phase 3 outputs research, drafts, and strategy packages only.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label
              htmlFor="cmd-brand-select"
              className="block font-mono text-[10px] uppercase tracking-wider text-slate-500"
            >
              Target Brand
            </label>
            <select
              id="cmd-brand-select"
              value={selectedBrandId}
              onChange={(e) => setSelectedBrandId(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900"
            >
              <option value="">Workspace-Wide (All Brands)</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Honest Provider Readiness Strip */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2.5">
            {providerInfo?.aiReady ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            )}
            <span className="font-semibold text-slate-900">
              {providerInfo?.aiReady
                ? `Active Inference Providers: ${configuredProviders.map((p) => p.label).join(', ')}`
                : 'AI Inference Not Configured (AI_PROVIDER_NOT_CONFIGURED)'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-slate-600 tabular-nums">
            <span>
              Search Grounding:{' '}
              {providerInfo?.searchConfigured ? 'Enabled' : 'Unconfigured'}
            </span>
            <span>·</span>
            <span>
              Tokens Used:{' '}
              {(
                (providerInfo?.usageSummary.totalInputTokens || 0) +
                (providerInfo?.usageSummary.totalOutputTokens || 0)
              ).toLocaleString()}
            </span>
            <span>·</span>
            <span>
              Est. Cost:{' '}
              {providerInfo?.usageSummary.totalEstimatedCostUsd !== null &&
              providerInfo?.usageSummary.totalEstimatedCostUsd !== undefined
                ? `$${providerInfo.usageSummary.totalEstimatedCostUsd.toFixed(4)}`
                : 'Unknown rate'}
            </span>
          </div>
        </div>
        {!providerInfo?.aiReady && providerInfo !== null && (
          <p className="mt-2 text-xs text-slate-600">
            Configure <code className="font-mono text-slate-800">GEMINI_API_KEY</code>,{' '}
            <code className="font-mono text-slate-800">AI_GATEWAY_API_KEY</code>,{' '}
            <code className="font-mono text-slate-800">OPENAI_API_KEY</code>, or{' '}
            <code className="font-mono text-slate-800">ANTHROPIC_API_KEY</code> in server environment variables to activate live specialist inference.
          </p>
        )}
      </section>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Main Orchestrator Workspace */}
        <div className="space-y-6 lg:col-span-8">
          <form
            onSubmit={handleExecuteCommand}
            className="rounded-xl border border-slate-200 bg-white p-5"
          >
            <label
              htmlFor="ai-command-input"
              className="block text-xs font-semibold text-slate-900"
            >
              Directive for Antara Intelligence Team
            </label>
            <textarea
              id="ai-command-input"
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={running || !canRun}
              placeholder="Ask Orchestrator to conduct research, audit SEO visibility, design a 14-day content strategy, or draft a brand-safe reply..."
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
            />

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {STARTER_PROMPTS.map((sp) => (
                  <button
                    key={sp.label}
                    type="button"
                    onClick={() => setPrompt(sp.text)}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {sp.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {running && activeRun && (
                  <button
                    type="button"
                    onClick={handleCancelRun}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Cancel
                  </button>
                )}
                <button
                  type="submit"
                  disabled={running || !prompt.trim() || !canRun}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  {running ? 'Orchestrating…' : 'Dispatch to Orchestrator'}
                </button>
              </div>
            </div>
          </form>

          {/* DAG Progress & Execution Timeline */}
          {(activeRun || liveEvents.length > 0) && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-slate-700" />
                  <h2 className="text-sm font-semibold text-slate-900">
                    Execution Graph & Timeline
                  </h2>
                </div>
                {activeRun && (
                  <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                    Status: <strong className="text-slate-900">{activeRun.status}</strong> ·{' '}
                    Intent: {activeRun.intentCategory} ·{' '}
                    {activeRun.totalInputTokens + activeRun.totalOutputTokens} tokens
                  </span>
                )}
              </div>

              {activeTasks.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {activeTasks.map((t) => (
                    <div
                      key={t.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">
                          Stage {t.stageIndex + 1} · {t.agentId}
                        </span>
                        <span className="font-mono text-[11px] text-slate-600">
                          {t.status}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] text-slate-600">
                        {t.objective}
                      </p>
                      {t.errorCode && (
                        <p className="mt-1 font-mono text-[10px] text-rose-700">
                          {t.errorCode}: {t.errorMessage}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {liveEvents.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] text-slate-700 space-y-1">
                  {liveEvents.map((ev) => (
                    <div key={ev.id} className="flex items-start gap-2">
                      <span className="shrink-0 text-slate-400">
                        {ev.eventType}
                      </span>
                      <span>{ev.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Final Synthesized Brief & Artifacts */}
          {activeRun?.finalMarkdown && (
            <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-blue-700" />
                  <h2 className="text-sm font-semibold text-slate-900">
                    Synthesized Output Brief
                  </h2>
                </div>
                <span className="font-mono text-[11px] text-slate-500">
                  QA: {activeRun.qaVerdict || 'pending'} · Phase 3 Draft Only
                </span>
              </div>

              <div className="prose prose-sm prose-slate max-w-none text-sm leading-relaxed text-slate-800">
                <Markdown>{activeRun.finalMarkdown}</Markdown>
              </div>
            </section>
          )}

          {activeArtifacts.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Layers className="h-4 w-4 text-slate-700" />
                Specialist Artifacts ({activeArtifacts.length})
              </h3>
              <div className="space-y-3">
                {activeArtifacts.map((art) => (
                  <div
                    key={art.id}
                    className="rounded-lg border border-slate-200 p-4 text-xs space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{art.title}</span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {art.agentId} · {art.kind} · {art.verificationStatus}
                      </span>
                    </div>
                    <p className="text-slate-600">{art.summary}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(activeSources.length > 0 || activeClaims.length > 0) && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Claim Verification & Citations ({activeClaims.length} claims ·{' '}
                {activeSources.length} sources)
              </h3>
              {activeClaims.map((clm) => (
                <div
                  key={clm.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-slate-800">
                      {clm.verificationStatus} ({Math.round(clm.confidence * 100)}%)
                    </span>
                  </div>
                  <p className="mt-1 font-medium text-slate-900">{clm.claimText}</p>
                  <p className="mt-1 text-[11px] text-slate-600">{clm.rationale}</p>
                </div>
              ))}
              {activeSources.map((src) => (
                <div
                  key={src.id}
                  className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs"
                >
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate font-medium text-blue-700 hover:underline"
                  >
                    {src.title}
                  </a>
                  <span className="shrink-0 font-mono text-[11px] text-slate-500">
                    {src.domain}
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>

        {/* Right Rail: Conversation & Run History */}
        <aside className="space-y-6 lg:col-span-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <MessageSquare className="h-3.5 w-3.5" />
                Saved Threads ({conversations.length})
              </h2>
              <button
                type="button"
                onClick={() => {
                  setActiveConversationId('');
                  setMessages([]);
                }}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                New Thread
              </button>
            </div>
            <div className="space-y-1.5">
              {conversations.length === 0 ? (
                <p className="text-xs text-slate-500">No saved AI threads yet.</p>
              ) : (
                conversations.slice(0, 8).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveConversationId(c.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      activeConversationId === c.id
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100'
                    }`}
                  >
                    <p className="truncate font-medium">{c.title}</p>
                    <p
                      className={`mt-0.5 font-mono text-[10px] ${
                        activeConversationId === c.id ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {new Date(c.updatedAt).toLocaleString()}
                    </p>
                  </button>
                ))
              )}
            </div>
            {messages.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                  Thread Transcript
                </p>
                <div className="max-h-48 space-y-2 overflow-y-auto text-xs">
                  {messages.map((m) => (
                    <div key={m.id} className="rounded-lg bg-slate-50 p-2">
                      <span className="font-mono text-[10px] uppercase text-slate-500">
                        {m.role}
                      </span>
                      <p className="mt-0.5 line-clamp-3 text-slate-800">{m.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              Recent Orchestrator Runs ({runs.length})
            </h2>
            <div className="space-y-2">
              {runs.length === 0 ? (
                <p className="text-xs text-slate-500">No execution history recorded yet.</p>
              ) : (
                runs.slice(0, 10).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => void inspectRun(r.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${
                      activeRun?.id === r.id
                        ? 'border-blue-700 bg-blue-50/50'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 font-mono text-[10px] text-slate-600">
                        <Bot className="h-3 w-3" />
                        {r.intentCategory}
                      </span>
                      <span className="font-mono text-[10px] font-semibold text-slate-800">
                        {r.status}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-slate-800">{r.prompt}</p>
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
