import type {
  AgentArtifactPayload,
  AgentExecutionEvent,
  AgentId,
  AgentTaskRecord,
  AgentWorkspaceConfig,
  AiConversationMessage,
  AiConversationRecord,
  AiUsageLedgerRecord,
  BrandKnowledgeFact,
  BrandProfile,
  ClaimEvidenceRecord,
  ContentDraftRecord,
  MemoryItem,
  MemoryPromotionStatus,
  NormalizedEventRecord,
  OrchestratorRunRecord,
  PlaybookRunRecord,
  ResearchSourceRecord,
  StrategyPlanRecord,
} from '@/types/domain';
import { buildBaselineBrandFacts } from '@/lib/intelligence/brand-knowledge';
import { AppError } from './error-handler';
import {
  getStore,
  makeId,
  recordAuditLog,
  requireWorkspaceAccess,
  type DataStore,
  type RepositoryContext,
} from './repositories';

export async function getBrandInsideWorkspace(
  store: DataStore,
  workspaceId: string,
  brandId: string,
): Promise<BrandProfile | null> {
  const doc = await store.getDoc(`workspaces/${workspaceId}/brands/${brandId}`);
  if (!doc) return null;
  if (doc.workspaceId !== workspaceId) {
    throw new AppError(403, 'CROSS_TENANT_DENIED', 'Brand does not belong to active workspace.');
  }
  return doc as unknown as BrandProfile;
}

