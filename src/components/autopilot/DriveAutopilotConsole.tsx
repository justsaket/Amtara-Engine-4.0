'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  FolderSync,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  SkipForward,
  Sliders,
  Trash2,
  Unlink,
  Video,
} from 'lucide-react';
import { useWorkspace } from '@/components/providers/WorkspaceContext';
import { apiRequest } from '@/lib/api-client';
import type {
  BrandProfile,
  ConnectedSocialAccount,
  GoogleConnectionRecord,
} from '@/types/domain';
import type {
  AutopilotDashboardCounts,
  AutopilotDriveFileRecord,
  AutopilotExecutionEvent,
  AutopilotExecutionMode,
  AutopilotHashtagStrategy,
  AutopilotJobRecord,
  AutopilotOrderingMode,
  AutopilotPolicy,
  DriveFolderItem,
} from '@/types/autopilot';

interface AutopilotSnapshotResponse {
  policies: AutopilotPolicy[];
  files: AutopilotDriveFileRecord[];
  jobs: AutopilotJobRecord[];
  events: AutopilotExecutionEvent[];
  countsByPolicy: Record<string, AutopilotDashboardCounts>;
  googleConnections: GoogleConnectionRecord[];
  socialAccounts: ConnectedSocialAccount[];
  brands: BrandProfile[];
}

const WEEKDAYS = [
  { day: 0, label: 'Sun' },
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
];

