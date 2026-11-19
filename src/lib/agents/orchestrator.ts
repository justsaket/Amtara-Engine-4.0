import type {
  AgentArtifactPayload,
  AgentExecutionEvent,
  AgentId,
  AgentResultContract,
  AgentTaskRecord,
  AiUsageLedgerRecord,
  BrandKnowledgeFact,
  BrandProfile,
  ClaimEvidenceRecord,
  MemoryItem,
  OrchestratorRunRecord,
  OrchestratorRunStatus,
  ResearchSourceRecord,
} from '@/types/domain';
import { createDefaultModelProviderManager, type ModelProviderManager } from '@/lib/ai/provider-manager';
import { createCorrelationId } from '@/lib/intelligence/error-codes';
import {
  createMemoryItem,
  ensureBrandBaselineFacts,
  getBrandInsideWorkspace,
  saveResearchArtifacts,
} from '@/lib/server/phase3-repositories';
import {
  makeId,
  recordAuditLog,
  requireWorkspaceAccess,
  type DataStore,
  type RepositoryContext,
} from '@/lib/server/repositories';
import { getAgentDefinition } from './agent-registry';
import { executeSpecialistAgent } from './specialists';

export interface OrchestratorRoutePlan {
  intentCategory: OrchestratorRunRecord['intentCategory'];
  complexity: OrchestratorRunRecord['complexity'];
  stages: Array<{
    stageIndex: number;
    agentIds: AgentId[];
    objectiveTemplate: (prompt: string) => string;
  }>;
}

const DEFAULT_TOKEN_BUDGET_PER_RUN = 45_000;
const MAX_TOTAL_TASKS_PER_RUN = 8;

