'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  Play,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { hasPermission } from '@/lib/rbac';
import type {
  AgentDefinition,
  AgentWorkspaceConfig,
  NormalizedEventRecord,
  PlaybookDefinition,
  PlaybookId,
  PlaybookRunRecord,
} from '@/types/domain';

interface AgentEntry {
  definition: AgentDefinition;
  config: AgentWorkspaceConfig | null;
  enabled: boolean;
  availability: 'ready' | 'provider_not_configured' | 'disabled_by_admin';
  stats: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
  };
}

export function AgentTeamConsole() {
  const { activeWorkspace } = useWorkspace();
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [aiReady, setAiReady] = useState(false);
  const [playbooks, setPlaybooks] = useState<PlaybookDefinition[]>([]);
  const [playbookRuns, setPlaybookRuns] = useState<PlaybookRunRecord[]>([]);
  const [normalizedEvents, setNormalizedEvents] = useState<NormalizedEventRecord[]>([]);
  const [triggeringId, setTriggeringId] = useState<PlaybookId | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canTriggerPlaybooks = hasPermission(activeWorkspace?.role, 'playbooks:trigger');

  const loadData = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const [agentsRes, pbRes] = await Promise.all([
        apiRequest<{ aiReady: boolean; agents: AgentEntry[] }>(
          `/api/workspaces/${activeWorkspace.id}/ai/agents`,
        ),
        apiRequest<{
          playbooks: PlaybookDefinition[];
          runs: PlaybookRunRecord[];
          events: NormalizedEventRecord[];
        }>(`/api/workspaces/${activeWorkspace.id}/ai/playbooks`),
      ]);
      setAiReady(agentsRes.aiReady);
      setAgents(agentsRes.agents);
      setPlaybooks(pbRes.playbooks);
      setPlaybookRuns(pbRes.runs);
      setNormalizedEvents(pbRes.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Agent Team & Playbooks.');
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleTriggerTestFixture(pbId: PlaybookId) {
    if (!activeWorkspace || !canTriggerPlaybooks) return;
    setTriggeringId(pbId);
    setFeedback(null);
    setError(null);
    try {
      const res = await apiRequest<{
        playbookRun: PlaybookRunRecord;
        deduplicated: boolean;
      }>(`/api/workspaces/${activeWorkspace.id}/ai/playbooks`, {
        method: 'POST',
        body: JSON.stringify({ testFixturePlaybookId: pbId }),
      });
      setFeedback(
        `Playbook test fixture executed (${res.playbookRun.playbookId}) -> Status: ${res.playbookRun.status}.`,
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to trigger playbook fixture.');
    } finally {
      setTriggeringId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="border-b border-slate-200 pb-5">
        <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
          Phase 3 · Multi-Agent Organization
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900">
          Agent Team & Event Playbooks
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Nine specialized agents with versioned instructions, scoped tool permissions, and eight timezone-aware intelligence playbooks.{' '}
          {!aiReady && 'Provider status: AI_PROVIDER_NOT_CONFIGURED (awaiting server key).'}
        </p>
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

      {/* 9 Registered Agents */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">
          Registered Specialist Team (01–09)
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map(({ definition, availability, stats }) => (
            <div
              key={definition.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-blue-700">
                    AGENT {definition.number}
                  </span>
                  <span
                    className={`font-mono text-[11px] ${
                      availability === 'ready'
                        ? 'text-emerald-700'
                        : availability === 'disabled_by_admin'
                          ? 'text-slate-500'
                          : 'text-amber-700'
                    }`}
                  >
                    {availability}
                  </span>
                </div>
                <h3 className="mt-2 flex items-center gap-2 text-base font-semibold text-slate-900">
                  <Bot className="h-4 w-4 text-slate-600" />
                  {definition.name}
                </h3>
                <p className="text-xs font-medium text-slate-500">{definition.roleTitle}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  {definition.mission}
                </p>
              </div>

              <div className="mt-4 space-y-3 border-t border-slate-100 pt-3 text-xs">
                <div className="flex items-center justify-between font-mono text-[11px] text-slate-500 tabular-nums">
                  <span>{definition.allowedTools.length} tools</span>
                  <span>·</span>
                  <span>{stats.completedTasks}/{stats.totalTasks} completed</span>
                </div>
                <Link
                  href={`/dashboard/agents/${definition.id}`}
                  className="inline-flex items-center gap-1.5 font-medium text-blue-700 hover:underline"
                >
                  Inspect & Configure
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 8 Intelligent Event Playbooks */}
      <section className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Zap className="h-4 w-4 text-slate-700" />
            Intelligent Event Playbooks (PB-01 to PB-08)
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Normalized workspace events trigger coordinated Phase 3 research, draft, and reply packages cleanly without executing Phase 4 external mutations.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {playbooks.map((pb) => (
            <div
              key={pb.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-900">
                    {pb.code} · {pb.triggerType}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {pb.agentChain.length} agent(s)
                  </span>
                </div>
                <h3 className="mt-1.5 text-sm font-semibold text-slate-900">{pb.title}</h3>
                <p className="mt-1 text-xs text-slate-600">{pb.description}</p>
                <p className="mt-2 font-mono text-[11px] text-slate-500">
                  Chain: {pb.agentChain.join(' -> ')}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
                  {pb.phaseBoundaryNote}
                </span>
                {canTriggerPlaybooks && (
                  <button
                    type="button"
                    disabled={triggeringId === pb.id}
                    onClick={() => void handleTriggerTestFixture(pb.id)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                  >
                    <Play className="h-3 w-3" />
                    {triggeringId === pb.id ? 'Running…' : 'Run Test Fixture'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Playbook Execution History */}
      {(playbookRuns.length > 0 || normalizedEvents.length > 0) && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Recent Playbook & Event Runs ({playbookRuns.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 font-mono text-[11px] text-slate-500">
                  <th className="py-2 pr-4">Playbook</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Summary</th>
                  <th className="py-2">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {playbookRuns.slice(0, 12).map((pr) => (
                  <tr key={pr.id}>
                    <td className="py-2 pr-4 font-mono text-slate-900">{pr.playbookId}</td>
                    <td className="py-2 pr-4 font-mono text-slate-700">{pr.status}</td>
                    <td className="py-2 pr-4 text-slate-600 line-clamp-1">{pr.summary}</td>
                    <td className="py-2 font-mono text-[11px] text-slate-500">
                      {new Date(pr.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
