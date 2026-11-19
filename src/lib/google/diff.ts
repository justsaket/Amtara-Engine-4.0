import crypto from 'node:crypto';
import type { AppsScriptFile } from '@/types/domain';

export interface FileDiffSummary {
  name: string;
  type: AppsScriptFile['type'];
  status: 'added' | 'modified' | 'deleted' | 'unchanged';
  beforeLength: number;
  afterLength: number;
}

export interface ProjectDiffReport {
  hasChanges: boolean;
  hasDeletions: boolean;
  deletedFileNames: string[];
  files: FileDiffSummary[];
  beforeHash: string;
  afterHash: string;
}

export function computeProjectContentHash(files: ReadonlyArray<AppsScriptFile>): string {
  const sorted = [...files]
    .map((f) => ({ name: f.name, type: f.type, source: f.source }))
    .sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`));
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(sorted), 'utf8')
    .digest('hex');
}

export function computeProjectDiff(
  beforeFiles: ReadonlyArray<AppsScriptFile>,
  afterFiles: ReadonlyArray<AppsScriptFile>,
): ProjectDiffReport {
  const beforeMap = new Map<string, AppsScriptFile>();
  for (const f of beforeFiles) {
    beforeMap.set(`${f.type}:${f.name}`, f);
  }

  const afterMap = new Map<string, AppsScriptFile>();
  for (const f of afterFiles) {
    afterMap.set(`${f.type}:${f.name}`, f);
  }

  const items: FileDiffSummary[] = [];
  const deletedFileNames: string[] = [];

  for (const [key, afterFile] of afterMap.entries()) {
    const beforeFile = beforeMap.get(key);
    if (!beforeFile) {
      items.push({
        name: afterFile.name,
        type: afterFile.type,
        status: 'added',
        beforeLength: 0,
        afterLength: afterFile.source.length,
      });
    } else if (beforeFile.source !== afterFile.source) {
      items.push({
        name: afterFile.name,
        type: afterFile.type,
        status: 'modified',
        beforeLength: beforeFile.source.length,
        afterLength: afterFile.source.length,
      });
    } else {
      items.push({
        name: afterFile.name,
        type: afterFile.type,
        status: 'unchanged',
        beforeLength: beforeFile.source.length,
        afterLength: afterFile.source.length,
      });
    }
  }

  for (const [key, beforeFile] of beforeMap.entries()) {
    if (!afterMap.has(key)) {
      deletedFileNames.push(beforeFile.name);
      items.push({
        name: beforeFile.name,
        type: beforeFile.type,
        status: 'deleted',
        beforeLength: beforeFile.source.length,
        afterLength: 0,
      });
    }
  }

  const beforeHash = computeProjectContentHash(beforeFiles);
  const afterHash = computeProjectContentHash(afterFiles);

  return {
    hasChanges: beforeHash !== afterHash,
    hasDeletions: deletedFileNames.length > 0,
    deletedFileNames,
    files: items,
    beforeHash,
    afterHash,
  };
}