export function classifyPromptAndPlanDag(
  prompt: string,
  preferredAgentIds?: AgentId[],
  complexityHint?: OrchestratorRunRecord['complexity'],
): OrchestratorRoutePlan {
  const p = prompt.toLowerCase();

  // Explicit single/multi-agent override with cycle-free topological stages
  if (preferredAgentIds && preferredAgentIds.length > 0) {
    const deduped = Array.from(new Set(preferredAgentIds)).filter(
      (id) => id !== '01_orchestrator',
    );
    const chosen: AgentId[] = deduped.length > 0 ? deduped.slice(0, 6) : ['04_content_engine'];
    return {
      intentCategory: 'full_campaign',
      complexity: complexityHint || (chosen.length > 2 ? 'deep' : 'standard'),
      stages: chosen.map((agentId, idx) => ({
        stageIndex: idx,
        agentIds: [agentId],
        objectiveTemplate: (raw) => raw,
      })),
    };
  }

  // Review & Reputation intent -> minimal single specialist
  if (/\b(1-star|one[- ]star|review|negative rating|trustpilot|google review)\b/.test(p)) {
    return {
      intentCategory: 'review_reply',
      complexity: complexityHint || 'simple',
      stages: [
        {
          stageIndex: 0,
          agentIds: ['07_reviews_reputation'],
          objectiveTemplate: (raw) => raw,
        },
      ],
    };
  }

  // Lead / DM response intent -> minimal single specialist
  if (/\b(dm lead|inbound lead|prospect reply|11 pm|lead message|whatsapp|instagram dm)\b/.test(p)) {
    return {
      intentCategory: 'lead_response',
      complexity: complexityHint || 'simple',
      stages: [
        {
          stageIndex: 0,
          agentIds: ['08_leads_conversations'],
          objectiveTemplate: (raw) => raw,
        },
      ],
    };
  }

  // ROI / Ad Fatigue / Performance intent
  if (/\b(roas|roi|attribution|fatigue|ctr|cpc|conversion drop|ad performance)\b/.test(p)) {
    const needsCreative = /\b(ad creative|hook|relaunch|variation)\b/.test(p);
    return {
      intentCategory: 'roi_analysis',
      complexity: complexityHint || (needsCreative ? 'standard' : 'simple'),
      stages: needsCreative
        ? [
            { stageIndex: 0, agentIds: ['09_results_roi'], objectiveTemplate: (raw) => raw },
            {
              stageIndex: 1,
              agentIds: ['05_creative_studio'],
              objectiveTemplate: (raw) => `Produce refreshed creative variations addressing the ROI diagnosis: ${raw}`,
            },
          ]
        : [{ stageIndex: 0, agentIds: ['09_results_roi'], objectiveTemplate: (raw) => raw }],
    };
  }

  // SEO / Search ranking drop / Keyword cluster intent
  if (/\b(seo|ranking|serp|keyword|search demand|traffic drop|geo|ai overview)\b/.test(p)) {
    const needsContent = /\b(brief|article|draft|calendar|post|fix)\b/.test(p);
    return {
      intentCategory: 'seo_audit',
      complexity: complexityHint || 'standard',
      stages: needsContent
        ? [
            { stageIndex: 0, agentIds: ['03_search_visibility'], objectiveTemplate: (raw) => raw },
            {
              stageIndex: 1,
              agentIds: ['04_content_engine'],
              objectiveTemplate: (raw) => `Create SEO-aligned content brief and draft addressing: ${raw}`,
            },
          ]
        : [{ stageIndex: 0, agentIds: ['03_search_visibility'], objectiveTemplate: (raw) => raw }],
    };
  }

  // Pure Market / Competitor Research intent
  if (/\b(competitor|market radar|benchmark|industry trend|research)\b/.test(p) && !/\b(campaign|calendar|draft)\b/.test(p)) {
    return {
      intentCategory: 'market_research',
      complexity: complexityHint || 'standard',
      stages: [
        {
          stageIndex: 0,
          agentIds: ['02_market_radar'],
          objectiveTemplate: (raw) => raw,
        },
      ],
    };
  }

  // Content Strategy / Calendar / Draft intent
  if (/\b(calendar|strategy|pillar|linkedin post|blog|email sequence|draft|write)\b/.test(p) && !/\b(full campaign|launch)\b/.test(p)) {
    const includesSocial = /\b(package|schedule|publish|carousel|visual)\b/.test(p);
    return {
      intentCategory: /\b(strategy|calendar)\b/.test(p) ? 'content_strategy' : 'content_drafting',
      complexity: complexityHint || (includesSocial ? 'standard' : 'simple'),
      stages: includesSocial
        ? [
            { stageIndex: 0, agentIds: ['04_content_engine'], objectiveTemplate: (raw) => raw },
            {
              stageIndex: 1,
              agentIds: ['05_creative_studio', '06_publishing_social'],
              objectiveTemplate: (raw) => `Prepare creative brief and Phase 3 publishing package for: ${raw}`,
            },
          ]
        : [{ stageIndex: 0, agentIds: ['04_content_engine'], objectiveTemplate: (raw) => raw }],
    };
  }

  // Multi-agent campaign / comprehensive brief -> staged parallel-safe DAG
  return {
    intentCategory: 'full_campaign',
    complexity: complexityHint || 'deep',
    stages: [
      {
        stageIndex: 0,
        agentIds: ['02_market_radar', '03_search_visibility'],
        objectiveTemplate: (raw) => `Conduct grounded market and search intelligence for: ${raw}`,
      },
      {
        stageIndex: 1,
        agentIds: ['04_content_engine'],
        objectiveTemplate: (raw) => `Synthesize upstream research into brand-aligned strategy and core draft for: ${raw}`,
      },
      {
        stageIndex: 2,
        agentIds: ['05_creative_studio', '06_publishing_social'],
        objectiveTemplate: (raw) => `Produce creative brief and Phase 3 draft publishing package for: ${raw}`,
      },
    ],
  };
}

export interface RunExecutionParams {
  uid: string;
  actorEmail: string;
  workspaceId: string;
  prompt: string;
  brandId?: string;
  conversationId?: string;
  playbookRunId?: string;
  preferredAgentIds?: AgentId[];
  complexityHint?: OrchestratorRunRecord['complexity'];
  idempotencyKey?: string;
  urlsToInspect?: string[];
  untrustedExternalBlocks?: Array<{ label: string; content: string }>;
  modelManager?: ModelProviderManager;
  ctx?: RepositoryContext;
  onProgress?: (event: AgentExecutionEvent) => void;
}

export interface OrchestratorExecutionBundle {
  run: OrchestratorRunRecord;
  tasks: AgentTaskRecord[];
  events: AgentExecutionEvent[];
  artifacts: AgentArtifactPayload[];
  sources: ResearchSourceRecord[];
  claims: ClaimEvidenceRecord[];
  usage: AiUsageLedgerRecord[];
}

