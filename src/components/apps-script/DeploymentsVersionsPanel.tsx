'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  GitCommitHorizontal,
  GlobeLock,
  Rocket,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { hasPermission } from '@/lib/rbac';
import type {
  AppsScriptDeploymentRecord,
  AppsScriptProjectRecord,
  AppsScriptVersionRecord,
  WebAppAccessLevel,
  WebAppExecuteAs,
} from '@/types/domain';

export function DeploymentsVersionsPanel({
  mode,
  project,
}: {
  mode: 'versions' | 'deployments';
  project: AppsScriptProjectRecord;
}) {
  const { activeWorkspace } = useWorkspace();
  const canWrite = hasPermission(activeWorkspace?.role, 'apps_script:write');
  const canDeploy = hasPermission(activeWorkspace?.role, 'apps_script:deploy');

  const [versions, setVersions] = useState<AppsScriptVersionRecord[]>([]);
  const [deployments, setDeployments] = useState<AppsScriptDeploymentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [versionDesc, setVersionDesc] = useState('');
  const [deploymentType, setDeploymentType] = useState<'WEB_APP' | 'API_EXECUTABLE'>('WEB_APP');
  const [deployVersion, setDeployVersion] = useState<string>('');
  const [deployDesc, setDeployDesc] = useState('');
  const [accessLevel, setAccessLevel] = useState<WebAppAccessLevel>('MYSELF');
  const [executeAs, setExecuteAs] = useState<WebAppExecuteAs>('USER_DEPLOYING');
  const [confirmPublic, setConfirmPublic] = useState(false);

  const [updateTargetId, setUpdateTargetId] = useState<string>('');
  const [updateVersionNum, setUpdateVersionNum] = useState<string>('');
  const [confirmProdReplace, setConfirmProdReplace] = useState(false);

  const loadData = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    try {
      const [verRes, depRes] = await Promise.all([
        apiRequest<{ versions: AppsScriptVersionRecord[] }>(
          `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/versions`,
        ),
        apiRequest<{ deployments: AppsScriptDeploymentRecord[] }>(
          `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/deployments`,
        ),
      ]);
      setVersions(verRes.versions);
      setDeployments(depRes.deployments);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load versions & deployments.',
      );
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, project.scriptId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleCreateVersion(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !canWrite || !versionDesc.trim()) return;
    setBusy('version');
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ version: AppsScriptVersionRecord }>(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/versions`,
        {
          method: 'POST',
          body: JSON.stringify({
            description: versionDesc.trim(),
            changeSummary: versionDesc.trim(),
          }),
        },
      );
      setVersionDesc('');
      setNotice(`Released immutable version v${res.version.versionNumber}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create version.');
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateDeployment(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !canDeploy || !deployDesc.trim()) return;
    setBusy('deploy');
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ deployment: AppsScriptDeploymentRecord }>(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/deployments`,
        {
          method: 'POST',
          body: JSON.stringify({
            deploymentType,
            ...(deployVersion ? { versionNumber: Number(deployVersion) } : {}),
            description: deployDesc.trim(),
            accessLevel,
            executeAs,
            confirmPublicAccess: confirmPublic,
          }),
        },
      );
      setDeployDesc('');
      setConfirmPublic(false);
      setNotice(
        `Created & verified ${res.deployment.deploymentType} deployment (${res.deployment.deploymentId}) on v${res.deployment.versionNumber}.`,
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deployment failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleUpdateDeployment(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !canDeploy || !updateTargetId || !updateVersionNum) return;
    setBusy('update_dep');
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ deployment: AppsScriptDeploymentRecord }>(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/deployments`,
        {
          method: 'PUT',
          body: JSON.stringify({
            deploymentId: updateTargetId,
            versionNumber: Number(updateVersionNum),
            description: `Rollout v${updateVersionNum} via Antara Control Plane`,
            confirmProductionReplacement: confirmProdReplace,
          }),
        },
      );
      setConfirmProdReplace(false);
      setUpdateTargetId('');
      setNotice(`Updated deployment ${res.deployment.deploymentId} to v${res.deployment.versionNumber}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deployment update failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleRetireDeployment(depId: string) {
    if (!activeWorkspace || !canDeploy) return;
    setBusy(`retire_${depId}`);
    setError(null);
    try {
      await apiRequest(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/deployments?deploymentId=${encodeURIComponent(depId)}`,
        { method: 'DELETE' },
      );
      setNotice(`Retired deployment ${depId}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to retire deployment.');
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
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
          <span>{notice}</span>
        </div>
      )}

      {mode === 'versions' ? (
        <>
          {canWrite && (
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2">
                <GitCommitHorizontal className="h-4 w-4 text-blue-700" />
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Release Immutable Apps Script Version
                </h2>
              </div>
              <form onSubmit={handleCreateVersion} className="mt-4 flex flex-wrap gap-3">
                <input
                  type="text"
                  required
                  aria-label="Version release description"
                  value={versionDesc}
                  onChange={(e) => setVersionDesc(e.target.value)}
                  placeholder="v1.0 — Verified workspace automation release"
                  className="min-w-[240px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy !== null}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {busy === 'version' ? 'Creating Version…' : 'Create Immutable Version'}
                </button>
              </form>
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Immutable Version History ({versions.length})
            </h2>
            {loading ? (
              <p className="mt-3 text-xs text-slate-500">Syncing versions from Google Apps Script…</p>
            ) : versions.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No immutable versions published yet.</p>
            ) : (
              <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {versions.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-3.5 text-xs">
                    <div>
                      <p className="font-semibold text-slate-900">
                        <span className="font-mono text-blue-700">v{v.versionNumber}</span> · {v.description}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                        Author: {v.creatorEmail} · {new Date(v.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {v.snapshotId && (
                      <span className="font-mono text-[11px] text-slate-500">
                        Backup: {v.snapshotId}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : (
        /* Deployments Tab */
        <>
          {canDeploy && (
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2">
                <Rocket className="h-4 w-4 text-blue-700" />
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Publish Verified Deployment (Web App or API Executable)
                </h2>
              </div>
              <form onSubmit={handleCreateDeployment} className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label htmlFor="dep-type" className="block text-xs font-medium text-slate-700">
                      Deployment Type
                    </label>
                    <select
                      id="dep-type"
                      value={deploymentType}
                      onChange={(e) =>
                        setDeploymentType(e.target.value as 'WEB_APP' | 'API_EXECUTABLE')
                      }
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                    >
                      <option value="WEB_APP">WEB_APP</option>
                      <option value="API_EXECUTABLE">API_EXECUTABLE (scripts.run)</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="dep-version" className="block text-xs font-medium text-slate-700">
                      Target Version
                    </label>
                    <select
                      id="dep-version"
                      value={deployVersion}
                      onChange={(e) => setDeployVersion(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                    >
                      <option value="">Auto-release new immutable version</option>
                      {versions.map((v) => (
                        <option key={v.id} value={v.versionNumber}>
                          v{v.versionNumber} — {v.description}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="dep-access" className="block text-xs font-medium text-slate-700">
                      Access Level
                    </label>
                    <select
                      id="dep-access"
                      value={accessLevel}
                      onChange={(e) => setAccessLevel(e.target.value as WebAppAccessLevel)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900"
                    >
                      <option value="MYSELF">MYSELF (Private Default)</option>
                      <option value="DOMAIN">DOMAIN (Workspace Org)</option>
                      <option value="ANYONE">ANYONE (Public Sign-in)</option>
                      <option value="ANYONE_ANONYMOUS">ANYONE_ANONYMOUS (Public)</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="dep-exec-as" className="block text-xs font-medium text-slate-700">
                      Execute As
                    </label>
                    <select
                      id="dep-exec-as"
                      value={executeAs}
                      onChange={(e) => setExecuteAs(e.target.value as WebAppExecuteAs)}
                      disabled={deploymentType === 'API_EXECUTABLE'}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 disabled:bg-slate-50"
                    >
                      <option value="USER_DEPLOYING">USER_DEPLOYING</option>
                      <option value="USER_ACCESSING">USER_ACCESSING</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <input
                    type="text"
                    required
                    aria-label="Deployment description"
                    value={deployDesc}
                    onChange={(e) => setDeployDesc(e.target.value)}
                    placeholder="Production Web App / API Executable deployment"
                    className="min-w-[240px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={busy !== null}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {busy === 'deploy' ? 'Deploying…' : 'Create Verified Deployment'}
                  </button>
                </div>

                {(accessLevel === 'ANYONE' || accessLevel === 'ANYONE_ANONYMOUS') && (
                  <label className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-900">
                    <input
                      type="checkbox"
                      checked={confirmPublic}
                      onChange={(e) => setConfirmPublic(e.target.checked)}
                    />
                    <GlobeLock className="h-4 w-4 shrink-0" />
                    Owner/Admin Confirmation: Expose this Web App beyond private MYSELF/DOMAIN access.
                  </label>
                )}
              </form>
            </section>
          )}

          {/* Active & Tracked Deployments */}
          <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Live Google Apps Script Deployments ({deployments.length})
            </h2>

            {loading ? (
              <p className="text-xs text-slate-500">Verifying live deployments against Apps Script API…</p>
            ) : deployments.length === 0 ? (
              <p className="text-xs text-slate-500">No active deployments yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {deployments.map((dep) => (
                  <div key={dep.deploymentId} className="space-y-2 p-4 text-xs">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {dep.deploymentType} · <span className="font-mono text-blue-700">v{dep.versionNumber}</span> · {dep.description}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                          ID: {dep.deploymentId} · Access: {dep.accessLevel || 'MYSELF'} · Status: {dep.status}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {canDeploy && dep.status === 'active' && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setUpdateTargetId(dep.deploymentId);
                                setUpdateVersionNum(String(versions[0]?.versionNumber || dep.versionNumber));
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Switch / Rollback
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRetireDeployment(dep.deploymentId)}
                              disabled={busy !== null}
                              aria-label={`Retire deployment ${dep.deploymentId}`}
                              className="rounded-md border border-rose-200 p-1.5 text-rose-700 hover:bg-rose-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {dep.webAppUrl && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                        <span className="truncate font-mono text-[11px] text-slate-800">
                          {dep.webAppUrl}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => navigator.clipboard?.writeText(dep.webAppUrl!)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 hover:underline"
                          >
                            <Copy className="h-3 w-3" /> Copy
                          </button>
                          <a
                            href={dep.webAppUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline"
                          >
                            Open URL <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {updateTargetId && canDeploy && (
              <form
                onSubmit={handleUpdateDeployment}
                className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-3 text-xs"
              >
                <p className="font-semibold text-slate-900">
                  Update / Rollback Deployment {updateTargetId}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    aria-label="Rollback target version"
                    value={updateVersionNum}
                    onChange={(e) => setUpdateVersionNum(e.target.value)}
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900"
                  >
                    {versions.map((v) => (
                      <option key={v.id} value={v.versionNumber}>
                        v{v.versionNumber} — {v.description}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={confirmProdReplace}
                      onChange={(e) => setConfirmProdReplace(e.target.checked)}
                    />
                    Confirm live deployment version change
                  </label>
                  <button
                    type="submit"
                    disabled={busy !== null || !confirmProdReplace}
                    className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50"
                  >
                    Apply Version
                  </button>
                  <button
                    type="button"
                    onClick={() => setUpdateTargetId('')}
                    className="text-slate-600 hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>
        </>
      )}
    </div>
  );
}
