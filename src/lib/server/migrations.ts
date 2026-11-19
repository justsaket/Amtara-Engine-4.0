import type { DataStore } from './repositories';

export interface SchemaMigrationDefinition {
  version: string;
  phase: 'Phase 1' | 'Phase 2' | 'Phase 3' | 'Phase 4' | 'Phase 5';
  title: string;
  description: string;
  reversible: boolean;
  destructive: boolean;
  collections: string[];
}

export const SCHEMA_MIGRATION_REGISTRY: readonly SchemaMigrationDefinition[] = [
  {
    version: '1.0.0',
    phase: 'Phase 1',
    title: 'Multi-Tenant Foundation & Governance Schema',
    description:
      'Users, workspaces, members, invitations, brands, integrations, settings, notifications, and immutable audit logs.',
    reversible: false,
    destructive: false,
    collections: ['users', 'workspaces', 'members', 'brands', 'settings', 'auditLogs'],
  },
  {
    version: '2.0.0',
    phase: 'Phase 2',
    title: 'Google OAuth Vault & Apps Script Control Plane',
    description:
      'Google connections, AAD-bound encrypted credentials, Apps Script projects, backups, versions, deployments, executions, and triggers.',
    reversible: true,
    destructive: false,
    collections: [
      'googleConnections',
      'encryptedCredentials',
      'appsScriptProjects',
      'appsScriptBackups',
      'appsScriptVersions',
      'appsScriptDeployments',
      'appsScriptExecutions',
      'appsScriptTriggers',
    ],
  },
  {
    version: '3.0.0',
    phase: 'Phase 3',
    title: 'Multi-Agent Intelligence, Brand Memory & Research Registry',
    description:
      'Agent configs, orchestration runs, research sources, 20-category brand knowledge facts, 7-namespace memory, strategy plans, and AI usage ledger.',
    reversible: true,
    destructive: false,
    collections: [
      'agentConfigs',
      'agentRuns',
      'researchSources',
      'brandKnowledgeFacts',
      'brandMemory',
      'strategyPlans',
      'aiUsageRecords',
    ],
  },
  {
    version: '4.0.0',
    phase: 'Phase 4',
    title: 'Autonomous Marketing, Publishing, Approvals & Engagement Engine',
    description:
      'Content items, creative briefs, media assets, social accounts, scheduled posts, approvals, autonomy policies, emergency stop, inbox, reviews, leads, campaigns, analytics, and experiments.',
    reversible: true,
    destructive: false,
    collections: [
      'contentItems',
      'creativeBriefs',
      'mediaAssets',
      'socialAccounts',
      'scheduledPosts',
      'publishingAttempts',
      'approvalRequests',
      'autonomyPolicies',
      'marketingConfig',
      'socialConversations',
      'reviews',
      'leads',
      'adCampaigns',
      'campaignBudgetPolicies',
      'analyticsSnapshots',
      'experiments',
      'marketingActivity',
    ],
  },
  {
    version: '5.0.0',
    phase: 'Phase 5',
    title: 'Release Observability, Usage Budgets & Operational Integrity',
    description:
      'Forward-compatible operational alert rules, usage budget thresholds, and non-destructive schema integrity verification.',
    reversible: true,
    destructive: false,
    collections: ['settings', 'auditLogs', 'notifications'],
  },
] as const;

export interface WorkspaceIntegrityAuditResult {
  workspaceId: string;
  auditedAt: string;
  targetSchemaVersion: string;
  collectionsScanned: number;
  totalDocumentsScanned: number;
  findings: Array<{
    severity: 'info' | 'warning' | 'error';
    category: 'orphan_reference' | 'duplicate_job' | 'stale_lease' | 'schema_version';
    collection: string;
    documentId: string;
    detail: string;
  }>;
  healthy: boolean;
  backupReadiness: {
    managedAutomaticBackupsConfirmed: boolean;
    note: string;
    recommendedExportCommand: string;
  };
}

/**
 * Non-destructive dry-run integrity & migration audit for a workspace.
 * Detects orphan brand references, duplicate scheduled-post idempotency keys,
 * expired worker leases, and missing schema versions without mutating production data.
 */