function statusTone(status: string): string {
  switch (status) {
    case 'active':
    case 'published':
    case 'ok':
      return 'text-emerald-700';
    case 'scheduled':
    case 'analyzed':
    case 'publishing':
    case 'claimed':
    case 'running':
      return 'text-blue-700';
    case 'awaiting_approval':
    case 'paused':
    case 'paused_cost_limit':
    case 'publish_status_unknown':
    case 'warning':
      return 'text-amber-700';
    case 'failed':
    case 'dead_letter':
    case 'paused_auth_expired':
    case 'paused_policy_violation':
    case 'inaccessible':
    case 'error':
      return 'text-rose-700';
    default:
      return 'text-slate-600';
  }
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DriveAutopilotConsole() {
  const { activeWorkspace } = useWorkspace();
  const [snapshot, setSnapshot] = useState<AutopilotSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedPolicyId, setSelectedPolicyId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'videos' | 'queue' | 'policy' | 'history'>('videos');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Folder picker state
  const [pickerFolders, setPickerFolders] = useState<DriveFolderItem[]>([]);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);

  // Create Policy form state
  const [newName, setNewName] = useState('');
  const [newBrandId, setNewBrandId] = useState('');
  const [newConnectionId, setNewConnectionId] = useState('');
  const [newFolderId, setNewFolderId] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [newIncludeSubfolders, setNewIncludeSubfolders] = useState(true);
  const [newDestinationIds, setNewDestinationIds] = useState<string[]>([]);
  const [newAutoPublishIds, setNewAutoPublishIds] = useState<string[]>([]);
  const [newExecutionMode, setNewExecutionMode] = useState<AutopilotExecutionMode>('APPROVAL_REQUIRED');
  const [newMaxPostsPerDay, setNewMaxPostsPerDay] = useState(2);
  const [newMinGapMinutes, setNewMinGapMinutes] = useState(180);
  const [newPublishingDays, setNewPublishingDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [newStartHour, setNewStartHour] = useState(10);
  const [newEndHour, setNewEndHour] = useState(20);
  const [newTimezone, setNewTimezone] = useState('Asia/Kolkata');
  const [newOrderingMode, setNewOrderingMode] = useState<AutopilotOrderingMode>('chronological');
  const [newLanguage, setNewLanguage] = useState('English');
  const [newCaptionStyle, setNewCaptionStyle] = useState(
    'Clear, authentic, grounded in the actual video without hype',
  );
  const [newHashtagStrategy, setNewHashtagStrategy] = useState<AutopilotHashtagStrategy>('balanced');
  const [newMaxHashtags, setNewMaxHashtags] = useState(8);
  const [newMaxCostUsd, setNewMaxCostUsd] = useState(5);

  // Edit active policy state
  const [editMaxPostsPerDay, setEditMaxPostsPerDay] = useState(2);
  const [editMinGapMinutes, setEditMinGapMinutes] = useState(180);
  const [editExecutionMode, setEditExecutionMode] = useState<AutopilotExecutionMode>('APPROVAL_REQUIRED');
  const [editDestinationIds, setEditDestinationIds] = useState<string[]>([]);
  const [editAutoPublishIds, setEditAutoPublishIds] = useState<string[]>([]);
  const [editPublishingDays, setEditPublishingDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [editStartHour, setEditStartHour] = useState(10);
  const [editEndHour, setEditEndHour] = useState(20);
  const [editTimezone, setEditTimezone] = useState('Asia/Kolkata');
  const [editLanguage, setEditLanguage] = useState('English');
  const [editCaptionStyle, setEditCaptionStyle] = useState('');
  const [editMaxCostUsd, setEditMaxCostUsd] = useState(5);

  // Video inspection & metadata editor state
  const [inspectFileId, setInspectFileId] = useState<string | null>(null);
  const [metaTitle, setMetaTitle] = useState('');
  const [metaHook, setMetaHook] = useState('');
  const [metaIgCaption, setMetaIgCaption] = useState('');
  const [metaYtTitle, setMetaYtTitle] = useState('');
  const [metaYtDesc, setMetaYtDesc] = useState('');
  const [metaHashtags, setMetaHashtags] = useState('');
  const [metaCta, setMetaCta] = useState('');
  const [metaThumbnail, setMetaThumbnail] = useState('');

  const loadSnapshot = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<AutopilotSnapshotResponse>(
        `/api/workspaces/${activeWorkspace.id}/autopilot`,
      );
      setSnapshot(res);
      if (res.policies.length > 0 && !selectedPolicyId) {
        setSelectedPolicyId(res.policies[0].id);
      } else if (
        selectedPolicyId &&
        !res.policies.some((p) => p.id === selectedPolicyId)
      ) {
        setSelectedPolicyId(res.policies[0]?.id || '');
      }
      if (!newBrandId && res.brands[0]) setNewBrandId(res.brands[0].id);
      const connectedGoogle = res.googleConnections.find((c) => c.status === 'connected');
      if (!newConnectionId && connectedGoogle) setNewConnectionId(connectedGoogle.id);
      if (activeWorkspace.timezone) setNewTimezone(activeWorkspace.timezone);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Drive Autopilot dashboard.');
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace, selectedPolicyId, newBrandId, newConnectionId]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const activePolicy = useMemo(() => {
    if (!snapshot) return null;
    return snapshot.policies.find((p) => p.id === selectedPolicyId) || snapshot.policies[0] || null;
  }, [snapshot, selectedPolicyId]);

  useEffect(() => {
    if (!activePolicy) return;
    setEditMaxPostsPerDay(activePolicy.maxPostsPerDay);
    setEditMinGapMinutes(activePolicy.minGapMinutes);
    setEditExecutionMode(activePolicy.executionMode);
    setEditDestinationIds(activePolicy.destinationAccountIds);
    setEditAutoPublishIds(activePolicy.authorizedAutoPublishAccountIds);
    setEditPublishingDays(activePolicy.publishingDays);
    setEditStartHour(activePolicy.dailyTimeWindows[0]?.startHour ?? 10);
    setEditEndHour(activePolicy.dailyTimeWindows[0]?.endHour ?? 20);
    setEditTimezone(activePolicy.timezone);
    setEditLanguage(activePolicy.language);
    setEditCaptionStyle(activePolicy.captionStyle);
    setEditMaxCostUsd(activePolicy.maxProcessingCostUsdPerDay);
  }, [activePolicy]);

  const activeCounts = activePolicy && snapshot ? snapshot.countsByPolicy[activePolicy.id] : null;

  const activeFiles = useMemo(() => {
    if (!snapshot || !activePolicy) return [];
    return snapshot.files.filter((f) => f.policyId === activePolicy.id);
  }, [snapshot, activePolicy]);

  const activeJobs = useMemo(() => {
    if (!snapshot || !activePolicy) return [];
    return snapshot.jobs.filter((j) => j.policyId === activePolicy.id);
  }, [snapshot, activePolicy]);

  const activeEvents = useMemo(() => {
    if (!snapshot || !activePolicy) return [];
    return snapshot.events.filter((e) => e.policyId === activePolicy.id);
  }, [snapshot, activePolicy]);

  const inspectedFile = useMemo(
    () => activeFiles.find((f) => f.id === inspectFileId) || null,
    [activeFiles, inspectFileId],
  );

  const openFileInspector = (file: AutopilotDriveFileRecord) => {
    setInspectFileId(file.id);
    setMetaTitle(file.generatedMetadata?.contentTitle || '');
    setMetaHook(file.generatedMetadata?.openingHook || '');
    setMetaIgCaption(file.generatedMetadata?.instagramCaption || '');
    setMetaYtTitle(file.generatedMetadata?.youtubeTitle || '');
    setMetaYtDesc(file.generatedMetadata?.youtubeDescription || '');
    setMetaHashtags((file.generatedMetadata?.hashtags || []).join(' '));
    setMetaCta(file.generatedMetadata?.cta || '');
    setMetaThumbnail(file.generatedMetadata?.suggestedThumbnailText || '');
  };

  const connectedGoogleAccounts = useMemo(
    () => (snapshot?.googleConnections || []).filter((c) => c.status === 'connected'),
    [snapshot],
  );

  const publishingAccounts = useMemo(
    () =>
      (snapshot?.socialAccounts || []).filter(
        (a) => a.provider !== 'canva' && a.provider !== 'meta_ads',
      ),
    [snapshot],
  );

  const activeGoogleConnection = useMemo(() => {
    if (!activePolicy || !snapshot) return connectedGoogleAccounts[0] || null;
    return (
      snapshot.googleConnections.find((c) => c.id === activePolicy.googleConnectionId) ||
      connectedGoogleAccounts[0] ||
      null
    );
  }, [activePolicy, snapshot, connectedGoogleAccounts]);

  const hasDriveReadScope = Boolean(
    activeGoogleConnection?.grantedScopes.some(
      (s) =>
        s === 'https://www.googleapis.com/auth/drive.readonly' ||
        s === 'https://www.googleapis.com/auth/drive',
    ),
  );

  async function handleConnectGoogleDrive() {
    if (!activeWorkspace) return;
    setBusyAction('connect_drive');
    setError(null);
    try {
      const res = await apiRequest<{ authorizeUrl: string }>('/api/integrations/google/authorize', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId: activeWorkspace.id,
          intent: connectedGoogleAccounts.length > 0 ? 'incremental_scope' : 'connect',
          capabilityIds: ['google_identity', 'drive_autopilot_read'],
          returnPath: '/dashboard/autopilot',
        }),
      });
      window.location.href = res.authorizeUrl;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to start Google Drive OAuth authorization.',
      );
      setBusyAction(null);
    }
  }

  async function handleDisconnectGoogleDrive(connectionId: string) {
    if (!activeWorkspace) return;
    setBusyAction('disconnect_drive');
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/integrations/google/connections/${connectionId}`, {
        method: 'DELETE',
        body: JSON.stringify({ workspaceId: activeWorkspace.id }),
      });
      setNotice('Disconnected Google Drive account. Autopilot policies using it will pause automatically.');
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to disconnect Google Drive account.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleLoadFolderPicker() {
    if (!activeWorkspace) return;
    setPickerLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (newConnectionId) qs.set('connectionId', newConnectionId);
      if (pickerQuery.trim()) qs.set('q', pickerQuery.trim());
      const res = await apiRequest<{ folders: DriveFolderItem[] }>(
        `/api/workspaces/${activeWorkspace.id}/autopilot/folders?${qs.toString()}`,
      );
      setPickerFolders(res.folders);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to list Google Drive folders.');
    } finally {
      setPickerLoading(false);
    }
  }

  async function handleCreatePolicy(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setBusyAction('create_policy');
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{ policy: AutopilotPolicy }>(
        `/api/workspaces/${activeWorkspace.id}/autopilot`,
        {
          method: 'POST',
          body: JSON.stringify({
            brandId: newBrandId,
            name: newName,
            googleConnectionId: newConnectionId,
            sourceFolderId: newFolderId,
            sourceFolderName: newFolderName || undefined,
            includeSubfolders: newIncludeSubfolders,
            maxSubfolderDepth: 3,
            destinationAccountIds: newDestinationIds,
            allowedFormats: ['reel', 'youtube_short', 'short_video', 'youtube_video'],
            maxPostsPerDay: Number(newMaxPostsPerDay),
            minGapMinutes: Number(newMinGapMinutes),
            publishingDays: newPublishingDays,
            dailyTimeWindows: [
              {
                startHour: Number(newStartHour),
                startMinute: 0,
                endHour: Number(newEndHour),
                endMinute: 0,
              },
            ],
            timezone: newTimezone,
            orderingMode: newOrderingMode,
            language: newLanguage,
            captionStyle: newCaptionStyle,
            hashtagStrategy: newHashtagStrategy,
            maxHashtags: Number(newMaxHashtags),
            executionMode: newExecutionMode,
            authorizedAutoPublishAccountIds:
              newExecutionMode === 'AUTOMATIC_PUBLISHING' ? newAutoPublishIds : [],
            maxProcessingCostUsdPerDay: Number(newMaxCostUsd),
          }),
        },
      );
      setNotice(`Created Drive Autopilot policy "${res.policy.name}".`);
      setShowCreateForm(false);
      setNewName('');
      setNewFolderId('');
      setNewFolderName('');
      setSelectedPolicyId(res.policy.id);
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create Autopilot policy.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handlePauseOrResume(action: 'pause' | 'resume') {
    if (!activeWorkspace || !activePolicy) return;
    setBusyAction(action);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/autopilot/${activePolicy.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action,
          pauseReason: action === 'pause' ? 'Paused immediately from Drive Autopilot dashboard.' : undefined,
        }),
      });
      setNotice(
        action === 'pause'
          ? `Paused "${activePolicy.name}" immediately. Scheduled publishing is halted.`
          : `Resumed "${activePolicy.name}". Continuous background monitoring is active.`,
      );
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to ${action} policy.`);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleScanNow() {
    if (!activeWorkspace || !activePolicy) return;
    setBusyAction('scan_now');
    setError(null);
    setNotice(null);
    try {
      const res = await apiRequest<{
        summary: {
          discoveredNewCount: number;
          duplicateSkippedCount: number;
          analyzedCount: number;
          scheduledCount: number;
          publishedCount: number;
        };
      }>(`/api/workspaces/${activeWorkspace.id}/autopilot/${activePolicy.id}/scan`, {
        method: 'POST',
        body: JSON.stringify({ registerWatch: true }),
      });
      const s = res.summary;
      setNotice(
        `Scan complete: ${s.discoveredNewCount} new, ${s.duplicateSkippedCount} duplicates skipped, ${s.analyzedCount} analyzed, ${s.scheduledCount} scheduled, ${s.publishedCount} published.`,
      );
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to scan Drive folder.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSavePolicySettings(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !activePolicy) return;
    setBusyAction('save_policy');
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/autopilot/${activePolicy.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'update',
          maxPostsPerDay: Number(editMaxPostsPerDay),
          minGapMinutes: Number(editMinGapMinutes),
          executionMode: editExecutionMode,
          destinationAccountIds: editDestinationIds,
          authorizedAutoPublishAccountIds:
            editExecutionMode === 'AUTOMATIC_PUBLISHING' ? editAutoPublishIds : [],
          publishingDays: editPublishingDays,
          dailyTimeWindows: [
            {
              startHour: Number(editStartHour),
              startMinute: 0,
              endHour: Number(editEndHour),
              endMinute: 0,
            },
          ],
          timezone: editTimezone,
          language: editLanguage,
          captionStyle: editCaptionStyle,
          maxProcessingCostUsdPerDay: Number(editMaxCostUsd),
        }),
      });
      setNotice('Saved policy configuration and recalculated future schedule slots.');
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save policy settings.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRemovePolicy() {
    if (!activeWorkspace || !activePolicy) return;
    setBusyAction('remove_policy');
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/autopilot/${activePolicy.id}`, {
        method: 'DELETE',
      });
      setNotice(`Removed source folder policy "${activePolicy.name}" and cancelled pending jobs.`);
      setSelectedPolicyId('');
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove source folder policy.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleFileAction(
    fileId: string,
    action: 'approve' | 'skip' | 'unskip' | 'retry_failed_jobs' | 'request_reprocess',
  ) {
    if (!activeWorkspace) return;
    setBusyAction(`${action}_${fileId}`);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/workspaces/${activeWorkspace.id}/autopilot/files/${fileId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
      setNotice(`Completed "${action.replace(/_/g, ' ')}" for video.`);
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update video item.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveEditedMetadata(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace || !inspectedFile) return;
    setBusyAction('save_metadata');
    setError(null);
    setNotice(null);
    try {
      const hashtags = metaHashtags
        .split(/[\s,]+/)
        .map((h) => h.trim())
        .filter(Boolean)
        .map((h) => (h.startsWith('#') ? h : `#${h}`));

      await apiRequest(`/api/workspaces/${activeWorkspace.id}/autopilot/files/${inspectedFile.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'edit_metadata',
          metadata: {
            contentTitle: metaTitle,
            openingHook: metaHook,
            instagramCaption: metaIgCaption,
            youtubeTitle: metaYtTitle,
            youtubeDescription: metaYtDesc,
            hashtags,
            cta: metaCta,
            suggestedThumbnailText: metaThumbnail,
          },
        }),
      });
      setNotice('Saved edited video captions and updated payload hash.');
      await loadSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save video metadata.');
    } finally {
      setBusyAction(null);
    }
  }

  const toggleInList = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const toggleDay = (days: number[], day: number): number[] =>
    days.includes(day)
      ? days.length > 1
        ? days.filter((d) => d !== day)
        : days
      : [...days, day].sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      {/* Header & Top Action Bar */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
            Autonomous Video Pipeline
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900">
            Drive-to-Social Autopilot
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Connect Google Drive once, select brand source folders, and let Antara inspect every
            new video, generate unique brand-grounded metadata, and publish on your recurring
            schedule through the Central Action Gateway.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadSnapshot()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" />
            {showCreateForm ? 'Close Policy Setup' : 'Add Drive Folder Policy'}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {notice}
        </div>
      )}

      {/* Google Drive Authorization Strip */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FolderSync className="h-4 w-4 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-900">Google Drive Connection</h2>
              <span
                className={`font-mono text-xs font-medium ${
                  activeGoogleConnection && hasDriveReadScope
                    ? 'text-emerald-700'
                    : 'text-amber-700'
                }`}
              >
                {activeGoogleConnection && hasDriveReadScope
                  ? 'DRIVE_READ_AUTHORIZED'
                  : activeGoogleConnection
                    ? 'DRIVE_SCOPE_REQUIRED'
                    : 'NOT_CONNECTED'}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              {activeGoogleConnection ? (
                <>
                  Connected account:{' '}
                  <span className="font-mono font-medium text-slate-900">
                    {activeGoogleConnection.googleEmail}
                  </span>{' '}
                  · {hasDriveReadScope ? 'Read-only Drive folder monitoring granted.' : 'Click Authorize Google Drive Read-Only to grant drive.readonly access.'}
                </>
              ) : (
                'Authorize your Google account with read-only Drive access to monitor video folders continuously.'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleConnectGoogleDrive()}
              disabled={busyAction === 'connect_drive'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {activeGoogleConnection && hasDriveReadScope
                ? 'Reauthorize Google Drive'
                : 'Connect Google Drive (Read-Only)'}
            </button>
            {activeGoogleConnection && (
              <button
                type="button"
                onClick={() => void handleDisconnectGoogleDrive(activeGoogleConnection.id)}
                disabled={busyAction === 'disconnect_drive'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                <Unlink className="h-3.5 w-3.5" />
                Disconnect Google Drive
              </button>
            )}
          </div>
        </div>
      </section>

      {/* New Source Folder Policy Form */}
      {showCreateForm && (
        <form
          onSubmit={(e) => void handleCreatePolicy(e)}
          className="space-y-5 rounded-xl border border-slate-200 bg-white p-6"
        >
          <div className="border-b border-slate-200 pb-3">
            <h2 className="text-base font-semibold text-slate-900">
              Configure New Drive-to-Social Source Folder Policy
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Each policy independently watches one Google Drive folder for a selected brand. Paid
              advertising is never enabled by Drive Autopilot.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Policy Name</label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. MAGNARC Reels & Shorts Drop"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Brand</label>
              <select
                required
                value={newBrandId}
                onChange={(e) => setNewBrandId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              >
                {(snapshot?.brands || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Google Connection</label>
              <select
                required
                value={newConnectionId}
                onChange={(e) => setNewConnectionId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              >
                <option value="">Select connected Google account</option>
                {connectedGoogleAccounts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.googleEmail}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Folder ID + Live Drive Folder Picker */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700">
                  Google Drive Source Folder ID
                </label>
                <input
                  type="text"
                  required
                  value={newFolderId}
                  onChange={(e) => setNewFolderId(e.target.value)}
                  placeholder="Paste Drive Folder ID or pick below"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Search Your Drive Folders
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="Folder name..."
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleLoadFolderPicker()}
                    disabled={pickerLoading || !newConnectionId}
                    className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                  >
                    {pickerLoading ? 'Loading...' : 'Browse'}
                  </button>
                </div>
              </div>
            </div>

            {pickerFolders.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {pickerFolders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => {
                      setNewFolderId(folder.id);
                      setNewFolderName(folder.name);
                    }}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      newFolderId === folder.id
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-100'
                    }`}
                  >
                    <span className="truncate font-medium">{folder.name}</span>
                    <span className="ml-2 shrink-0 font-mono text-[10px] opacity-75">
                      {folder.id.slice(0, 8)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={newIncludeSubfolders}
                onChange={(e) => setNewIncludeSubfolders(e.target.checked)}
                className="rounded border-slate-300"
              />
              Monitor nested subfolders recursively (up to 3 levels deep)
            </label>
          </div>

          {/* Schedule & Limits */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Max Posts / Day (Cap)
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={newMaxPostsPerDay}
                onChange={(e) => setNewMaxPostsPerDay(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Minimum Gap (Minutes)
              </label>
              <input
                type="number"
                min={15}
                max={1440}
                value={newMinGapMinutes}
                onChange={(e) => setNewMinGapMinutes(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Daily Window (Local Hours)
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={22}
                  value={newStartHour}
                  onChange={(e) => setNewStartHour(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm tabular-nums text-slate-900"
                />
                <span className="text-xs text-slate-500">to</span>
                <input
                  type="number"
                  min={1}
                  max={23}
                  value={newEndHour}
                  onChange={(e) => setNewEndHour(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm tabular-nums text-slate-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Timezone</label>
              <input
                type="text"
                value={newTimezone}
                onChange={(e) => setNewTimezone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <span className="text-xs font-medium text-slate-700">Publishing Days:</span>
            {WEEKDAYS.map((w) => (
              <label key={w.day} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={newPublishingDays.includes(w.day)}
                  onChange={() => setNewPublishingDays((d) => toggleDay(d, w.day))}
                />
                {w.label}
              </label>
            ))}
          </div>

          {/* Language, Caption Style & Cost Cap */}
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Language</label>
              <input
                type="text"
                value={newLanguage}
                onChange={(e) => setNewLanguage(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Ordering</label>
              <select
                value={newOrderingMode}
                onChange={(e) => setNewOrderingMode(e.target.value as AutopilotOrderingMode)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="chronological">Chronological (Oldest First)</option>
                <option value="priority_first">Priority First</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Hashtag Strategy</label>
              <select
                value={newHashtagStrategy}
                onChange={(e) => setNewHashtagStrategy(e.target.value as AutopilotHashtagStrategy)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="focused">Focused (3–5 niche tags)</option>
                <option value="balanced">Balanced (5–8 tags)</option>
                <option value="discovery">Discovery (up to max)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Max AI Cost / Day (USD)
              </label>
              <input
                type="number"
                step="0.5"
                min={0.5}
                max={500}
                value={newMaxCostUsd}
                onChange={(e) => setNewMaxCostUsd(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums text-slate-900"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Caption Style</label>
              <input
                type="text"
                value={newCaptionStyle}
                onChange={(e) => setNewCaptionStyle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Authorization &amp; Publishing Mode
              </label>
              <select
                value={newExecutionMode}
                onChange={(e) => setNewExecutionMode(e.target.value as AutopilotExecutionMode)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="DRAFT_ONLY">Draft Only — Analyze &amp; generate captions only</option>
                <option value="APPROVAL_REQUIRED">
                  Approval Required — Hold every video for human approval before publishing
                </option>
                <option value="AUTOMATIC_PUBLISHING">
                  Automatic Publishing — Auto-publish ONLY to explicitly authorized accounts below
                </option>
              </select>
            </div>
          </div>

          {/* Destinations & Explicit Per-Account Auto-Publish Authorization */}
          <div className="space-y-2 rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-900">
                Destination Social Accounts
              </span>
              <Link
                href="/dashboard/publishing/accounts"
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                Manage Connected Social Accounts
              </Link>
            </div>
            {publishingAccounts.length === 0 ? (
              <p className="text-xs text-slate-500">
                No social publishing accounts connected yet. You can still save this policy in Draft
                Only or Approval Required mode and attach destinations later.
              </p>
            ) : (
              <div className="divide-y divide-slate-100">
                {publishingAccounts.map((acc) => {
                  const isDest = newDestinationIds.includes(acc.id);
                  const isAuto = newAutoPublishIds.includes(acc.id);
                  return (
                    <div
                      key={acc.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
                    >
                      <label className="inline-flex items-center gap-2 font-medium text-slate-800">
                        <input
                          type="checkbox"
                          checked={isDest}
                          onChange={() => {
                            setNewDestinationIds((prev) => toggleInList(prev, acc.id));
                            if (isDest) {
                              setNewAutoPublishIds((prev) => prev.filter((x) => x !== acc.id));
                            }
                          }}
                        />
                        {acc.displayName} ({acc.provider}) —{' '}
                        <span className="font-mono text-slate-500">{acc.status}</span>
                      </label>

                      {newExecutionMode === 'AUTOMATIC_PUBLISHING' && isDest && (
                        <label className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                          <input
                            type="checkbox"
                            checked={isAuto}
                            onChange={() =>
                              setNewAutoPublishIds((prev) => toggleInList(prev, acc.id))
                            }
                          />
                          Explicitly authorize automatic publishing
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busyAction === 'create_policy' || !newConnectionId || !newFolderId}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busyAction === 'create_policy' ? 'Verifying Folder & Saving...' : 'Create Autopilot Policy'}
            </button>
          </div>
        </form>
      )}

      {/* Multi-Policy Switcher & Instant Controls */}
      {snapshot && snapshot.policies.length === 0 && !showCreateForm ? (
        <section className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <Video className="mx-auto h-8 w-8 text-slate-400" />
          <h2 className="mt-3 text-base font-semibold text-slate-900">
            No Drive-to-Social Autopilot Folders Configured
          </h2>
          <p className="mx-auto mt-1 max-w-lg text-sm text-slate-600">
            Connect Google Drive read-only access above, then add your first Drive source folder
            policy to automatically discover new videos, inspect their visual scenes and audio, and
            schedule unique brand-grounded posts.
          </p>
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" />
            Configure First Drive Folder
          </button>
        </section>
      ) : activePolicy ? (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <label htmlFor="policy-selector" className="block text-[11px] font-medium text-slate-500">
                    Active Source Folder Policy ({snapshot?.policies.length || 0} configured)
                  </label>
                  <select
                    id="policy-selector"
                    value={activePolicy.id}
                    onChange={(e) => {
                      setSelectedPolicyId(e.target.value);
                      setInspectFileId(null);
                    }}
                    className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-900"
                  >
                    {(snapshot?.policies || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — /{p.sourceFolderName} ({p.status})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="border-l border-slate-200 pl-3 text-xs">
                  <p className="text-slate-500">
                    Status:{' '}
                    <span className={`font-mono font-semibold uppercase ${statusTone(activePolicy.status)}`}>
                      {activePolicy.status}
                    </span>
                  </p>
                  <p className="text-slate-500">
                    Mode:{' '}
                    <span className="font-mono font-medium text-slate-900">
                      {activePolicy.executionMode}
                    </span>{' '}
                    · TZ <span className="font-mono">{activePolicy.timezone}</span>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleScanNow()}
                  disabled={busyAction === 'scan_now' || activePolicy.status !== 'active'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busyAction === 'scan_now' ? 'animate-spin' : ''}`} />
                  Scan &amp; Run Now
                </button>

                {activePolicy.status === 'active' ? (
                  <button
                    type="button"
                    onClick={() => void handlePauseOrResume('pause')}
                    disabled={busyAction === 'pause'}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Pause Immediately
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handlePauseOrResume('resume')}
                    disabled={busyAction === 'resume'}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Resume Autopilot
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void handleRemovePolicy()}
                  disabled={busyAction === 'remove_policy'}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove Folder
                </button>
              </div>
            </div>

            {activePolicy.pauseReason && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Pause reason: {activePolicy.pauseReason}
              </p>
            )}

            {/* KPI Strip — Tabular Numbers, Single Hairline Grid */}
            {activeCounts && (
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 sm:grid-cols-4 lg:grid-cols-8">
                <div>
                  <p className="text-[11px] text-slate-500">Discovered</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                    {activeCounts.totalDiscovered}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">New</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                    {activeCounts.newVideos}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Analyzed</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                    {activeCounts.processedVideos}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Awaiting Approval</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-amber-700">
                    {activeCounts.awaitingApproval}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Scheduled</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-blue-700">
                    {activeCounts.scheduledVideos}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Published</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-emerald-700">
                    {activeCounts.publishedVideos}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Failed / Unknown</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-rose-700">
                    {activeCounts.failedVideos}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-500">Published Today / Cap</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                    {activeCounts.actualPublishedToday} / {activeCounts.dailyPostingLimit}
                  </p>
                </div>
              </div>
            )}

            {activeCounts && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-600">
                <div>
                  Next scheduled post:{' '}
                  <span className="font-mono font-medium text-slate-900">
                    {activeCounts.nextScheduledPostLocal
                      ? `${activeCounts.nextScheduledPostLocal} (${activeCounts.nextScheduledFileName || 'video'})`
                      : 'None scheduled'}
                  </span>
                </div>
                <div className="tabular-nums">
                  Processing usage: Est.{' '}
                  <span className="font-mono font-medium text-slate-900">
                    ${activeCounts.estimatedProcessingCostUsd.toFixed(4)}
                  </span>{' '}
                  · Actual{' '}
                  <span className="font-mono font-medium text-slate-900">
                    {activeCounts.actualProcessingCostUsd !== null
                      ? `$${activeCounts.actualProcessingCostUsd.toFixed(4)}`
                      : 'N/A'}
                  </span>{' '}
                  / ${activePolicy.maxProcessingCostUsdPerDay.toFixed(2)} daily cap
                </div>
              </div>
            )}
          </section>

          {/* Sub-navigation Tabs */}
          <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
            {(
              [
                ['videos', `Discovered Videos (${activeFiles.length})`],
                ['queue', `Publishing Queue (${activeJobs.length})`],
                ['policy', 'Schedule & Policy Settings'],
                ['history', `Execution History (${activeEvents.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === key
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* TAB 1: DISCOVERED VIDEOS & INLINE CAPTION EDITOR */}
          {activeTab === 'videos' && (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Video File</th>
                      <th className="px-4 py-3">Media Specs</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">AI Analysis &amp; Title</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeFiles.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          No videos discovered in &quot;{activePolicy.sourceFolderName}&quot; yet.
                          Click Scan &amp; Run Now or wait for the continuous background worker.
                        </td>
                      </tr>
                    ) : (
                      activeFiles.map((file) => (
                        <tr key={file.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-900">{file.name}</p>
                            <p className="font-mono text-[11px] text-slate-500">
                              {file.folderPath} · {formatBytes(file.sizeBytes)}
                            </p>
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] tabular-nums text-slate-600">
                            {file.videoMetadata.durationSeconds
                              ? `${file.videoMetadata.durationSeconds}s`
                              : '—'}{' '}
                            · {file.videoMetadata.aspectRatio || file.videoMetadata.orientation}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`font-mono font-semibold uppercase ${statusTone(file.status)}`}>
                              {file.status}
                            </span>
                            {file.lastErrorMessage && (
                              <p className="mt-0.5 max-w-xs truncate text-[11px] text-rose-700" title={file.lastErrorMessage}>
                                {file.lastErrorMessage}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {file.generatedMetadata ? (
                              <div className="max-w-sm">
                                <p className="truncate font-medium text-slate-900">
                                  {file.generatedMetadata.contentTitle}
                                </p>
                                <p className="truncate text-[11px] text-slate-500">
                                  {file.analysis?.subject} — {file.analysis?.centralMessage}
                                </p>
                              </div>
                            ) : (
                              <span className="text-slate-400">Pending multimodal video analysis</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex flex-wrap justify-end gap-1.5">
                              {file.generatedMetadata && (
                                <button
                                  type="button"
                                  onClick={() => openFileInspector(file)}
                                  className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                                >
                                  Inspect / Edit
                                </button>
                              )}
                              {(file.status === 'awaiting_approval' || file.status === 'analyzed') &&
                                file.generatedMetadata && (
                                  <button
                                    type="button"
                                    onClick={() => void handleFileAction(file.id, 'approve')}
                                    disabled={busyAction === `approve_${file.id}`}
                                    className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                                  >
                                    <CheckCircle2 className="h-3 w-3" />
                                    Approve
                                  </button>
                                )}
                              {file.status === 'failed' && (
                                <button
                                  type="button"
                                  onClick={() => void handleFileAction(file.id, 'retry_failed_jobs')}
                                  className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-800 hover:bg-blue-100"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Retry
                                </button>
                              )}
                              {file.status !== 'skipped_by_user' && file.status !== 'published' && (
                                <button
                                  type="button"
                                  onClick={() => void handleFileAction(file.id, 'skip')}
                                  className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                                >
                                  <SkipForward className="h-3 w-3" />
                                  Skip
                                </button>
                              )}
                              {file.status === 'skipped_by_user' && (
                                <button
                                  type="button"
                                  onClick={() => void handleFileAction(file.id, 'unskip')}
                                  className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                                >
                                  Restore
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Inline Multimodal Video Analysis & Metadata Editor */}
              {inspectedFile && inspectedFile.generatedMetadata && (
                <form
                  onSubmit={(e) => void handleSaveEditedMetadata(e)}
                  className="space-y-4 rounded-xl border border-slate-300 bg-white p-6"
                >
                  <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        Video Analysis &amp; Metadata Editor — {inspectedFile.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-600">
                        Source: <span className="font-mono">{inspectedFile.analysis?.sourceMethod}</span> · Model:{' '}
                        <span className="font-mono">{inspectedFile.analysis?.model}</span> · Editing
                        captions automatically recomputes the payload hash and requires re-approval in
                        Approval Required mode.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setInspectFileId(null)}
                      className="text-xs font-medium text-slate-500 hover:text-slate-900"
                    >
                      Close
                    </button>
                  </div>

                  {inspectedFile.analysis && (
                    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs md:grid-cols-2">
                      <div>
                        <p className="font-semibold text-slate-900">Visual Scenes Observed</p>
                        <p className="mt-1 text-slate-700">{inspectedFile.analysis.visualScenesSummary}</p>
                        <p className="mt-2 font-semibold text-slate-900">Central Message</p>
                        <p className="mt-0.5 text-slate-700">{inspectedFile.analysis.centralMessage}</p>
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">
                          Audio / Speech Transcript ({inspectedFile.analysis.detectedLanguage})
                        </p>
                        <p className="mt-1 text-slate-700">{inspectedFile.analysis.transcript}</p>
                        {inspectedFile.analysis.platformFormatIssues.length > 0 && (
                          <div className="mt-2 space-y-1 text-amber-800">
                            <p className="font-semibold">Platform Format Advisories</p>
                            {inspectedFile.analysis.platformFormatIssues.map((iss, idx) => (
                              <p key={idx}>
                                [{iss.platform}] {iss.message}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Content Title</label>
                      <input
                        type="text"
                        value={metaTitle}
                        onChange={(e) => setMetaTitle(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Suggested Thumbnail Text</label>
                      <input
                        type="text"
                        value={metaThumbnail}
                        onChange={(e) => setMetaThumbnail(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-slate-700">Opening Hook</label>
                      <input
                        type="text"
                        value={metaHook}
                        onChange={(e) => setMetaHook(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Instagram Caption</label>
                      <textarea
                        rows={5}
                        value={metaIgCaption}
                        onChange={(e) => setMetaIgCaption(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">YouTube Description</label>
                      <textarea
                        rows={5}
                        value={metaYtDesc}
                        onChange={(e) => setMetaYtDesc(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">YouTube Title (max 100 chars)</label>
                      <input
                        type="text"
                        maxLength={100}
                        value={metaYtTitle}
                        onChange={(e) => setMetaYtTitle(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700">Call to Action (CTA)</label>
                      <input
                        type="text"
                        value={metaCta}
                        onChange={(e) => setMetaCta(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-slate-700">Hashtags</label>
                      <input
                        type="text"
                        value={metaHashtags}
                        onChange={(e) => setMetaHashtags(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void handleFileAction(inspectedFile.id, 'request_reprocess')}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Request Fresh Video Re-Analysis
                    </button>
                    <button
                      type="submit"
                      disabled={busyAction === 'save_metadata'}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Save Metadata Changes
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 2: DURABLE PUBLISHING QUEUE */}
          {activeTab === 'queue' && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Scheduled Slot</th>
                    <th className="px-4 py-3">Platform / Format</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Attempts</th>
                    <th className="px-4 py-3">Provider Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeJobs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        No scheduled or completed jobs for this policy yet.
                      </td>
                    </tr>
                  ) : (
                    activeJobs.map((job) => (
                      <tr key={job.id}>
                        <td className="px-4 py-3 font-mono text-[11px] tabular-nums text-slate-800">
                          {new Date(job.scheduledForUtc).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {job.platform} · <span className="font-mono text-slate-500">{job.format}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`font-mono font-semibold uppercase ${statusTone(job.status)}`}>
                            {job.status}
                          </span>
                          {job.lastErrorMessage && (
                            <p className="mt-0.5 max-w-xs truncate text-[11px] text-rose-700" title={job.lastErrorMessage}>
                              {job.lastErrorMessage}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono tabular-nums text-slate-700">
                          {job.attemptCount} / {job.maxAttempts}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px]">
                          {job.externalPostUrl ? (
                            <a
                              href={job.externalPostUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-blue-700 hover:underline"
                            >
                              {job.externalPostId || 'View Post'}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : job.externalPostId ? (
                            <span className="text-emerald-700">{job.externalPostId}</span>
                          ) : job.reconciliationRequired ? (
                            <span className="text-amber-700">Reconciliation Required</span>
                          ) : (
                            <span className="text-slate-400">Pending</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 3: EDIT POLICY SCHEDULE & DESTINATIONS */}
          {activeTab === 'policy' && (
            <form
              onSubmit={(e) => void handleSavePolicySettings(e)}
              className="space-y-5 rounded-xl border border-slate-200 bg-white p-6"
            >
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <Sliders className="h-4 w-4 text-slate-700" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Edit Recurring Policy, Limits &amp; Destinations
                </h3>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Max Posts / Day</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={editMaxPostsPerDay}
                    onChange={(e) => setEditMaxPostsPerDay(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Min Gap (Minutes)</label>
                  <input
                    type="number"
                    min={15}
                    max={1440}
                    value={editMinGapMinutes}
                    onChange={(e) => setEditMinGapMinutes(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Daily Hours Window</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={22}
                      value={editStartHour}
                      onChange={(e) => setEditStartHour(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm tabular-nums"
                    />
                    <span className="text-xs text-slate-500">to</span>
                    <input
                      type="number"
                      min={1}
                      max={23}
                      value={editEndHour}
                      onChange={(e) => setEditEndHour(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm tabular-nums"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Timezone</label>
                  <input
                    type="text"
                    value={editTimezone}
                    onChange={(e) => setEditTimezone(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <span className="text-xs font-medium text-slate-700">Publishing Days:</span>
                {WEEKDAYS.map((w) => (
                  <label key={w.day} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={editPublishingDays.includes(w.day)}
                      onChange={() => setEditPublishingDays((d) => toggleDay(d, w.day))}
                    />
                    {w.label}
                  </label>
                ))}
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Execution Mode</label>
                  <select
                    value={editExecutionMode}
                    onChange={(e) => setEditExecutionMode(e.target.value as AutopilotExecutionMode)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="DRAFT_ONLY">DRAFT_ONLY</option>
                    <option value="APPROVAL_REQUIRED">APPROVAL_REQUIRED</option>
                    <option value="AUTOMATIC_PUBLISHING">AUTOMATIC_PUBLISHING</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Language</label>
                  <input
                    type="text"
                    value={editLanguage}
                    onChange={(e) => setEditLanguage(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Max AI Cost / Day (USD)</label>
                  <input
                    type="number"
                    step="0.5"
                    min={0.5}
                    max={500}
                    value={editMaxCostUsd}
                    onChange={(e) => setEditMaxCostUsd(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Caption Style</label>
                <input
                  type="text"
                  value={editCaptionStyle}
                  onChange={(e) => setEditCaptionStyle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-2 rounded-lg border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-900">
                  Destination Accounts &amp; Explicit Auto-Publishing Authorization
                </p>
                {publishingAccounts.map((acc) => {
                  const isDest = editDestinationIds.includes(acc.id);
                  const isAuto = editAutoPublishIds.includes(acc.id);
                  return (
                    <div key={acc.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
                      <label className="inline-flex items-center gap-2 font-medium text-slate-800">
                        <input
                          type="checkbox"
                          checked={isDest}
                          onChange={() => {
                            setEditDestinationIds((prev) => toggleInList(prev, acc.id));
                            if (isDest) setEditAutoPublishIds((prev) => prev.filter((x) => x !== acc.id));
                          }}
                        />
                        {acc.displayName} ({acc.provider})
                      </label>
                      {editExecutionMode === 'AUTOMATIC_PUBLISHING' && isDest && (
                        <label className="inline-flex items-center gap-1.5 text-emerald-700">
                          <input
                            type="checkbox"
                            checked={isAuto}
                            onChange={() => setEditAutoPublishIds((prev) => toggleInList(prev, acc.id))}
                          />
                          Authorize automatic publishing
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busyAction === 'save_policy'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save Policy &amp; Recalculate Slots
                </button>
              </div>
            </form>
          )}

          {/* TAB 4: FULL EXECUTION HISTORY */}
          {activeTab === 'history' && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Event</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Summary</th>
                    <th className="px-4 py-3">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeEvents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                        No execution events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    activeEvents.map((ev) => (
                      <tr key={ev.id}>
                        <td className="px-4 py-2.5 font-mono text-[11px] tabular-nums text-slate-600">
                          {new Date(ev.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-800">
                          {ev.eventType}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`font-mono font-semibold uppercase ${statusTone(ev.status)}`}>
                            {ev.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">{ev.summary}</td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">
                          {ev.actorUid}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
