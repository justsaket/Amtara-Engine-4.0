import crypto from 'node:crypto';
import type {
  AppsScriptFile,
  AppsScriptSnapshotRecord,
} from '@/types/domain';
import { AppError } from '@/lib/server/error-handler';
import {
  getAppsScriptContent,
  updateAppsScriptContent,
} from './apps-script-client';
import {
  computeProjectContentHash,
  computeProjectDiff,
  type ProjectDiffReport,
} from './diff';
import type { FetchLike } from './oauth';
import {
  validateAppsScriptProject,
  type ProjectValidationReport,
} from './validator';

export interface ProtectedUpdateParams {
  accessToken: string;
  workspaceId: string;
  scriptId: string;
  nextFiles: AppsScriptFile[];
  changeSummary: string;
  actorUid: string;
  actorEmail: string;
  confirmFileDeletions?: boolean;
  reason?: AppsScriptSnapshotRecord['reason'];
  fetchImpl?: FetchLike;
  persistSnapshot: (snapshot: AppsScriptSnapshotRecord) => Promise<void>;
}

export interface ProtectedUpdateResult {
  updatedFiles: AppsScriptFile[];
  preUpdateSnapshotId: string;
  verifiedContentHash: string;
  diff: ProjectDiffReport;
  validation: ProjectValidationReport;
  verifiedFileParity: boolean;
}

export function extractManifestJsonString(files: ReadonlyArray<AppsScriptFile>): string {
  const manifestFile = files.find(
    (f) => f.type === 'JSON' && (f.name === 'appsscript' || f.name === 'appsscript.json'),
  );
  return manifestFile?.source || '{}';
}

export function createSnapshotRecord(params: {
  workspaceId: string;
  scriptId: string;
  files: AppsScriptFile[];
  changeSummary: string;
  reason: AppsScriptSnapshotRecord['reason'];
  actorUid: string;
  actorEmail: string;
  versionNumber?: number;
}): AppsScriptSnapshotRecord {
  const id = `snap_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
  return {
    id,
    workspaceId: params.workspaceId,
    scriptId: params.scriptId,
    ...(params.versionNumber !== undefined ? { versionNumber: params.versionNumber } : {}),
    files: params.files.map((f) => ({
      name: f.name,
      type: f.type,
      source: f.source,
    })),
    manifestJson: extractManifestJsonString(params.files),
    contentHash: computeProjectContentHash(params.files),
    changeSummary: params.changeSummary,
    reason: params.reason,
    createdByUid: params.actorUid,
    createdByEmail: params.actorEmail,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Mandatory 10-step protected Apps Script source update workflow:
 * 1. Validate proposed project files + manifest cleanly before remote mutation
 * 2. Fetch current live project files from Google Apps Script API
 * 3. Compute diff between current live project and proposed files
 * 4. Enforce explicit deletion confirmation if any existing file would be removed
 * 5. Build pre-update snapshot backup record
 * 6. Persist pre-update snapshot BEFORE mutating Google Apps Script remotely
 * 7. Submit the complete file array via projects.updateContent
 * 8. Re-fetch remote content from Google Apps Script API
 * 9. Verify file list and content hash parity
 * 10. Return verification report, diff, hash, and backup snapshot reference
 */
export async function protectedUpdateProjectContent(
  params: ProtectedUpdateParams,
): Promise<ProtectedUpdateResult> {
  const fetchImpl = params.fetchImpl || fetch;

  // Step 1: Validate proposed manifest & files locally first
  const validation = validateAppsScriptProject({
    scriptId: params.scriptId,
    files: params.nextFiles,
  });

  if (!validation.valid) {
    const firstErr = validation.diagnostics.find((d) => d.severity === 'error');
    throw new AppError(
      400,
      'APPS_SCRIPT_VALIDATION_FAILED',
      firstErr?.message || 'Apps Script project validation failed before push.',
    );
  }

  // Step 2: Fetch current live project content from Google
  const remoteCurrent = await getAppsScriptContent(
    params.accessToken,
    params.scriptId,
    fetchImpl,
  );
  const currentFiles = remoteCurrent.files || [];

  // Step 3: Compute diff
  const diff = computeProjectDiff(currentFiles, params.nextFiles);

  // Step 4: Enforce explicit confirmation for file deletions
  if (diff.hasDeletions && !params.confirmFileDeletions) {
    throw new AppError(
      409,
      'DELETION_CONFIRMATION_REQUIRED',
      `Updating this project will delete file(s): ${diff.deletedFileNames.join(', ')}. Re-submit with confirmFileDeletions=true after reviewing diff.`,
    );
  }

  // Step 5 & 6: Build and persist immutable pre-update backup snapshot
  const preSnapshot = createSnapshotRecord({
    workspaceId: params.workspaceId,
    scriptId: params.scriptId,
    files: currentFiles,
    changeSummary: `Pre-update backup before: ${params.changeSummary}`,
    reason: params.reason || 'pre_update_backup',
    actorUid: params.actorUid,
    actorEmail: params.actorEmail,
  });
  await params.persistSnapshot(preSnapshot);

  // Step 7: Submit COMPLETE file list via projects.updateContent
  await updateAppsScriptContent(
    params.accessToken,
    params.scriptId,
    params.nextFiles,
    fetchImpl,
  );

  // Step 8 & 9: Re-fetch remote content & verify parity
  const verifiedRemote = await getAppsScriptContent(
    params.accessToken,
    params.scriptId,
    fetchImpl,
  );
  const verifiedFiles = verifiedRemote.files || [];
  const verifiedHash = computeProjectContentHash(verifiedFiles);
  const expectedHash = computeProjectContentHash(params.nextFiles);
  const verifiedFileParity = verifiedHash === expectedHash;

  return {
    updatedFiles: verifiedFiles,
    preUpdateSnapshotId: preSnapshot.id,
    verifiedContentHash: verifiedHash,
    diff,
    validation,
    verifiedFileParity,
  };
}