export async function listWorkspaceBrandFacts(
  workspaceId: string,
  brandId?: string,
  ctx: RepositoryContext = {},
): Promise<BrandKnowledgeFact[]> {
  const store = getStore(ctx);
  const raw = await store.listWorkspaceSubcollection(workspaceId, 'brandKnowledge');
  const items = raw
    .map((d) => d as unknown as BrandKnowledgeFact)
    .filter((f) => f.workspaceId === workspaceId && (!brandId || f.brandId === brandId));
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function ensureBrandBaselineFacts(
  store: DataStore,
  workspaceId: string,
  brand: BrandProfile,
  actorUid: string,
): Promise<BrandKnowledgeFact[]> {
  const existing = (await store.listWorkspaceSubcollection(workspaceId, 'brandKnowledge'))
    .map((d) => d as unknown as BrandKnowledgeFact)
    .filter((f) => f.workspaceId === workspaceId && f.brandId === brand.id);

  if (existing.length > 0) return existing;

  const nowIso = new Date().toISOString();
  const baselines = buildBaselineBrandFacts(brand, actorUid, nowIso);
  if (baselines.length > 0) {
    await store.commit(
      baselines.map((fact) => ({
        path: `workspaces/${workspaceId}/brandKnowledge/${fact.id}`,
        data: fact as unknown as Record<string, unknown>,
      })),
    );
  }
  return baselines;
}

export async function createBrandKnowledgeFact(
  uid: string,
  workspaceId: string,
  actorEmail: string,
  input: {
    brandId: string;
    category: BrandKnowledgeFact['category'];
    title: string;
    statement: string;
    verificationStatus: BrandKnowledgeFact['verificationStatus'];
    sourceUrl?: string;
    publishedAt?: string;
    provenanceType?: BrandKnowledgeFact['provenanceType'];
    autoApprove?: boolean;
  },
  ctx: RepositoryContext = {},
): Promise<BrandKnowledgeFact> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'memory:propose', ctx);
  const brand = await getBrandInsideWorkspace(store, workspaceId, input.brandId);
  if (!brand) {
    throw new AppError(404, 'BRAND_CONTEXT_UNAVAILABLE', 'Selected brand does not exist.');
  }

  const nowIso = new Date().toISOString();
  const id = makeId('bf');
  const fact: BrandKnowledgeFact = {
    id,
    workspaceId,
    brandId: input.brandId,
    category: input.category,
    title: input.title,
    statement: input.statement,
    verificationStatus: input.verificationStatus,
    approvalStatus: input.autoApprove ? 'approved' : 'candidate',
    confidence: input.verificationStatus === 'VERIFIED' ? 0.95 : 0.65,
    provenanceType: input.provenanceType || 'human_entered',
    sourceIds: input.sourceUrl ? [input.sourceUrl] : [],
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
    retrievedAt: nowIso,
    createdBy: uid,
    ...(input.autoApprove ? { approvedBy: uid } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await store.commit([
    {
      path: `workspaces/${workspaceId}/brandKnowledge/${id}`,
      data: fact as unknown as Record<string, unknown>,
    },
  ]);

  await recordAuditLog(
    store,
    workspaceId,
    uid,
    actorEmail,
    'brand_fact.created',
    'brandKnowledge',
    id,
    `Added ${fact.category} fact "${fact.title}" (${fact.verificationStatus}).`,
  );

  return fact;
}

export async function listMemoryItems(
  workspaceId: string,
  options?: { brandId?: string; namespace?: MemoryItem['namespace'] },
  ctx: RepositoryContext = {},
): Promise<MemoryItem[]> {
  const store = getStore(ctx);
  const raw = await store.listWorkspaceSubcollection(workspaceId, 'brandMemory');
  return raw
    .map((d) => d as unknown as MemoryItem)
    .filter(
      (m) =>
        m.workspaceId === workspaceId &&
        (!options?.brandId || !m.brandId || m.brandId === options.brandId) &&
        (!options?.namespace || m.namespace === options.namespace),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createMemoryItem(
  store: DataStore,
  workspaceId: string,
  actorUid: string,
  input: {
    brandId?: string;
    namespace: MemoryItem['namespace'];
    title: string;
    content: string;
    tags: string[];
    status: MemoryPromotionStatus;
    verificationStatus: MemoryItem['verificationStatus'];
    confidence: number;
    provenanceRef: string;
    sourceRunId?: string;
    sourceAgentId?: AgentId;
  },
): Promise<MemoryItem> {
  const nowIso = new Date().toISOString();
  const id = makeId('mem');
  const item: MemoryItem = {
    id,
    workspaceId,
    ...(input.brandId ? { brandId: input.brandId } : {}),
    namespace: input.namespace,
    title: input.title.slice(0, 180),
    content: input.content.slice(0, 4000),
    tags: input.tags.slice(0, 15),
    status: input.status,
    verificationStatus: input.verificationStatus,
    confidence: input.confidence,
    provenanceRef: input.provenanceRef.slice(0, 300),
    ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
    ...(input.sourceAgentId ? { sourceAgentId: input.sourceAgentId } : {}),
    tokensEstimate: Math.max(1, Math.ceil(input.content.length / 4)),
    createdBy: actorUid,
    ...(input.status === 'approved' ? { approvedBy: actorUid } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await store.commit([
    {
      path: `workspaces/${workspaceId}/brandMemory/${id}`,
      data: item as unknown as Record<string, unknown>,
    },
  ]);

  return item;
}

export async function updateMemoryPromotionStatus(
  uid: string,
  workspaceId: string,
  actorEmail: string,
  memoryId: string,
  decision: {
    action: 'approve' | 'reject' | 'supersede';
    reason?: string;
    replacementContent?: string;
  },
  ctx: RepositoryContext = {},
): Promise<MemoryItem> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'memory:approve', ctx);
  const raw = await store.getDoc(`workspaces/${workspaceId}/brandMemory/${memoryId}`);
  if (!raw || raw.workspaceId !== workspaceId) {
    throw new AppError(404, 'MEMORY_NOT_FOUND', 'Memory item was not found in this workspace.');
  }
  const existing = raw as unknown as MemoryItem;
  const nowIso = new Date().toISOString();

  let replacementId: string | undefined;
  if (decision.action === 'supersede' && decision.replacementContent?.trim()) {
    const nextItem = await createMemoryItem(store, workspaceId, uid, {
      brandId: existing.brandId,
      namespace: existing.namespace,
      title: `${existing.title} (Updated)`,
      content: decision.replacementContent.trim(),
      tags: existing.tags,
      status: 'approved',
      verificationStatus: existing.verificationStatus,
      confidence: existing.confidence,
      provenanceRef: `superseded:${existing.id}`,
    });
    replacementId = nextItem.id;
  }

  const nextStatus: MemoryPromotionStatus =
    decision.action === 'approve'
      ? 'approved'
      : decision.action === 'reject'
        ? 'rejected'
        : 'superseded';

  const updated: MemoryItem = {
    ...existing,
    status: nextStatus,
    ...(decision.action === 'approve' ? { approvedBy: uid } : {}),
    ...(replacementId ? { supersededById: replacementId } : {}),
    updatedAt: nowIso,
  };

  await store.commit([
    {
      path: `workspaces/${workspaceId}/brandMemory/${memoryId}`,
      data: updated as unknown as Record<string, unknown>,
    },
  ]);

  // Rejections automatically log an explicit entry in rejection_memory unless already rejection_memory
  if (decision.action === 'reject' && existing.namespace !== 'rejection_memory') {
    await createMemoryItem(store, workspaceId, uid, {
      brandId: existing.brandId,
      namespace: 'rejection_memory',
      title: `Rejected: ${existing.title}`,
      content: `${decision.reason || 'Rejected by workspace reviewer'}. Original statement: ${existing.content}`,
      tags: ['rejection_guardrail', ...existing.tags.slice(0, 8)],
      status: 'approved',
      verificationStatus: 'VERIFIED',
      confidence: 1,
      provenanceRef: `rejected_from:${existing.id}`,
    });
  }

  await recordAuditLog(
    store,
    workspaceId,
    uid,
    actorEmail,
    `memory.${decision.action}`,
    'brandMemory',
    memoryId,
    `${decision.action.toUpperCase()} memory "${existing.title}"`,
  );

  return updated;
}

export async function saveResearchArtifacts(
  store: DataStore,
  workspaceId: string,
  sources: ResearchSourceRecord[],
  claims: ClaimEvidenceRecord[],
): Promise<void> {
  const ops = [
    ...sources.map((src) => ({
      path: `workspaces/${workspaceId}/researchSources/${src.id}`,
      data: src as unknown as Record<string, unknown>,
    })),
    ...claims.map((clm) => ({
      path: `workspaces/${workspaceId}/researchClaims/${clm.id}`,
      data: clm as unknown as Record<string, unknown>,
    })),
  ];
  if (ops.length > 0) {
    await store.commit(ops);
  }
}

export async function listResearchSources(
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<ResearchSourceRecord[]> {
  const store = getStore(ctx);
  const raw = await store.listWorkspaceSubcollection(workspaceId, 'researchSources');
  return raw
    .map((d) => d as unknown as ResearchSourceRecord)
    .filter((s) => s.workspaceId === workspaceId)
    .sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt));
}

export async function listResearchClaims(
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<ClaimEvidenceRecord[]> {
  const store = getStore(ctx);
  const raw = await store.listWorkspaceSubcollection(workspaceId, 'researchClaims');
  return raw
    .map((d) => d as unknown as ClaimEvidenceRecord)
    .filter((c) => c.workspaceId === workspaceId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listAgentConfigs(
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<AgentWorkspaceConfig[]> {
  const store = getStore(ctx);
  const raw = await store.listWorkspaceSubcollection(workspaceId, 'agentConfigs');
  return raw
    .map((d) => d as unknown as AgentWorkspaceConfig)
    .filter((c) => c.workspaceId === workspaceId);
}

export async function upsertAgentConfig(
  uid: string,
  workspaceId: string,
  actorEmail: string,
  agentId: AgentId,
  patch: Partial<Pick<AgentWorkspaceConfig, 'enabled' | 'preferredTaskClass' | 'maxStepsOverride' | 'customFocusNote'>>,
  ctx: RepositoryContext = {},
): Promise<AgentWorkspaceConfig> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'agents:configure', ctx);
  const raw = await store.getDoc(`workspaces/${workspaceId}/agentConfigs/${agentId}`);
  const prev = raw as unknown as AgentWorkspaceConfig | null;
  const nowIso = new Date().toISOString();

  const next: AgentWorkspaceConfig = {
    id: agentId,
    workspaceId,
    agentId,
    enabled: patch.enabled ?? prev?.enabled ?? true,
    ...(patch.preferredTaskClass ?? prev?.preferredTaskClass
      ? { preferredTaskClass: patch.preferredTaskClass ?? prev?.preferredTaskClass }
      : {}),
    ...(patch.maxStepsOverride ?? prev?.maxStepsOverride
      ? { maxStepsOverride: patch.maxStepsOverride ?? prev?.maxStepsOverride }
      : {}),
    ...(patch.customFocusNote !== undefined
      ? { customFocusNote: patch.customFocusNote }
      : prev?.customFocusNote
        ? { customFocusNote: prev.customFocusNote }
        : {}),
    updatedBy: uid,
    updatedAt: nowIso,
  };

  await store.commit([
    {
      path: `workspaces/${workspaceId}/agentConfigs/${agentId}`,
      data: next as unknown as Record<string, unknown>,
    },
  ]);

  await recordAuditLog(
    store,
    workspaceId,
    uid,
    actorEmail,
    'agent_config.updated',
    'agentConfigs',
    agentId,
    `Updated config for agent ${agentId} (enabled=${next.enabled}).`,
  );

  return next;
}

export async function listOrchestratorRuns(
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<OrchestratorRunRecord[]> {
  const store = getStore(ctx);
  const raw = await store.listWorkspaceSubcollection(workspaceId, 'aiRuns');
  return raw
    .map((d) => d as unknown as OrchestratorRunRecord)
    .filter((r) => r.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRunWithDetails(
  workspaceId: string,
  runId: string,
  ctx: RepositoryContext = {},
): Promise<{
  run: OrchestratorRunRecord;
  tasks: AgentTaskRecord[];
  events: AgentExecutionEvent[];
  artifacts: AgentArtifactPayload[];
  usage: AiUsageLedgerRecord[];
}> {
  const store = getStore(ctx);
  const rawRun = await store.getDoc(`workspaces/${workspaceId}/aiRuns/${runId}`);
  if (!rawRun || rawRun.workspaceId !== workspaceId) {
    throw new AppError(404, 'RUN_NOT_FOUND', 'Orchestrator run not found.');
  }
  const [tasksRaw, eventsRaw, artifactsRaw, usageRaw] = await Promise.all([
    store.listWorkspaceSubcollection(workspaceId, 'agentTasks'),
    store.listWorkspaceSubcollection(workspaceId, 'agentExecutionEvents'),
    store.listWorkspaceSubcollection(workspaceId, 'agentArtifacts'),
    store.listWorkspaceSubcollection(workspaceId, 'aiUsageLedger'),
  ]);

  return {
    run: rawRun as unknown as OrchestratorRunRecord,
    tasks: tasksRaw
      .map((t) => t as unknown as AgentTaskRecord)
      .filter((t) => t.runId === runId)
      .sort((a, b) => a.stageIndex - b.stageIndex),
    events: eventsRaw
      .map((e) => e as unknown as AgentExecutionEvent)
      .filter((e) => e.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    artifacts: artifactsRaw
      .map((a) => a as unknown as AgentArtifactPayload)
      .filter((a) => a.runId === runId),
    usage: usageRaw
      .map((u) => u as unknown as AiUsageLedgerRecord)
      .filter((u) => u.runId === runId),
  };
}

export async function listStrategyPlans(
  workspaceId: string,
  brandId?: string,
  ctx: RepositoryContext = {},
): Promise<StrategyPlanRecord[]> {
  const store = getStore(ctx);
  const raw = await store.listWorkspaceSubcollection(workspaceId, 'strategyRecords');
  return raw
    .map((d) => d as unknown as StrategyPlanRecord)
    .filter((s) => s.workspaceId === workspaceId && (!brandId || s.brandId === brandId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listContentDrafts(
  workspaceId: string,
  brandId?: string,
  ctx: RepositoryContext = {},
): Promise<ContentDraftRecord[]> {
  const store = getStore(ctx);
  const raw = await store.listWorkspaceSubcollection(workspaceId, 'contentDrafts');
  return raw
    .map((d) => d as unknown as ContentDraftRecord)
    .filter((c) => c.workspaceId === workspaceId && (!brandId || c.brandId === brandId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listPlaybookRuns(
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<{
  runs: PlaybookRunRecord[];
  events: NormalizedEventRecord[];
}> {
  const store = getStore(ctx);
  const [runsRaw, eventsRaw] = await Promise.all([
    store.listWorkspaceSubcollection(workspaceId, 'playbookRuns'),
    store.listWorkspaceSubcollection(workspaceId, 'normalizedEvents'),
  ]);
  return {
    runs: runsRaw
      .map((r) => r as unknown as PlaybookRunRecord)
      .filter((r) => r.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    events: eventsRaw
      .map((e) => e as unknown as NormalizedEventRecord)
      .filter((e) => e.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function listConversationsAndMessages(
  workspaceId: string,
  conversationId?: string,
  ctx: RepositoryContext = {},
): Promise<{
  conversations: AiConversationRecord[];
  messages: AiConversationMessage[];
}> {
  const store = getStore(ctx);
  const [convRaw, msgRaw] = await Promise.all([
    store.listWorkspaceSubcollection(workspaceId, 'aiConversations'),
    store.listWorkspaceSubcollection(workspaceId, 'aiMessages'),
  ]);
  const conversations = convRaw
    .map((c) => c as unknown as AiConversationRecord)
    .filter((c) => c.workspaceId === workspaceId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const messages = msgRaw
    .map((m) => m as unknown as AiConversationMessage)
    .filter(
      (m) =>
        m.workspaceId === workspaceId &&
        (!conversationId || m.conversationId === conversationId),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return { conversations, messages };
}

export async function listUsageLedger(
  workspaceId: string,
  ctx: RepositoryContext = {},
): Promise<AiUsageLedgerRecord[]> {
  const store = getStore(ctx);
  const raw = await store.listWorkspaceSubcollection(workspaceId, 'aiUsageLedger');
  return raw
    .map((u) => u as unknown as AiUsageLedgerRecord)
    .filter((u) => u.workspaceId === workspaceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
