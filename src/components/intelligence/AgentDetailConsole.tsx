'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, ShieldCheck, Wrench } from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { hasPermission } from '@/lib/rbac';
import type {
  AgentDefinition,
  AgentTaskRecord,
  AgentWorkspaceConfig,
  ModelTaskClass,
} from '@/types/domain';

export function AgentDetailConsole({ agentId }: { agentId: string }) {
  const { activeWorkspace } = useWorkspace();
  const [definition, setDefinition] = useState<AgentDefinition | null>(null);
  const [config, setConfig] = useState<AgentWorkspaceConfig | null>(null);
  const [history, setHistory] = useState<AgentTaskRecord[]>([]);

  const [enabled, setEnabled] = useState(true);
  const [preferredTaskClass, setPreferredTaskClass] = useState<ModelTaskClass>('research_synthesis');
  const [maxStepsOverride, setMaxStepsOverride] = useState<number>(5);
  const [customFocusNote, setCustomFocusNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canConfigure = hasPermission(activeWorkspace?.role, 'agents:configure');

  const loadDetail = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const res = await apiRequest<{
        definition: AgentDefinition;
        config: AgentWorkspaceConfig | null;
        history: AgentTaskRecord[];
      }>(`/api/workspaces/${activeWorkspace.id}/ai/agents/${agentId}`);
      setDefinition(res.definition);
      setConfig(res.config);
      setHistory(res.history);
      setEnabled(res.config?.enabled ?? true);
      setPreferredTaskClass(
        res.config?.preferredTaskClass ?? res.definition.defaultTaskClass,
      );
      setMaxStepsOverride(res.config?.maxStepsOverride ?? res.definition.maxSteps);
      setCustomFocusNote(res.config?.customFocusNote || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load agent inspection.');
    }
  }, [activeWorkspace, agentId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !canConfigure) return;
    setSaving(true);
    setFeedback(null);
    setError(null);
    try {
      const res = await apiRequest<{ config: AgentWorkspaceConfig }>(
        `/api/workspaces/${activeWorkspace.id}/ai/agents/${agentId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            enabled,
            preferredTaskClass,
            maxStepsOverride,
            customFocusNote: customFocusNote.trim(),
          }),
        },
      );
      setConfig(res.config);
      setFeedback('Saved workspace agent configuration safely.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update agent configuration.');
    } finally {
      setSaving(false);
    }
  }

  if (!definition && !error) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Loading agent specification…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/agents"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Agent Team
      </Link>

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

      {definition && (
        <>
          <div className="border-b border-slate-200 pb-5">
            <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
              Agent {definition.number} · v{definition.version}
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900">
              {definition.name} — {definition.roleTitle}
            </h1>
            <p className="mt-1 text-sm text-slate-600">{definition.mission}</p>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-6 lg:col-span-7">
              <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <ShieldCheck className="h-4 w-4 text-blue-700" />
                  Versioned System Policy & Phase 3 Boundary
                </h2>
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
                  {definition.systemInstructions}
                </p>
                <p className="text-xs text-slate-500">{definition.phaseBoundaryNote}</p>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Wrench className="h-4 w-4 text-slate-700" />
                  Permitted Tools & Memory Namespaces
                </h2>
                <div className="text-xs space-y-2">
                  <div>
                    <p className="font-mono text-[11px] uppercase text-slate-500">
                      Allowed Registry Tools
                    </p>
                    <p className="mt-1 font-mono text-slate-800">
                      {definition.allowedTools.join(' · ')}
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-[11px] uppercase text-slate-500">
                      Allowed Memory Namespaces
                    </p>
                    <p className="mt-1 font-mono text-slate-800">
                      {definition.allowedMemoryNamespaces.join(' · ')}
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  Task Execution History ({history.length})
                </h2>
                {history.length === 0 ? (
                  <p className="text-xs text-slate-500">No tasks recorded for this agent yet.</p>
                ) : (
                  <div className="space-y-2">
                    {history.map((task) => (
                      <div
                        key={task.id}
                        className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span className="text-slate-700">{task.runId}</span>
                          <span className="font-semibold text-slate-900">{task.status}</span>
                        </div>
                        <p className="mt-1 text-slate-700">{task.objective}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="lg:col-span-5">
              <form
                onSubmit={handleSaveConfig}
                className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
              >
                <h2 className="text-sm font-semibold text-slate-900">
                  Safe Workspace Configuration
                </h2>
                <p className="text-xs text-slate-600">
                  Admins may toggle agent availability, model routing tier, step bounds, and workspace focus notes without weakening system security boundaries.
                </p>

                <div className="flex items-center gap-2">
                  <input
                    id="agent-enabled"
                    type="checkbox"
                    checked={enabled}
                    disabled={!canConfigure}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <label htmlFor="agent-enabled" className="text-xs font-medium text-slate-800">
                    Enable agent in Orchestrator routing
                  </label>
                </div>

                <div>
                  <label
                    htmlFor="agent-task-class"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Model Routing Class
                  </label>
                  <select
                    id="agent-task-class"
                    value={preferredTaskClass}
                    disabled={!canConfigure}
                    onChange={(e) => setPreferredTaskClass(e.target.value as ModelTaskClass)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  >
                    <option value="fast_routing">fast_routing</option>
                    <option value="research_synthesis">research_synthesis</option>
                    <option value="copy_generation">copy_generation</option>
                    <option value="deep_reasoning">deep_reasoning</option>
                    <option value="qa_critique">qa_critique</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="agent-max-steps"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Max Step / Tool Call Ceiling (1–12)
                  </label>
                  <input
                    id="agent-max-steps"
                    type="number"
                    min={1}
                    max={12}
                    value={maxStepsOverride}
                    disabled={!canConfigure}
                    onChange={(e) => setMaxStepsOverride(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                  />
                </div>

                <div>
                  <label
                    htmlFor="agent-focus-note"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Workspace Editorial Focus Note
                  </label>
                  <textarea
                    id="agent-focus-note"
                    rows={3}
                    value={customFocusNote}
                    disabled={!canConfigure}
                    onChange={(e) => setCustomFocusNote(e.target.value)}
                    placeholder="Optional guidance appended inside workspace context (cannot override safety rules)"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>

                {canConfigure ? (
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {saving ? 'Saving…' : 'Save Agent Settings'}
                  </button>
                ) : (
                  <p className="text-xs text-slate-500">
                    Read-only view (Owner/Admin role required to change agent overrides).
                  </p>
                )}

                {config && (
                  <p className="font-mono text-[10px] text-slate-400">
                    Last updated {new Date(config.updatedAt).toLocaleString()}
                  </p>
                )}
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
