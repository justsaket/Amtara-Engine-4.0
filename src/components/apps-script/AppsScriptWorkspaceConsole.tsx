'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Clock,
  Code2,
  FileCode2,
  FolderSearch,
  GitCommitHorizontal,
  KeyRound,
  Play,
  Rocket,
  Sliders,
  Stethoscope,
} from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type {
  AppsScriptFile,
  AppsScriptProjectRecord,
  AppsScriptSnapshotRecord,
} from '@/types/domain';
import { DeploymentsVersionsPanel } from './DeploymentsVersionsPanel';
import { DoctorPanel } from './DoctorPanel';
import { ExecutionTriggersAuditPanel } from './ExecutionTriggersAuditPanel';
import { GoogleOAuthHub } from './GoogleOAuthHub';
import { ProjectExplorerPanel } from './ProjectExplorerPanel';
import { SourceEditorPanel } from './SourceEditorPanel';

export type AppsScriptConsoleTab =
  | 'doctor'
  | 'explorer'
  | 'source'
  | 'manifest'
  | 'versions'
  | 'deployments'
  | 'execute'
  | 'triggers'
  | 'credentials';

const TABS: Array<{
  id: AppsScriptConsoleTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requiresProject?: boolean;
}> = [
  { id: 'doctor', label: 'Overview & Doctor', icon: Stethoscope },
  { id: 'explorer', label: 'Project Explorer', icon: FolderSearch },
  { id: 'source', label: 'Source Editor', icon: Code2, requiresProject: true },
  { id: 'manifest', label: 'Manifest Builder', icon: Sliders, requiresProject: true },
  { id: 'versions', label: 'Version Control', icon: GitCommitHorizontal, requiresProject: true },
  { id: 'deployments', label: 'Deployment Manager', icon: Rocket, requiresProject: true },
  { id: 'execute', label: 'Execution Center', icon: Play, requiresProject: true },
  { id: 'triggers', label: 'Trigger Manager', icon: Clock, requiresProject: true },
  { id: 'credentials', label: 'Credentials & Activity', icon: KeyRound },
];

export function AppsScriptWorkspaceConsole() {
  const { activeWorkspace } = useWorkspace();
  const [activeTab, setActiveTab] = useState<AppsScriptConsoleTab>('doctor');
  const [projects, setProjects] = useState<AppsScriptProjectRecord[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);

  const [selectedProject, setSelectedProject] = useState<AppsScriptProjectRecord | null>(null);
  const [projectFiles, setProjectFiles] = useState<AppsScriptFile[]>([]);
  const [projectSnapshots, setProjectSnapshots] = useState<AppsScriptSnapshotRecord[]>([]);
  const [loadingProject, setLoadingProject] = useState(false);

  const loadProjects = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const res = await apiRequest<{ projects: AppsScriptProjectRecord[] }>(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects`,
      );
      setProjects(res.projects);
      setSelectedScriptId((prev) =>
        prev && res.projects.some((p) => p.scriptId === prev)
          ? prev
          : res.projects[0]?.scriptId || null,
      );
    } catch {
      setProjects([]);
    }
  }, [activeWorkspace]);

  const loadSelectedProjectDetails = useCallback(async () => {
    if (!activeWorkspace || !selectedScriptId) {
      setSelectedProject(null);
      setProjectFiles([]);
      setProjectSnapshots([]);
      return;
    }
    setLoadingProject(true);
    try {
      const res = await apiRequest<{
        project: AppsScriptProjectRecord;
        files: AppsScriptFile[];
        snapshots: AppsScriptSnapshotRecord[];
      }>(
        `/api/workspaces/${activeWorkspace.id}/apps-script/projects/${selectedScriptId}`,
      );
      setSelectedProject(res.project);
      setProjectFiles(res.files);
      setProjectSnapshots(res.snapshots);
    } catch {
      const localMeta = projects.find((p) => p.scriptId === selectedScriptId) || null;
      setSelectedProject(localMeta);
    } finally {
      setLoadingProject(false);
    }
  }, [activeWorkspace, projects, selectedScriptId]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void loadSelectedProjectDetails();
  }, [loadSelectedProjectDetails]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
            Phase 2 · Google Access & Apps Script Control Plane
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900">
            Apps Script Center
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Authorize Google accounts, discover or create Apps Script projects, validate manifests, release immutable versions, deploy, execute, and monitor triggers.
          </p>
        </div>

        {projects.length > 0 && (
          <div className="min-w-[240px]">
            <label htmlFor="active-script-selector" className="block font-mono text-[10px] uppercase tracking-wider text-slate-500">
              Active Script Project
            </label>
            <select
              id="active-script-selector"
              value={selectedScriptId || ''}
              onChange={(e) => setSelectedScriptId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-700 focus:outline-none"
            >
              {projects.map((p) => (
                <option key={p.scriptId} value={p.scriptId}>
                  {p.title} ({p.scriptId.slice(0, 10)}…)
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 9-Tab Navigation Bar */}
      <div
        role="tablist"
        aria-label="Apps Script Control Center Modules"
        className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-2"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'doctor' && <DoctorPanel selectedScriptId={selectedScriptId || undefined} />}

      {activeTab === 'explorer' && (
        <ProjectExplorerPanel
          projects={projects}
          selectedScriptId={selectedScriptId}
          onSelectProject={(id) => {
            setSelectedScriptId(id);
            setActiveTab('source');
          }}
          onProjectsChanged={loadProjects}
        />
      )}

      {(activeTab === 'source' || activeTab === 'manifest') && (
        selectedProject ? (
          loadingProject && projectFiles.length === 0 ? (
            <p className="text-sm text-slate-500">Fetching live files from Google Apps Script API…</p>
          ) : (
            <SourceEditorPanel
              mode={activeTab}
              project={selectedProject}
              files={projectFiles}
              snapshots={projectSnapshots}
              onFilesChange={setProjectFiles}
              onReloadProject={loadSelectedProjectDetails}
            />
          )
        ) : (
          <EmptyProjectNotice onGoExplorer={() => setActiveTab('explorer')} />
        )
      )}

      {(activeTab === 'versions' || activeTab === 'deployments') && (
        selectedProject ? (
          <DeploymentsVersionsPanel mode={activeTab} project={selectedProject} />
        ) : (
          <EmptyProjectNotice onGoExplorer={() => setActiveTab('explorer')} />
        )
      )}

      {(activeTab === 'execute' || activeTab === 'triggers') && (
        selectedProject ? (
          <ExecutionTriggersAuditPanel mode={activeTab} project={selectedProject} />
        ) : (
          <EmptyProjectNotice onGoExplorer={() => setActiveTab('explorer')} />
        )
      )}

      {activeTab === 'credentials' && (
        <div className="space-y-8">
          <GoogleOAuthHub
            returnPath="/dashboard/apps-script"
            onConnectionChanged={loadProjects}
          />
          <ExecutionTriggersAuditPanel mode="audit" />
        </div>
      )}
    </div>
  );
}

function EmptyProjectNotice({ onGoExplorer }: { onGoExplorer: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
      <FileCode2 className="mx-auto h-8 w-8 text-slate-400" />
      <h2 className="mt-3 font-display text-base font-semibold text-slate-900">
        No Apps Script Project Selected
      </h2>
      <p className="mx-auto mt-1 max-w-md text-xs text-slate-600">
        Create a new project from one of Antara’s 8 starter templates or import an existing script from Google Drive in Project Explorer first.
      </p>
      <button
        type="button"
        onClick={onGoExplorer}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
      >
        <Activity className="h-3.5 w-3.5" />
        Open Project Explorer
      </button>
    </div>
  );
}