export async function startAndExecuteOrchestratorRun(
  params: RunExecutionParams,
): Promise<OrchestratorExecutionBundle> {
  const { store, workspace } = await requireWorkspaceAccess(
    params.uid,
    params.workspaceId,
    'ai:run',
    params.ctx,
  );

  // Duplicate idempotency check
  if (params.idempotencyKey) {
    const existingRuns = await store.listWorkspaceSubcollection(params.workspaceId, 'aiRuns');
    const duplicate = existingRuns.find(
      (r) => r.idempotencyKey === params.idempotencyKey && r.workspaceId === params.workspaceId,
    ) as OrchestratorRunRecord | undefined;
    if (duplicate) {
      const [tasks, events, artifacts, sources, claims, usage] = await Promise.all([
        store.listWorkspaceSubcollection(params.workspaceId, 'agentTasks'),
        store.listWorkspaceSubcollection(params.workspaceId, 'agentExecutionEvents'),
        store.listWorkspaceSubcollection(params.workspaceId, 'agentArtifacts'),
        store.listWorkspaceSubcollection(params.workspaceId, 'researchSources'),
        store.listWorkspaceSubcollection(params.workspaceId, 'researchClaims'),
        store.listWorkspaceSubcollection(params.workspaceId, 'aiUsageLedger'),
      ]);
      return {
        run: duplicate,
        tasks: (tasks as unknown as AgentTaskRecord[]).filter((t) => t.runId === duplicate.id),
        events: (events as unknown as AgentExecutionEvent[]).filter((e) => e.runId === duplicate.id),
        artifacts: (artifacts as unknown as AgentArtifactPayload[]).filter((a) => a.runId === duplicate.id),
        sources: (sources as unknown as ResearchSourceRecord[]).filter((s) => s.runId === duplicate.id),
        claims: (claims as unknown as ClaimEvidenceRecord[]).filter((c) => c.runId === duplicate.id),
        usage: (usage as unknown as AiUsageLedgerRecord[]).filter((u) => u.runId === duplicate.id),
      };
    }
  }

  let brand: BrandProfile | null = null;
  let brandFacts: BrandKnowledgeFact[] = [];
  if (params.brandId) {
    brand = await getBrandInsideWorkspace(store, params.workspaceId, params.brandId);
    if (!brand) {
      throw new Error('Selected brand profile does not exist inside this workspace.');
    }
    brandFacts = await ensureBrandBaselineFacts(store, params.workspaceId, brand, params.uid);
  }

  const [memoryRaw, configRaw] = await Promise.all([
    store.listWorkspaceSubcollection(params.workspaceId, 'brandMemory'),
    store.listWorkspaceSubcollection(params.workspaceId, 'agentConfigs'),
  ]);

  const memoryItems = (memoryRaw as unknown as MemoryItem[]).filter(
    (m) => m.workspaceId === params.workspaceId,
  );
  const configMap = new Map(
    configRaw.map((c) => [c.agentId as AgentId, c as unknown as import('@/types/domain').AgentWorkspaceConfig]),
  );

  const plan = classifyPromptAndPlanDag(
    params.prompt,
    params.preferredAgentIds,
    params.complexityHint,
  );

  const runId = makeId('run');
  const correlationId = createCorrelationId();
  const nowIso = new Date().toISOString();

  // Flatten stages into cycle-free DAG AgentTaskRecords bounded by MAX_TOTAL_TASKS_PER_RUN
  const tasks: AgentTaskRecord[] = [];
  const taskIdsByStage: Record<number, string[]> = {};
  const selectedAgentsSet = new Set<AgentId>();

  for (const stage of plan.stages) {
    taskIdsByStage[stage.stageIndex] = [];
    for (const agentId of stage.agentIds) {
      if (tasks.length >= MAX_TOTAL_TASKS_PER_RUN) break;
      const cfg = configMap.get(agentId);
      if (cfg && cfg.enabled === false) continue;
      const tId = makeId('tsk');
      const prevStageIds = stage.stageIndex > 0 ? taskIdsByStage[stage.stageIndex - 1] || [] : [];
      selectedAgentsSet.add(agentId);
      taskIdsByStage[stage.stageIndex].push(tId);
      tasks.push({
        id: tId,
        workspaceId: params.workspaceId,
        runId,
        agentId,
        stageIndex: stage.stageIndex,
        dependsOnTaskIds: prevStageIds,
        objective: stage.objectiveTemplate(params.prompt),
        status: 'pending',
        attempt: 0,
        maxAttempts: getAgentDefinition(agentId).retryLimit + 1,
      });
    }
  }

  const run: OrchestratorRunRecord = {
    id: runId,
    workspaceId: params.workspaceId,
    ...(brand ? { brandId: brand.id } : {}),
    ...(params.conversationId ? { conversationId: params.conversationId } : {}),
    ...(params.playbookRunId ? { playbookRunId: params.playbookRunId } : {}),
    prompt: params.prompt,
    intentCategory: plan.intentCategory,
    complexity: plan.complexity,
    selectedAgents: Array.from(selectedAgentsSet),
    status: 'running',
    correlationId,
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalEstimatedCostUsd: null,
    createdBy: params.uid,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const events: AgentExecutionEvent[] = [];
  const appendEvent = async (
    eventType: AgentExecutionEvent['eventType'],
    message: string,
    extra?: { taskId?: string; agentId?: AgentId; detail?: Record<string, unknown> },
  ) => {
    const ev: AgentExecutionEvent = {
      id: makeId('evt'),
      workspaceId: params.workspaceId,
      runId,
      ...(extra?.taskId ? { taskId: extra.taskId } : {}),
      ...(extra?.agentId ? { agentId: extra.agentId } : {}),
      eventType,
      message,
      ...(extra?.detail ? { detailJson: JSON.stringify(extra.detail) } : {}),
      createdAt: new Date().toISOString(),
    };
    events.push(ev);
    params.onProgress?.(ev);
    await store.commit([
      {
        path: `workspaces/${params.workspaceId}/agentExecutionEvents/${ev.id}`,
        data: ev as unknown as Record<string, unknown>,
      },
    ]);
  };

  // Persist initial run + pending DAG tasks
  await store.commit([
    {
      path: `workspaces/${params.workspaceId}/aiRuns/${runId}`,
      data: run as unknown as Record<string, unknown>,
    },
    ...tasks.map((t) => ({
      path: `workspaces/${params.workspaceId}/agentTasks/${t.id}`,
      data: t as unknown as Record<string, unknown>,
    })),
  ]);

  await appendEvent('run_created', `Orchestrator accepted run (${plan.intentCategory} · ${plan.complexity}).`);
  await appendEvent(
    'plan_compiled',
    `Compiled ${tasks.length}-task DAG across ${plan.stages.length} stage(s) for workspace ${workspace.name}.`,
    { detail: { selectedAgents: run.selectedAgents } },
  );

  const modelManager = params.modelManager || createDefaultModelProviderManager();
  const artifacts: AgentArtifactPayload[] = [];
  const allSources: ResearchSourceRecord[] = [];
  const allClaims: ClaimEvidenceRecord[] = [];
  const usageRecords: AiUsageLedgerRecord[] = [];
  const completedResultsByTask = new Map<string, AgentResultContract>();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let costAccum = 0;
  let allCostsKnown = true;
  let anyNeedsConfig = false;
  let anyFailed = false;
  let anyCompleted = false;

  const uniqueStageIndices = Array.from(new Set(tasks.map((t) => t.stageIndex))).sort((a, b) => a - b);

  for (const stageIndex of uniqueStageIndices) {
    // Check live run cancellation before each stage
    const liveRun = (await store.getDoc(`workspaces/${params.workspaceId}/aiRuns/${runId}`)) as OrchestratorRunRecord | null;
    if (liveRun?.status === 'cancelled') {
      run.status = 'cancelled';
      await appendEvent('run_cancelled', 'Execution cancelled before next stage.');
      break;
    }

    const stageTasks = tasks.filter((t) => t.stageIndex === stageIndex);
    const upstreamSummaries = Array.from(completedResultsByTask.values())
      .map((r) => `[${r.agentId}] ${r.summary}\n${r.artifacts[0]?.contentMarkdown?.slice(0, 1200) || ''}`)
      .join('\n\n');

    // Execute parallel-safe tasks within the same stage concurrently
    await Promise.all(
      stageTasks.map(async (task) => {
        // Check token budget ceiling before starting
        if (totalInputTokens + totalOutputTokens >= DEFAULT_TOKEN_BUDGET_PER_RUN) {
          task.status = 'skipped';
          task.errorCode = 'AGENT_STEP_LIMIT_REACHED';
          task.errorMessage = 'Run token budget reached.';
          anyFailed = true;
          await store.commit([
            {
              path: `workspaces/${params.workspaceId}/agentTasks/${task.id}`,
              data: task as unknown as Record<string, unknown>,
            },
          ]);
          return;
        }

        const leaseId = makeId('lease');
        task.status = 'running';
        task.attempt += 1;
        task.leaseOwner = leaseId;
        task.leaseExpiresAt = new Date(Date.now() + 90_000).toISOString();
        task.startedAt = new Date().toISOString();

        await store.commit([
          {
            path: `workspaces/${params.workspaceId}/agentTasks/${task.id}`,
            data: task as unknown as Record<string, unknown>,
          },
        ]);

        await appendEvent('task_started', `Executing ${getAgentDefinition(task.agentId).name}...`, {
          taskId: task.id,
          agentId: task.agentId,
        });

        const specialistOut = await executeSpecialistAgent({
          workspaceId: params.workspaceId,
          actorUid: params.uid,
          runId,
          agentId: task.agentId,
          objective: task.objective,
          brand,
          brandFacts,
          memoryItems,
          agentConfig: configMap.get(task.agentId) || null,
          upstreamContext: upstreamSummaries || undefined,
          untrustedExternalBlocks: params.untrustedExternalBlocks,
          urlsToInspect: params.urlsToInspect,
          modelManager,
          onToolEvent: async (msg, detail) => {
            await appendEvent('tool_invoked', msg, {
              taskId: task.id,
              agentId: task.agentId,
              detail,
            });
          },
        });

        task.finishedAt = new Date().toISOString();
        task.resultJson = JSON.stringify(specialistOut.result);

        if (specialistOut.result.status === 'needs_configuration') {
          task.status = 'needs_configuration';
          task.errorCode = specialistOut.result.errorCode;
          task.errorMessage = specialistOut.result.errorMessage;
          anyNeedsConfig = true;
          await appendEvent('run_needs_configuration', specialistOut.result.summary, {
            taskId: task.id,
            agentId: task.agentId,
          });
        } else if (specialistOut.result.status === 'failed') {
          task.status = 'failed';
          task.errorCode = specialistOut.result.errorCode;
          task.errorMessage = specialistOut.result.errorMessage;
          anyFailed = true;
          await appendEvent(
            'task_failed',
            specialistOut.result.errorMessage || specialistOut.result.summary,
            { taskId: task.id, agentId: task.agentId },
          );
        } else {
          task.status = 'completed';
          anyCompleted = true;
          completedResultsByTask.set(task.id, specialistOut.result);

          totalInputTokens += specialistOut.result.usage.inputTokens;
          totalOutputTokens += specialistOut.result.usage.outputTokens;
          if (specialistOut.result.usage.estimatedCostUsd === null) {
            allCostsKnown = false;
          } else {
            costAccum += specialistOut.result.usage.estimatedCostUsd;
          }

          const ledger: AiUsageLedgerRecord = {
            id: makeId('usg'),
            workspaceId: params.workspaceId,
            runId,
            agentId: task.agentId,
            provider: specialistOut.result.usage.provider,
            model: specialistOut.result.usage.model,
            taskClass: getAgentDefinition(task.agentId).defaultTaskClass,
            inputTokens: specialistOut.result.usage.inputTokens,
            outputTokens: specialistOut.result.usage.outputTokens,
            estimatedCostUsd: specialistOut.result.usage.estimatedCostUsd,
            pricingKnown: specialistOut.result.usage.estimatedCostUsd !== null,
            isMock: specialistOut.result.usage.isMock,
            createdAt: new Date().toISOString(),
          };
          usageRecords.push(ledger);

          for (const art of specialistOut.result.artifacts) {
            artifacts.push({
              id: makeId('art'),
              workspaceId: params.workspaceId,
              runId,
              taskId: task.id,
              ...(brand ? { brandId: brand.id } : {}),
              agentId: task.agentId,
              kind: art.kind,
              title: art.title,
              summary: art.summary,
              contentMarkdown: art.contentMarkdown,
              structuredDataJson: JSON.stringify(art.structuredData || {}),
              verificationStatus:
                specialistOut.claims[0]?.verificationStatus || 'INFERRED',
              createdBy: params.uid,
              createdAt: new Date().toISOString(),
            });
          }

          allSources.push(...specialistOut.sources);
          allClaims.push(...specialistOut.claims);

          // Save proposed memory candidates as unapproved `candidate` items requiring provenance + owner approval
          for (const cand of specialistOut.result.memoryCandidates) {
            await createMemoryItem(store, params.workspaceId, params.uid, {
              brandId: brand?.id,
              namespace: cand.namespace,
              title: cand.title,
              content: cand.content,
              tags: cand.tags,
              status: 'candidate',
              verificationStatus: 'INFERRED',
              confidence: 0.65,
              provenanceRef: `run:${runId}/agent:${task.agentId}`,
              sourceRunId: runId,
              sourceAgentId: task.agentId,
            });
          }

          await appendEvent(
            'task_completed',
            `${getAgentDefinition(task.agentId).name} completed (QA: ${specialistOut.qaVerdict} · ${specialistOut.qaScore}/100).`,
            { taskId: task.id, agentId: task.agentId },
          );
        }

        await store.commit([
          {
            path: `workspaces/${params.workspaceId}/agentTasks/${task.id}`,
            data: task as unknown as Record<string, unknown>,
          },
        ]);
      }),
    );

    if (anyNeedsConfig) break;
  }

  // Persist artifacts, sources, claims, usage ledger
  if (artifacts.length > 0 || usageRecords.length > 0) {
    await store.commit([
      ...artifacts.map((a) => ({
        path: `workspaces/${params.workspaceId}/agentArtifacts/${a.id}`,
        data: a as unknown as Record<string, unknown>,
      })),
      ...usageRecords.map((u) => ({
        path: `workspaces/${params.workspaceId}/aiUsageLedger/${u.id}`,
        data: u as unknown as Record<string, unknown>,
      })),
    ]);
  }
  await saveResearchArtifacts(store, params.workspaceId, allSources, allClaims);

  // Determine final run state cleanly
  let finalStatus: OrchestratorRunStatus = 'completed';
  if (run.status === 'cancelled') {
    finalStatus = 'cancelled';
  } else if (anyNeedsConfig && !anyCompleted) {
    finalStatus = 'needs_configuration';
    run.errorCode = 'AI_PROVIDER_NOT_CONFIGURED';
    run.errorMessage =
      'AI provider credentials are not configured in server environment variables.';
  } else if (anyFailed && anyCompleted) {
    finalStatus = 'partially_completed';
    run.errorCode = 'WORKFLOW_PARTIALLY_COMPLETED';
  } else if (anyFailed && !anyCompleted) {
    finalStatus = 'failed';
    run.errorCode = 'TASK_EXECUTION_FAILED';
  }

  const completedList = Array.from(completedResultsByTask.values());
  const finalSummary =
    completedList.length > 0
      ? completedList.map((r) => `**${getAgentDefinition(r.agentId).name}:** ${r.summary}`).join(' ')
      : run.errorMessage || 'No specialist tasks completed.';

  const finalMarkdown =
    completedList.length > 0
      ? [
          `# Antara Intelligence Brief${brand ? ` · ${brand.name}` : ''}`,
          '',
          completedList
            .map(
              (r) =>
                `## ${getAgentDefinition(r.agentId).number} ${getAgentDefinition(r.agentId).name}\n${r.artifacts[0]?.contentMarkdown || r.summary}`,
            )
            .join('\n\n---\n\n'),
        ].join('\n')
      : `### Configuration Required\n${run.errorMessage || 'Configure an AI provider key to execute specialist inference.'}`;

  run.status = finalStatus;
  run.finalSummary = finalSummary.slice(0, 2000);
  run.finalMarkdown = finalMarkdown.slice(0, 24_000);
  run.qaVerdict = anyCompleted ? 'pass' : 'skipped';
  run.totalInputTokens = totalInputTokens;
  run.totalOutputTokens = totalOutputTokens;
  run.totalEstimatedCostUsd = allCostsKnown ? Number(costAccum.toFixed(6)) : null;
  run.updatedAt = new Date().toISOString();
  run.completedAt = run.updatedAt;

  await store.commit([
    {
      path: `workspaces/${params.workspaceId}/aiRuns/${run.id}`,
      data: run as unknown as Record<string, unknown>,
    },
  ]);

  await appendEvent(
    finalStatus === 'needs_configuration' ? 'run_needs_configuration' : 'run_completed',
    `Run finished with status ${finalStatus} (${artifacts.length} artifacts, ${allSources.length} sources, ${allClaims.length} evaluated claims).`,
  );

  await recordAuditLog(
    store,
    params.workspaceId,
    params.uid,
    params.actorEmail,
    'ai_run.executed',
    'aiRuns',
    run.id,
    `Executed AI command (${plan.intentCategory}) -> ${finalStatus}`,
  );

  return {
    run,
    tasks,
    events,
    artifacts,
    sources: allSources,
    claims: allClaims,
    usage: usageRecords,
  };
}

export async function cancelOrchestratorRun(
  uid: string,
  workspaceId: string,
  actorEmail: string,
  runId: string,
  ctx: RepositoryContext = {},
): Promise<OrchestratorRunRecord> {
  const { store } = await requireWorkspaceAccess(uid, workspaceId, 'ai:run', ctx);
  const raw = await store.getDoc(`workspaces/${workspaceId}/aiRuns/${runId}`);
  if (!raw || raw.workspaceId !== workspaceId) {
    throw new Error('Orchestrator run not found.');
  }
  const run = raw as unknown as OrchestratorRunRecord;
  const nowIso = new Date().toISOString();
  const updated: OrchestratorRunRecord = {
    ...run,
    status: 'cancelled',
    updatedAt: nowIso,
    completedAt: nowIso,
  };
  await store.commit([
    {
      path: `workspaces/${workspaceId}/aiRuns/${runId}`,
      data: updated as unknown as Record<string, unknown>,
    },
  ]);
  await recordAuditLog(
    store,
    workspaceId,
    uid,
    actorEmail,
    'ai_run.cancelled',
    'aiRuns',
    runId,
    'Cancelled AI orchestrator run.',
  );
  return updated;
}

export async function recordConversationTurn(
  store: DataStore,
  workspaceId: string,
  actorUid: string,
  params: {
    conversationId?: string;
    brandId?: string;
    userPrompt: string;
    assistantResponse: string;
    runId: string;
    status: OrchestratorRunStatus;
  },
): Promise<string> {
  const convId = params.conversationId || makeId('conv');
  const nowIso = new Date().toISOString();
  const existingConv = await store.getDoc(`workspaces/${workspaceId}/aiConversations/${convId}`);

  const convRecord = {
    id: convId,
    workspaceId,
    ...(params.brandId ? { brandId: params.brandId } : {}),
    title:
      (existingConv?.title as string) ||
      params.userPrompt.trim().slice(0, 90),
    lastRunId: params.runId,
    createdBy: (existingConv?.createdBy as string) || actorUid,
    createdAt: (existingConv?.createdAt as string) || nowIso,
    updatedAt: nowIso,
  };

  const userMsgId = makeId('msg');
  const assistantMsgId = makeId('msg');

  await store.commit([
    {
      path: `workspaces/${workspaceId}/aiConversations/${convId}`,
      data: convRecord,
    },
    {
      path: `workspaces/${workspaceId}/aiMessages/${userMsgId}`,
      data: {
        id: userMsgId,
        workspaceId,
        conversationId: convId,
        role: 'user',
        content: params.userPrompt,
        runId: params.runId,
        createdBy: actorUid,
        createdAt: nowIso,
      },
    },
    {
      path: `workspaces/${workspaceId}/aiMessages/${assistantMsgId}`,
      data: {
        id: assistantMsgId,
        workspaceId,
        conversationId: convId,
        role: 'assistant',
        content: params.assistantResponse,
        runId: params.runId,
        status: params.status,
        createdBy: actorUid,
        createdAt: new Date(Date.now() + 1).toISOString(),
      },
    },
  ]);

  return convId;
}