export async function runWorkspaceIntegrityAudit(
  store: DataStore,
  workspaceId: string,
  nowIso = new Date().toISOString(),
): Promise<WorkspaceIntegrityAuditResult> {
  const [brands, contentItems, scheduledPosts, accounts, approvals] = await Promise.all([
    store.listWorkspaceSubcollection(workspaceId, 'brands').catch(() => []),
    store.listWorkspaceSubcollection(workspaceId, 'contentItems').catch(() => []),
    store.listWorkspaceSubcollection(workspaceId, 'scheduledPosts').catch(() => []),
    store.listWorkspaceSubcollection(workspaceId, 'socialAccounts').catch(() => []),
    store.listWorkspaceSubcollection(workspaceId, 'approvalRequests').catch(() => []),
  ]);

  const findings: WorkspaceIntegrityAuditResult['findings'] = [];
  const brandIds = new Set(brands.map((b) => String(b.id || '')));
  const accountIds = new Set(accounts.map((a) => String(a.id || '')));

  for (const item of contentItems) {
    const id = String(item.id || 'unknown');
    const bid = String(item.brandId || '');
    if (bid && !brandIds.has(bid)) {
      findings.push({
        severity: 'warning',
        category: 'orphan_reference',
        collection: 'contentItems',
        documentId: id,
        detail: `Content item references brandId "${bid}" which does not exist in workspace brands.`,
      });
    }
    if (!item.schemaVersion) {
      findings.push({
        severity: 'info',
        category: 'schema_version',
        collection: 'contentItems',
        documentId: id,
        detail: 'Document predates explicit schemaVersion tagging (backward-compatible).',
      });
    }
  }

  const seenIdempotencyKeys = new Set<string>();
  const nowMs = Date.parse(nowIso);

  for (const job of scheduledPosts) {
    const id = String(job.id || 'unknown');
    const idem = String(job.idempotencyKey || '');
    if (idem) {
      if (seenIdempotencyKeys.has(idem)) {
        findings.push({
          severity: 'error',
          category: 'duplicate_job',
          collection: 'scheduledPosts',
          documentId: id,
          detail: `Duplicate scheduledPost idempotencyKey "${idem}" detected.`,
        });
      }
      seenIdempotencyKeys.add(idem);
    }

    const accId = String(job.accountId || '');
    if (accId && !accountIds.has(accId)) {
      findings.push({
        severity: 'warning',
        category: 'orphan_reference',
        collection: 'scheduledPosts',
        documentId: id,
        detail: `Scheduled post references accountId "${accId}" not present in socialAccounts.`,
      });
    }

    if (
      (job.status === 'claimed' || job.status === 'publishing') &&
      job.leaseExpiresAt &&
      Date.parse(String(job.leaseExpiresAt)) < nowMs
    ) {
      findings.push({
        severity: 'warning',
        category: 'stale_lease',
        collection: 'scheduledPosts',
        documentId: id,
        detail: `Job has an expired lease (${String(job.leaseExpiresAt)}) and requires scheduler recovery.`,
      });
    }
  }

  for (const apr of approvals) {
    const id = String(apr.id || 'unknown');
    const bid = String(apr.brandId || '');
    if (bid && !brandIds.has(bid)) {
      findings.push({
        severity: 'warning',
        category: 'orphan_reference',
        collection: 'approvalRequests',
        documentId: id,
        detail: `Approval request references missing brandId "${bid}".`,
      });
    }
  }

  const totalDocumentsScanned =
    brands.length + contentItems.length + scheduledPosts.length + accounts.length + approvals.length;

  return {
    workspaceId,
    auditedAt: nowIso,
    targetSchemaVersion: '5.0.0',
    collectionsScanned: 5,
    totalDocumentsScanned,
    findings,
    healthy: !findings.some((f) => f.severity === 'error'),
    backupReadiness: {
      managedAutomaticBackupsConfirmed: false,
      note: 'Managed Firestore scheduled exports/PITR depend on GCP Blaze billing and Cloud Scheduler configuration; do not assume automatic backups are active until verified in Google Cloud Console.',
      recommendedExportCommand:
        'gcloud firestore export gs://<YOUR_BACKUP_BUCKET>/antara-$(date +%Y%m%d) --database=ai-studio-e9bdfca4-ede1-4994-8b80-fba76fa44eb9',
    },
  };
}
