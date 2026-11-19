'use client';

import React, { useState } from 'react';
import {
  ExternalLink,
  FileCode2,
  FolderSearch,
  Link2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import { APPS_SCRIPT_TEMPLATES } from '@/lib/google/templates';
import { hasPermission } from '@/lib/rbac';
import type { AppsScriptProjectRecord } from '@/types/domain';

interface DiscoveredFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  owners: Array<{ displayName?: string; emailAddress?: string }>;
  webViewLink?: string;
  canEdit?: boolean;
}

export function ProjectExplorerPanel({
  projects,
  selectedScriptId,
  onSelectProject,
  onProjectsChanged,
}: {
  projects: AppsScriptProjectRecord[];
  selectedScriptId: string | null;
  onSelectProject: (scriptId: string) => void;
  onProjectsChanged: () => Promise<void> | void;
}) {
  const { activeWorkspace } = useWorkspace();
  const canWrite = hasPermission(activeWorkspace?.role, 'apps_script:write');

  const [newTitle, setNewTitle] = useState('');
  const [parentId, setParentId] = useState('');
  const [templateKey, setTemplateKey] = useState('antara_base_automation');
  const [manualScriptId, setManualScriptId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [discovered, setDiscovered] = useState<DiscoveredFile[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !canWrite || !newTitle.trim()) return;
    setBusy('create');
    setError(null);
    setNotice(null);
    try {
      const idempotencyKey = `create_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const res = await apiRequest<{ project: AppsScriptProjectRecord }>(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: newTitle.trim(),
            ...(parentId.trim() ? { parentId: parentId.trim() } : {}),
            templateKey,
            idempotencyKey,
          }),
        },
      );
      setNewTitle('');
      setParentId('');
      setNotice(`Created Google Apps Script project "${res.project.title}" (${res.project.scriptId}).`);
      await onProjectsChanged();
      onSelectProject(res.project.scriptId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create Apps Script project.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDiscoverDrive(pageToken?: string) {
    if (!activeWorkspace) return;
    setBusy('discover');
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (pageToken) params.set('pageToken', pageToken);
      const res = await apiRequest<{
        files: DiscoveredFile[];
        nextPageToken?: string;
      }>(
        `/api/workspaces/${activeWorkspace.id}/apps-script/discover?${params.toString()}`,
      );
      setDiscovered((prev) => (pageToken ? [...prev, ...res.files] : res.files));
      setNextPageToken(res.nextPageToken);
      if (!pageToken && res.files.length === 0) {
        setNotice('No eligible Google Apps Script projects matched your Drive search.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Drive discovery failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleImportScript(scriptId: string, title?: string) {
    if (!activeWorkspace || !canWrite) return;
    setBusy(`import_${scriptId}`);
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ project: AppsScriptProjectRecord }>(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects`,
        {
          method: 'POST',
          body: JSON.stringify({
            mode: 'import',
            scriptId: scriptId.trim(),
            ...(title ? { title } : {}),
          }),
        },
      );
      setManualScriptId('');
      setNotice(`Linked "${res.project.title}" (${res.project.scriptId}) with initial snapshot backup.`);
      await onProjectsChanged();
      onSelectProject(res.project.scriptId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to link Apps Script project.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDetach(project: AppsScriptProjectRecord) {
    if (!activeWorkspace || !canWrite) return;
    setBusy(`detach_${project.scriptId}`);
    setError(null);
    try {
      await apiRequest(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${project.scriptId}`,
        { method: 'DELETE' },
      );
      setNotice(`Detached "${project.title}" from Antara workspace (remote Google script remains safe).`);
      await onProjectsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to detach project.');
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

      {/* Linked Projects List */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-display text-base font-semibold text-slate-900">
          Workspace Linked Apps Script Projects
        </h2>
        <p className="mt-0.5 text-xs text-slate-600">
          Select an active project to inspect source files, validate manifests, release versions, or deploy.
        </p>

        {projects.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
            No Apps Script projects linked to this workspace yet. Create from a template or discover from Google Drive below.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {projects.map((p) => {
              const selected = p.scriptId === selectedScriptId;
              return (
                <div
                  key={p.scriptId}
                  className={`flex flex-wrap items-center justify-between gap-3 p-4 ${
                    selected ? 'bg-blue-50/50' : 'bg-white'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FileCode2 className="h-4 w-4 shrink-0 text-blue-700" />
                      <button
                        type="button"
                        onClick={() => onSelectProject(p.scriptId)}
                        className="truncate text-left text-sm font-semibold text-slate-900 hover:text-blue-700"
                      >
                        {p.title}
                      </button>
                      {selected && (
                        <span className="font-mono text-[11px] font-semibold text-blue-700">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-slate-500">
                      scriptId: {p.scriptId} · {p.projectType} · {p.ownershipKind.replace(/_/g, ' ')}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectProject(p.scriptId)}
                      className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                    >
                      {selected ? 'Selected' : 'Open'}
                    </button>
                    <a
                      href={p.editorUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${p.title} in Google Apps Script`}
                      className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => handleDetach(p)}
                        disabled={busy !== null}
                        aria-label={`Detach ${p.title}`}
                        className="rounded-md border border-rose-200 p-1.5 text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Create New Project from Starter Templates */}
        {canWrite && (
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-blue-700" />
              <h2 className="font-display text-base font-semibold text-slate-900">
                Create Apps Script Project from Template
              </h2>
            </div>
            <form onSubmit={handleCreateProject} className="mt-4 space-y-4">
              <div>
                <label htmlFor="new-script-title" className="block text-xs font-medium text-slate-700">
                  Project Title
                </label>
                <input
                  id="new-script-title"
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Antara Workspace Reporter"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="new-script-template" className="block text-xs font-medium text-slate-700">
                  Antara Starter Template (8 Templates)
                </label>
                <select
                  id="new-script-template"
                  value={templateKey}
                  onChange={(e) => setTemplateKey(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                >
                  {APPS_SCRIPT_TEMPLATES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.name} ({t.category})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  {APPS_SCRIPT_TEMPLATES.find((t) => t.key === templateKey)?.purpose}
                </p>
              </div>

              <div>
                <label htmlFor="new-script-parent" className="block text-xs font-medium text-slate-700">
                  Container Parent File ID (Optional — for Spreadsheet/Doc Bound Scripts)
                </label>
                <input
                  id="new-script-parent"
                  type="text"
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  placeholder="Leave blank for standalone Apps Script"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={busy !== null}
                className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busy === 'create' ? 'Creating Remote Project…' : 'Create & Initialize in Google'}
              </button>
            </form>
          </section>
        )}

        {/* Drive Discovery & Manual Import */}
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-2">
            <FolderSearch className="h-4 w-4 text-blue-700" />
            <h2 className="font-display text-base font-semibold text-slate-900">
              Discover Existing Google Drive Scripts
            </h2>
          </div>

          <div className="mt-4 flex gap-2">
            <input
              type="text"
              aria-label="Search Apps Script title in Google Drive"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search script name in Drive…"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => handleDiscoverDrive()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Search className="h-3.5 w-3.5" />
              {busy === 'discover' ? 'Listing…' : 'Discover'}
            </button>
          </div>

          {discovered.length > 0 && (
            <div className="mt-3 max-h-60 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {discovered.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-100 p-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-900">{file.name}</p>
                    <p className="truncate font-mono text-[10px] text-slate-500">
                      ID: {file.id}
                      {file.owners[0]?.emailAddress ? ` · Owner: ${file.owners[0].emailAddress}` : ''}
                    </p>
                  </div>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => handleImportScript(file.id, file.name)}
                      disabled={busy !== null}
                      className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100"
                    >
                      Import
                    </button>
                  )}
                </div>
              ))}
              {nextPageToken && (
                <button
                  type="button"
                  onClick={() => handleDiscoverDrive(nextPageToken)}
                  className="w-full rounded-md border border-slate-200 py-1.5 text-xs font-medium text-blue-700 hover:bg-slate-50"
                >
                  Load Next Page
                </button>
              )}
            </div>
          )}

          {canWrite && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <label htmlFor="manual-script-id" className="block text-xs font-medium text-slate-700">
                Or Link Directly by Script ID
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="manual-script-id"
                  type="text"
                  value={manualScriptId}
                  onChange={(e) => setManualScriptId(e.target.value)}
                  placeholder="1AbCdEfGhIjKlMnOpQrStUvWxYz..."
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!manualScriptId.trim() || busy !== null}
                  onClick={() => handleImportScript(manualScriptId)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Link Script
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
