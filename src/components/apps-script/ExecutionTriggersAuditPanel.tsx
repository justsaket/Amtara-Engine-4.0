'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Clock,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { hasPermission } from '@/lib/rbac';
import type {
  AppsScriptDeploymentRecord,
  AppsScriptProjectRecord,
  ApprovedExecutionTarget,
  GoogleIntegrationAuditRecord,
  ScriptExecutionRecord,
  ScriptTriggerRecord,
} from '@/types/domain';

export function ExecutionTriggersAuditPanel({
  mode,
  project,
}: {
  mode: 'execute' | 'triggers' | 'audit';
  project?: AppsScriptProjectRecord | null;
}) {
  const { activeWorkspace } = useWorkspace();
  const canExecute = hasPermission(activeWorkspace?.role, 'apps_script:execute');
  const canApprove = hasPermission(activeWorkspace?.role, 'apps_script:approve');
  const canDeploy = hasPermission(activeWorkspace?.role, 'apps_script:deploy');

  const [deployments, setDeployments] = useState<AppsScriptDeploymentRecord[]>([]);
  const [targets, setTargets] = useState<ApprovedExecutionTarget[]>([]);
  const [executions, setExecutions] = useState<ScriptExecutionRecord[]>([]);
  const [triggers, setTriggers] = useState<ScriptTriggerRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<GoogleIntegrationAuditRecord[]>([]);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Register target inputs
  const [regDeploymentId, setRegDeploymentId] = useState('');
  const [regFunctionName, setRegFunctionName] = useState('');
  const [regDescription, setRegDescription] = useState('');
  const [regRisk, setRegRisk] = useState<'low' | 'medium' | 'high'>('low');

  // Execute inputs
  const [execParamsJson, setExecParamsJson] = useState('[]');
  const [execApprovalConfirmed, setExecApprovalConfirmed] = useState(false);

  // Trigger inputs
  const [triggerHandler, setTriggerHandler] = useState('');
  const [triggerType, setTriggerType] =
    useState<ScriptTriggerRecord['triggerType']>('time_hourly');
  const [triggerDeploymentId, setTriggerDeploymentId] = useState('');
  const [intervalValue, setIntervalValue] = useState(6);
  const [hourOfDay, setHourOfDay] = useState(9);

  const loadData = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    try {
      if (mode === 'audit') {
        const res = await apiRequest<{ logs: GoogleIntegrationAuditRecord[] }>(
          `/api/workspaces/${activeWorkspace.id}/apps-script/audit`,
        );
        setAuditLogs(res.logs);
      } else if (project) {
        const [depRes, execRes, trigRes] = await Promise.all([
          apiRequest<{ deployments: AppsScriptDeploymentRecord[] }>(
            `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/deployments`,
          ).catch(() => ({ deployments: [] })),
          apiRequest<{
            targets: ApprovedExecutionTarget[];
            executions: ScriptExecutionRecord[];
          }>(
            `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/execute`,
          ),
          apiRequest<{ triggers: ScriptTriggerRecord[] }>(
            `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/triggers`,
          ),
        ]);
        setDeployments(depRes.deployments);
        setTargets(execRes.targets);
        setExecutions(execRes.executions);
        setTriggers(trigRes.triggers);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load control plane data.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, mode, project]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const apiExecDeployments = deployments.filter(
    (d) => d.deploymentType === 'API_EXECUTABLE' && d.status === 'active',
  );

  async function handleRegisterTarget(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !project || !canApprove) return;
    setBusy('register_target');
    setError(null);
    setNotice(null);
    try {
      await apiRequest(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/execute?action=register`,
        {
          method: 'POST',
          body: JSON.stringify({
            deploymentId: regDeploymentId || apiExecDeployments[0]?.deploymentId || '',
            functionName: regFunctionName.trim(),
            description: regDescription.trim(),
            riskClassification: regRisk,
            requiresHumanApproval: regRisk !== 'low',
          }),
        },
      );
      setRegFunctionName('');
      setRegDescription('');
      setNotice('Registered allowlisted Apps Script function target.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register target.');
    } finally {
      setBusy(null);
    }
  }

  async function handleRunTarget(target: ApprovedExecutionTarget) {
    if (!activeWorkspace || !project || !canExecute) return;
    setBusy(`run_${target.id}`);
    setError(null);
    setNotice(null);
    try {
      let parameters: unknown[] = [];
      try {
        const parsed = JSON.parse(execParamsJson || '[]');
        parameters = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        throw new Error('Parameters must be a valid JSON array (e.g. [{"dryRun":true}]).');
      }

      const res = await apiRequest<{ execution: ScriptExecutionRecord }>(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/execute`,
        {
          method: 'POST',
          body: JSON.stringify({
            deploymentId: target.deploymentId,
            functionName: target.functionName,
            parameters,
            approvalConfirmed: execApprovalConfirmed,
            idempotencyKey: `run_${target.id}_${Date.now()}`,
          }),
        },
      );
      setNotice(
        `Execution "${target.functionName}" finished with status: ${res.execution.status}.`,
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleInstallTrigger(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !project || !canDeploy) return;
    setBusy('trigger_install');
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ trigger: ScriptTriggerRecord }>(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/triggers`,
        {
          method: 'POST',
          body: JSON.stringify({
            handler: triggerHandler.trim(),
            triggerType,
            timezone: activeWorkspace.timezone || 'Asia/Kolkata',
            intervalValue,
            hourOfDay,
            ...(triggerDeploymentId || apiExecDeployments[0]?.deploymentId
              ? { deploymentId: triggerDeploymentId || apiExecDeployments[0]?.deploymentId }
              : {}),
          }),
        },
      );
      setTriggerHandler('');
      setNotice(`Synced trigger "${res.trigger.handler}" (state: ${res.trigger.state}).`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trigger sync failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleRemoveTrigger(triggerId: string) {
    if (!activeWorkspace || !project || !canDeploy) return;
    setBusy(`rm_trig_${triggerId}`);
    setError(null);
    try {
      await apiRequest(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/triggers?triggerId=${encodeURIComponent(triggerId)}`,
        { method: 'DELETE' },
      );
      setNotice('Removed Antara-managed trigger cleanly.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove trigger.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </div>
      )}

      {mode === 'audit' && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-700" />
            <h2 className="font-display text-base font-semibold text-slate-900">
              Google Integration & Apps Script Activity Log
            </h2>
          </div>
          {loading ? (
            <p className="mt-3 text-xs text-slate-500">Loading audit events…</p>
          ) : auditLogs.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">No Google integration activity recorded yet.</p>
          ) : (
            <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {auditLogs.map((log) => (
                <div key={log.id} className="flex flex-wrap items-start justify-between gap-2 p-3.5 text-xs">
                  <div>
                    <p className="font-semibold text-slate-900">{log.summary}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                      {log.operation} · Actor: {log.actorEmail} · Result: {log.providerClassification}
                      {log.targetScriptId ? ` · Script: ${log.targetScriptId}` : ''}
                    </p>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400">
                    {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {mode === 'execute' && project && (
        <>
          {canApprove && (
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-blue-700" />
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Register Allowlisted Execution Target (Owner / Admin)
                </h2>
              </div>
              <form onSubmit={handleRegisterTarget} className="mt-4 grid gap-3 sm:grid-cols-4">
                <select
                  aria-label="API Executable Deployment"
                  value={regDeploymentId || apiExecDeployments[0]?.deploymentId || ''}
                  onChange={(e) => setRegDeploymentId(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                >
                  {apiExecDeployments.length === 0 ? (
                    <option value="">Deploy API_EXECUTABLE first</option>
                  ) : (
                    apiExecDeployments.map((d) => (
                      <option key={d.deploymentId} value={d.deploymentId}>
                        v{d.versionNumber} ({d.deploymentId.slice(0, 12)}…)
                      </option>
                    ))
                  )}
                </select>
                <input
                  type="text"
                  required
                  aria-label="Function name"
                  value={regFunctionName}
                  onChange={(e) => setRegFunctionName(e.target.value)}
                  placeholder="healthCheck"
                  className="rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900"
                />
                <input
                  type="text"
                  required
                  aria-label="Function description"
                  value={regDescription}
                  onChange={(e) => setRegDescription(e.target.value)}
                  placeholder="Verify workspace script status"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900"
                />
                <div className="flex gap-2">
                  <select
                    aria-label="Risk level"
                    value={regRisk}
                    onChange={(e) => setRegRisk(e.target.value as 'low' | 'medium' | 'high')}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-900"
                  >
                    <option value="low">Low risk</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                  <button
                    type="submit"
                    disabled={busy !== null || apiExecDeployments.length === 0}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" /> Allowlist
                  </button>
                </div>
              </form>
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Approved Execution Targets ({targets.length})
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="exec-params" className="block text-xs font-medium text-slate-700">
                  Parameters JSON Array
                </label>
                <input
                  id="exec-params"
                  type="text"
                  value={execParamsJson}
                  onChange={(e) => setExecParamsJson(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900"
                />
              </div>
              <label className="flex items-end gap-2 pb-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={execApprovalConfirmed}
                  onChange={(e) => setExecApprovalConfirmed(e.target.checked)}
                />
                Explicitly confirm execution for medium/high risk targets
              </label>
            </div>

            {targets.length === 0 ? (
              <p className="text-xs text-slate-500">
                Arbitrary function execution is blocked by default. Register approved functions above once an API Executable deployment is active.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {targets.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-3.5 text-xs">
                    <div>
                      <p className="font-semibold text-slate-900">
                        <span className="font-mono text-blue-700">{t.functionName}()</span> · {t.description}
                      </p>
                      <p className="font-mono text-[11px] text-slate-500">
                        Deployment: {t.deploymentId} · Risk: {t.riskClassification}
                      </p>
                    </div>
                    {canExecute && (
                      <button
                        type="button"
                        onClick={() => handleRunTarget(t)}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        <Play className="h-3 w-3" />
                        Run via scripts.run
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Recent Execution History ({executions.length})
              </h3>
              {executions.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">No executions logged yet.</p>
              ) : (
                <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {executions.slice(0, 10).map((ex) => (
                    <div key={ex.id} className="p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-slate-900">
                          {ex.functionName}() — {ex.status.toUpperCase()}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {new Date(ex.startedAt).toLocaleString()}
                        </span>
                      </div>
                      {ex.resultJson && (
                        <pre className="mt-1.5 overflow-x-auto rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-800">
                          {ex.resultJson}
                        </pre>
                      )}
                      {ex.errorMessage && (
                        <p className="mt-1 text-rose-700">{ex.errorMessage}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {mode === 'triggers' && project && (
        <>
          {canDeploy && (
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-700" />
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Install Idempotent Antara-Managed Trigger ({activeWorkspace?.timezone || 'Asia/Kolkata'})
                </h2>
              </div>
              <form onSubmit={handleInstallTrigger} className="mt-4 grid gap-3 sm:grid-cols-4">
                <input
                  type="text"
                  required
                  aria-label="Trigger handler function"
                  value={triggerHandler}
                  onChange={(e) => setTriggerHandler(e.target.value)}
                  placeholder="runScheduledSync"
                  className="rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900"
                />
                <select
                  aria-label="Trigger cadence"
                  value={triggerType}
                  onChange={(e) =>
                    setTriggerType(e.target.value as ScriptTriggerRecord['triggerType'])
                  }
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                >
                  <option value="time_hourly">Hourly Schedule</option>
                  <option value="time_daily">Daily Schedule</option>
                  <option value="time_weekly">Weekly Schedule</option>
                </select>
                <div className="flex gap-2">
                  {triggerType === 'time_hourly' ? (
                    <input
                      type="number"
                      min={1}
                      max={24}
                      aria-label="Every N hours"
                      value={intervalValue}
                      onChange={(e) => setIntervalValue(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900"
                    />
                  ) : (
                    <input
                      type="number"
                      min={0}
                      max={23}
                      aria-label="Hour of day"
                      value={hourOfDay}
                      onChange={(e) => setHourOfDay(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900"
                    />
                  )}
                </div>
                <button
                  type="submit"
                  disabled={busy !== null}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Sync Trigger
                </button>
              </form>
              {apiExecDeployments.length > 0 && (
                <div className="mt-3">
                  <select
                    aria-label="Deployment ID for remote trigger installer"
                    value={triggerDeploymentId || apiExecDeployments[0]?.deploymentId || ''}
                    onChange={(e) => setTriggerDeploymentId(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-700"
                  >
                    {apiExecDeployments.map((d) => (
                      <option key={d.deploymentId} value={d.deploymentId}>
                        Use API_EXECUTABLE v{d.versionNumber} ({d.deploymentId})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Antara-Managed Script Triggers ({triggers.length})
            </h2>
            {triggers.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                No Antara-managed triggers registered on this script yet. Unrelated Google triggers remain untouched.
              </p>
            ) : (
              <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {triggers.map((tr) => (
                  <div key={tr.id} className="flex flex-wrap items-center justify-between gap-2 p-3.5 text-xs">
                    <div>
                      <p className="font-semibold text-slate-900">
                        <span className="font-mono text-blue-700">{tr.handler}()</span> · {tr.scheduleDescription}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                        State: {tr.state} · Ownership: {tr.ownership}
                        {tr.lastErrorMessage ? ` · Note: ${tr.lastErrorMessage}` : ''}
                      </p>
                    </div>
                    {canDeploy && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTrigger(tr.id)}
                        disabled={busy !== null}
                        aria-label={`Remove trigger ${tr.handler}`}
                        className="rounded-md border border-rose-200 p-1.5 text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
