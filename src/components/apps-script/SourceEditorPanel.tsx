'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  History,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import {
  buildDefaultManifest,
  parseAndValidateManifest,
  serializeManifest,
} from '@/lib/google/manifest';
import { validateAppsScriptProject } from '@/lib/google/validator';
import { hasPermission } from '@/lib/rbac';
import type {
  AppsScriptFile,
  AppsScriptProjectRecord,
  AppsScriptSnapshotRecord,
  WebAppAccessLevel,
  WebAppExecuteAs,
} from '@/types/domain';

interface DiffPreviewResponse {
  diff: {
    hasChanges: boolean;
    hasDeletions: boolean;
    deletedFileNames: string[];
    files: Array<{
      name: string;
      type: AppsScriptFile['type'];
      status: string;
    }>;
  };
  validation: ReturnType<typeof validateAppsScriptProject>;
}

export function SourceEditorPanel({
  mode,
  project,
  files,
  snapshots,
  onFilesChange,
  onReloadProject,
}: {
  mode: 'source' | 'manifest';
  project: AppsScriptProjectRecord;
  files: AppsScriptFile[];
  snapshots: AppsScriptSnapshotRecord[];
  onFilesChange: (next: AppsScriptFile[]) => void;
  onReloadProject: () => Promise<void> | void;
}) {
  const { activeWorkspace } = useWorkspace();
  const canWrite = hasPermission(activeWorkspace?.role, 'apps_script:write');

  const [selectedFileKey, setSelectedFileKey] = useState<string>(() => {
    const first = files.find((f) => f.type === 'SERVER_JS') || files[0];
    return first ? `${first.type}:${first.name}` : '';
  });
  const [newFileName, setNewFileName] = useState('');
  const [newFileType, setNewFileType] = useState<AppsScriptFile['type']>('SERVER_JS');
  const [changeSummary, setChangeSummary] = useState('Updated Apps Script source via Antara Studio');
  const [confirmDeletions, setConfirmDeletions] = useState(false);
  const [preview, setPreview] = useState<DiffPreviewResponse | null>(null);
  const [extraScopeInput, setExtraScopeInput] = useState('');

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeFile = useMemo(() => {
    return (
      files.find((f) => `${f.type}:${f.name}` === selectedFileKey) ||
      files[0] ||
      null
    );
  }, [files, selectedFileKey]);

  const localValidation = useMemo(
    () => validateAppsScriptProject({ scriptId: project.scriptId, files }),
    [project.scriptId, files],
  );

  const manifestFile = files.find(
    (f) => f.type === 'JSON' && (f.name === 'appsscript' || f.name === 'appsscript.json'),
  );
  const manifestParsed = useMemo(
    () =>
      manifestFile
        ? parseAndValidateManifest(manifestFile.source)
        : parseAndValidateManifest(serializeManifest(buildDefaultManifest())),
    [manifestFile],
  );

  function updateManifestObject(
    updater: (prev: NonNullable<typeof manifestParsed.manifest>) => NonNullable<typeof manifestParsed.manifest>,
  ) {
    const base = manifestParsed.manifest || buildDefaultManifest();
    const updatedJson = serializeManifest(updater(base));
    const idx = files.findIndex(
      (f) => f.type === 'JSON' && (f.name === 'appsscript' || f.name === 'appsscript.json'),
    );
    if (idx >= 0) {
      const next = [...files];
      next[idx] = { ...next[idx]!, source: updatedJson };
      onFilesChange(next);
    } else {
      onFilesChange([
        ...files,
        { name: 'appsscript', type: 'JSON', source: updatedJson },
      ]);
    }
  }

  function handleUpdateActiveSource(nextSource: string) {
    if (!activeFile) return;
    onFilesChange(
      files.map((f) =>
        f.type === activeFile.type && f.name === activeFile.name
          ? { ...f, source: nextSource }
          : f,
      ),
    );
  }

  function handleAddFile(e: React.FormEvent) {
    e.preventDefault();
    const clean = newFileName.trim().replace(/\.(gs|html|json)$/i, '');
    if (!clean) return;
    if (files.some((f) => f.type === newFileType && f.name === clean)) {
      setError(`A ${newFileType} file named "${clean}" already exists.`);
      return;
    }
    const templateSource =
      newFileType === 'SERVER_JS'
        ? `function ${clean.replace(/[^a-zA-Z0-9_]/g, '_')}Task() {\n  return { ok: true };\n}\n`
        : newFileType === 'HTML'
          ? '<!DOCTYPE html>\n<html>\n  <body>\n    <h1>Antara Template</h1>\n  </body>\n</html>\n'
          : '{\n  "ok": true\n}\n';

    const next = [...files, { name: clean, type: newFileType, source: templateSource }];
    onFilesChange(next);
    setSelectedFileKey(`${newFileType}:${clean}`);
    setNewFileName('');
    setError(null);
  }

  function handleDeleteFile(target: AppsScriptFile) {
    if (target.name === 'appsscript' || target.name === 'appsscript.json') {
      setError('Cannot delete mandatory manifest file appsscript.json.');
      return;
    }
    onFilesChange(
      files.filter((f) => !(f.type === target.type && f.name === target.name)),
    );
  }

  async function handlePreviewDiff() {
    if (!activeWorkspace) return;
    setBusy('preview');
    setError(null);
    try {
      const res = await apiRequest<DiffPreviewResponse>(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/content?preview=true`,
        {
          method: 'PUT',
          body: JSON.stringify({
            files,
            changeSummary,
            confirmDestructiveChanges: confirmDeletions,
          }),
        },
      );
      setPreview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview diff failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleProtectedPush() {
    if (!activeWorkspace || !canWrite) return;
    setBusy('push');
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{
        preUpdateSnapshotId: string;
        verifiedFileParity: boolean;
      }>(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/content`,
        {
          method: 'PUT',
          body: JSON.stringify({
            files,
            changeSummary,
            confirmDestructiveChanges: confirmDeletions,
          }),
        },
      );
      setPreview(null);
      setConfirmDeletions(false);
      setNotice(
        `Protected push succeeded (backup snapshot: ${res.preUpdateSnapshotId}; remote parity verified: ${res.verifiedFileParity ? 'yes' : 'pending'}).`,
      );
      await onReloadProject();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remote project update failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleRestoreSnapshot(snapshotId: string) {
    if (!activeWorkspace || !canWrite) return;
    setBusy(`restore_${snapshotId}`);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}/content`,
        {
          method: 'POST',
          body: JSON.stringify({ snapshotId }),
        },
      );
      setNotice(`Restored project files safely from snapshot ${snapshotId}.`);
      await onReloadProject();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Snapshot restore failed.');
    } finally {
      setBusy(null);
    }
  }

  const m = manifestParsed.manifest || buildDefaultManifest();

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

      {mode === 'manifest' ? (
        <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Visual Manifest Builder (appsscript.json)
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Defaults safely to Asia/Kolkata timezone, V8 runtime, STACKDRIVER exception logging, and private MYSELF deployment access.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="manifest-tz" className="block text-xs font-medium text-slate-700">
                Time Zone
              </label>
              <input
                id="manifest-tz"
                type="text"
                value={m.timeZone}
                onChange={(e) =>
                  updateManifestObject((prev) => ({ ...prev, timeZone: e.target.value }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="manifest-runtime" className="block text-xs font-medium text-slate-700">
                Runtime Version
              </label>
              <select
                id="manifest-runtime"
                value={m.runtimeVersion}
                onChange={(e) =>
                  updateManifestObject((prev) => ({
                    ...prev,
                    runtimeVersion: e.target.value === 'DEPRECATED_ES5' ? 'DEPRECATED_ES5' : 'V8',
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              >
                <option value="V8">V8 (Recommended)</option>
                <option value="DEPRECATED_ES5">DEPRECATED_ES5 (Legacy Rhino)</option>
              </select>
            </div>
            <div>
              <label htmlFor="manifest-logging" className="block text-xs font-medium text-slate-700">
                Exception Logging
              </label>
              <select
                id="manifest-logging"
                value={m.exceptionLogging}
                onChange={(e) =>
                  updateManifestObject((prev) => ({
                    ...prev,
                    exceptionLogging: e.target.value === 'NONE' ? 'NONE' : 'STACKDRIVER',
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              >
                <option value="STACKDRIVER">STACKDRIVER</option>
                <option value="NONE">NONE</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 border-t border-slate-100 pt-4">
            <div>
              <label htmlFor="manifest-webapp-access" className="block text-xs font-medium text-slate-700">
                Web App Access Level
              </label>
              <select
                id="manifest-webapp-access"
                value={m.webapp?.access || 'MYSELF'}
                onChange={(e) =>
                  updateManifestObject((prev) => ({
                    ...prev,
                    webapp: {
                      access: e.target.value as WebAppAccessLevel,
                      executeAs: prev.webapp?.executeAs || 'USER_DEPLOYING',
                    },
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              >
                <option value="MYSELF">MYSELF (Private Safe Default)</option>
                <option value="DOMAIN">DOMAIN (Workspace Org)</option>
                <option value="ANYONE">ANYONE (Signed-in Google Users)</option>
                <option value="ANYONE_ANONYMOUS">ANYONE_ANONYMOUS (Public Internet)</option>
              </select>
            </div>

            <div>
              <label htmlFor="manifest-webapp-exec" className="block text-xs font-medium text-slate-700">
                Web App Execute As
              </label>
              <select
                id="manifest-webapp-exec"
                value={m.webapp?.executeAs || 'USER_DEPLOYING'}
                onChange={(e) =>
                  updateManifestObject((prev) => ({
                    ...prev,
                    webapp: {
                      access: prev.webapp?.access || 'MYSELF',
                      executeAs: e.target.value as WebAppExecuteAs,
                    },
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              >
                <option value="USER_DEPLOYING">USER_DEPLOYING</option>
                <option value="USER_ACCESSING">USER_ACCESSING</option>
              </select>
            </div>

            <div>
              <label htmlFor="manifest-execapi" className="block text-xs font-medium text-slate-700">
                Execution API Access
              </label>
              <select
                id="manifest-execapi"
                value={m.executionApi?.access || 'MYSELF'}
                onChange={(e) =>
                  updateManifestObject((prev) => ({
                    ...prev,
                    executionApi: {
                      access: e.target.value as 'MYSELF' | 'DOMAIN' | 'ANYONE',
                    },
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              >
                <option value="MYSELF">MYSELF</option>
                <option value="DOMAIN">DOMAIN</option>
                <option value="ANYONE">ANYONE</option>
              </select>
            </div>
          </div>

          {manifestParsed.publicAccessWarning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <span>
                Public Web App access configured. Deployment creation will require explicit Owner/Admin public confirmation.
              </span>
            </div>
          )}

          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-medium text-slate-700">
              Declared OAuth Scopes ({(m.oauthScopes || []).length})
            </p>
            <div className="mt-2 space-y-1.5">
              {(m.oauthScopes || []).map((scope) => (
                <div
                  key={scope}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-[11px] text-slate-800"
                >
                  <span className="truncate">{scope}</span>
                  <button
                    type="button"
                    onClick={() =>
                      updateManifestObject((prev) => ({
                        ...prev,
                        oauthScopes: (prev.oauthScopes || []).filter((s) => s !== scope),
                      }))
                    }
                    className="ml-2 text-rose-700 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                aria-label="Add OAuth scope to manifest"
                value={extraScopeInput}
                onChange={(e) => setExtraScopeInput(e.target.value)}
                placeholder="https://www.googleapis.com/auth/spreadsheets.readonly"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  const trimmed = extraScopeInput.trim();
                  if (!trimmed) return;
                  updateManifestObject((prev) => ({
                    ...prev,
                    oauthScopes: Array.from(new Set([...(prev.oauthScopes || []), trimmed])),
                  }));
                  setExtraScopeInput('');
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
              >
                Add Scope
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="font-mono text-[11px] uppercase text-slate-500">Live Manifest JSON Preview</p>
            <pre className="mt-2 overflow-x-auto font-mono text-xs text-slate-900">
              {serializeManifest(m)}
            </pre>
          </div>
        </section>
      ) : (
        /* Mode === 'source' */
        <div className="grid gap-6 lg:grid-cols-12">
          {/* File Sidebar */}
          <div className="space-y-4 lg:col-span-4">
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Project Files ({files.length})
              </p>
              <div className="mt-3 space-y-1">
                {files.map((f) => {
                  const key = `${f.type}:${f.name}`;
                  const active =
                    activeFile && activeFile.type === f.type && activeFile.name === f.name;
                  return (
                    <div
                      key={key}
                      className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-xs ${
                        active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedFileKey(key)}
                        className="min-w-0 flex-1 truncate text-left font-medium"
                      >
                        {f.name}{' '}
                        <span className={`font-mono text-[10px] ${active ? 'text-slate-300' : 'text-slate-400'}`}>
                          ({f.type})
                        </span>
                      </button>
                      {canWrite && f.name !== 'appsscript' && f.name !== 'appsscript.json' && (
                        <button
                          type="button"
                          onClick={() => handleDeleteFile(f)}
                          aria-label={`Delete file ${f.name}`}
                          className={`ml-2 p-1 ${active ? 'text-rose-300 hover:text-white' : 'text-rose-600'}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {canWrite && (
                <form onSubmit={handleAddFile} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      aria-label="New Apps Script file name"
                      value={newFileName}
                      onChange={(e) => setNewFileName(e.target.value)}
                      placeholder="Helper"
                      className="min-w-0 flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                    />
                    <select
                      aria-label="New file type"
                      value={newFileType}
                      onChange={(e) => setNewFileType(e.target.value as AppsScriptFile['type'])}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800"
                    >
                      <option value="SERVER_JS">.gs</option>
                      <option value="HTML">.html</option>
                      <option value="JSON">.json</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                  >
                    <FilePlus2 className="h-3.5 w-3.5" />
                    Add File to Draft
                  </button>
                </form>
              )}
            </section>

            {/* Static Validation Report */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-900">Static Pre-Deployment Check</p>
                <span
                  className={`font-mono text-[11px] font-semibold ${
                    localValidation.valid ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {localValidation.valid ? 'VALID' : 'ERRORS'}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                {localValidation.staticAnalysisDisclaimer}
              </p>
              {localValidation.diagnostics.length === 0 ? (
                <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> No static warnings or errors detected.
                </p>
              ) : (
                <div className="max-h-48 space-y-1.5 overflow-y-auto">
                  {localValidation.diagnostics.map((d, i) => (
                    <div
                      key={`${d.code}-${i}`}
                      className="rounded-md border border-slate-100 bg-slate-50 p-2 text-[11px]"
                    >
                      <span
                        className={`font-mono font-semibold ${
                          d.severity === 'error'
                            ? 'text-rose-700'
                            : d.severity === 'warning'
                              ? 'text-amber-700'
                              : 'text-blue-700'
                        }`}
                      >
                        [{d.severity.toUpperCase()}] {d.file}
                        {d.line ? `:${d.line}` : ''}
                      </span>
                      <p className="mt-0.5 text-slate-700">{d.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Code Editor */}
          <div className="space-y-4 lg:col-span-8">
            <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-mono text-sm font-semibold text-slate-900">
                    {activeFile ? `${activeFile.name} (${activeFile.type})` : 'Select a file'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Changes stay local in your draft until submitted via the Protected Remote Push pipeline.
                  </p>
                </div>
              </div>

              {activeFile && (
                <textarea
                  aria-label={`Source editor for ${activeFile.name}`}
                  value={activeFile.source}
                  readOnly={!canWrite}
                  onChange={(e) => handleUpdateActiveSource(e.target.value)}
                  rows={18}
                  spellCheck={false}
                  className="w-full rounded-lg border border-slate-200 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100 focus:border-blue-600 focus:outline-none"
                />
              )}
            </section>
          </div>
        </div>
      )}

      {/* Shared Protected Remote Push Footer & Snapshots */}
      {canWrite && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              Protected Remote Push (Automatic Pre-Update Snapshot + Hash Verification)
            </h3>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label htmlFor="push-summary" className="block text-xs font-medium text-slate-700">
                Change Summary (Saved on Backup Snapshot & Audit Log)
              </label>
              <input
                id="push-summary"
                type="text"
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={handlePreviewDiff}
                disabled={busy !== null}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
              >
                {busy === 'preview' ? 'Diffing…' : 'Preview Diff'}
              </button>
              <button
                type="button"
                onClick={handleProtectedPush}
                disabled={busy !== null || !localValidation.valid}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {busy === 'push' ? 'Pushing…' : 'Save Remotely'}
              </button>
            </div>
          </div>

          {preview && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs space-y-2">
              <p className="font-semibold text-slate-900">
                Remote Diff Preview ({preview.diff.hasChanges ? 'Changes Ready' : 'No Remote Changes'})
              </p>
              <div className="flex flex-wrap gap-2">
                {preview.diff.files.map((f) => (
                  <span
                    key={`${f.type}:${f.name}`}
                    className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700"
                  >
                    {f.name}: {f.status}
                  </span>
                ))}
              </div>
              {preview.diff.hasDeletions && (
                <label className="flex items-center gap-2 pt-2 font-medium text-rose-800">
                  <input
                    type="checkbox"
                    checked={confirmDeletions}
                    onChange={(e) => setConfirmDeletions(e.target.checked)}
                  />
                  Confirm deletion of file(s): {preview.diff.deletedFileNames.join(', ')}
                </label>
              )}
            </div>
          )}

          {!preview && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={confirmDeletions}
                onChange={(e) => setConfirmDeletions(e.target.checked)}
              />
              Confirm remote file deletions if any files were removed from draft.
            </label>
          )}
        </section>
      )}

      {/* Immutable Snapshot History & Restore */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-slate-700" />
          <h3 className="text-sm font-semibold text-slate-900">
            Backup Snapshots ({snapshots.length})
          </h3>
        </div>
        {snapshots.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            Snapshots are created automatically before every remote code push or version release.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {snapshots.slice(0, 8).map((snap) => (
              <div key={snap.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
                <div>
                  <p className="font-medium text-slate-900">{snap.changeSummary}</p>
                  <p className="font-mono text-[11px] text-slate-500">
                    {snap.id} · {snap.reason} · {snap.files.length} files · Hash:{' '}
                    {snap.contentHash.slice(0, 10)}…
                  </p>
                </div>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => handleRestoreSnapshot(snap.id)}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Restore
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
