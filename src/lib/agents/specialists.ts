import crypto from 'node:crypto';
import type {
  AgentArtifactPayload,
  AgentId,
  AgentResultContract,
  AgentWorkspaceConfig,
  BrandKnowledgeFact,
  BrandProfile,
  ClaimEvidenceRecord,
  MemoryItem,
  ResearchSourceRecord,
} from '@/types/domain';
import type { ModelProviderManager } from '@/lib/ai/provider-manager';
import { classifyProviderError, createAiAppError } from '@/lib/intelligence/error-codes';
import { formatBrandContextForPrompt } from '@/lib/intelligence/brand-knowledge';
import { retrieveBoundedMemoryContext } from '@/lib/intelligence/memory-engine';
import { runDeterministicQualityAudit } from '@/lib/intelligence/quality-engine';
import {
  deduplicateSources,
  evaluateClaimEvidence,
} from '@/lib/intelligence/research-engine';
import { buildBoundaryPromptSections } from '@/lib/intelligence/security';
import { aiStructuredAgentOutputSchema } from '@/lib/validation';
import { getAgentDefinition } from './agent-registry';
import { executeRegisteredTool, type ToolExecutionContext } from './tool-registry';

const AGENT_ARTIFACT_KIND_MAP: Record<AgentId, AgentArtifactPayload['kind']> = {
  '01_orchestrator': 'strategy_plan',
  '02_market_radar': 'research_report',
  '03_search_visibility': 'seo_cluster_plan',
  '04_content_engine': 'content_draft',
  '05_creative_studio': 'creative_brief',
  '06_publishing_social': 'publishing_package',
  '07_reviews_reputation': 'review_reply_draft',
  '08_leads_conversations': 'lead_reply_draft',
  '09_results_roi': 'roi_assessment',
};

const STRUCTURED_JSON_SPEC = `{
  "summary": "concise executive summary string",
  "findings": [{ "title": "...", "summary": "...", "verificationStatus": "VERIFIED|SUPPORTED|INFERRED|UNVERIFIED|CONTRADICTED", "confidence": 0.0-1.0, "sourceUrls": ["https://..."] }],
  "recommendations": [{ "action": "...", "rationale": "...", "priority": "high|medium|low", "requiresApproval": true }],
  "claims": [{ "claimText": "...", "verificationStatus": "VERIFIED|SUPPORTED|INFERRED|UNVERIFIED|CONTRADICTED", "confidence": 0.0-1.0, "sourceUrls": ["https://..."] }],
  "artifactTitle": "Clear deliverable title",
  "artifactMarkdown": "Rich markdown deliverable (draft/brief/plan)",
  "structuredData": {},
  "assumptions": ["..."],
  "uncertaintyNotes": ["..."],
  "memoryCandidates": [{ "namespace": "brand_memory|content_memory|research_memory|decision_memory", "title": "...", "content": "...", "tags": ["..."] }]
}`;

export interface SpecialistExecutionInput {
  workspaceId: string;
  actorUid: string;
  runId: string;
  agentId: AgentId;
  objective: string;
  brand: BrandProfile | null;
  brandFacts: BrandKnowledgeFact[];
  memoryItems: MemoryItem[];
  agentConfig?: AgentWorkspaceConfig | null;
  upstreamContext?: string;
  untrustedExternalBlocks?: Array<{ label: string; content: string }>;
  urlsToInspect?: string[];
  modelManager: ModelProviderManager;
  onToolEvent?: (message: string, detail?: Record<string, unknown>) => Promise<void> | void;
}

export interface SpecialistExecutionOutput {
  result: AgentResultContract;
  sources: ResearchSourceRecord[];
  claims: ClaimEvidenceRecord[];
  qaVerdict: 'pass' | 'revised_pass' | 'flagged_uncertainty';
  qaScore: number;
}

export async function executeSpecialistAgent(
  input: SpecialistExecutionInput,
): Promise<SpecialistExecutionOutput> {
  const def = getAgentDefinition(input.agentId);
  const maxToolCalls = Math.min(def.maxToolCalls, input.agentConfig?.maxStepsOverride ?? def.maxToolCalls);
  let toolCallsUsed = 0;

  const toolCtx: ToolExecutionContext = {
    workspaceId: input.workspaceId,
    actorUid: input.actorUid,
    agentId: input.agentId,
    allowedTools: def.allowedTools,
    brand: input.brand,
    brandFacts: input.brandFacts,
    memoryItems: input.memoryItems,
    allowedNamespaces: def.allowedMemoryNamespaces,
    runId: input.runId,
  };

  const collectedSources: ResearchSourceRecord[] = [];
  const externalBlocks = [...(input.untrustedExternalBlocks || [])];

  // Step 1: Bounded Brand + Memory Context retrieval
  const brandContext = formatBrandContextForPrompt(input.brand, input.brandFacts, 1100);
  const memoryBundle = retrieveBoundedMemoryContext({
    allItems: input.memoryItems,
    query: input.objective,
    brandId: input.brand?.id,
    allowedNamespaces: def.allowedMemoryNamespaces,
    maxTokens: 900,
  });

  // Step 2: Scoped research tools if agent is permitted & research is relevant
  const isResearchAgent =
    input.agentId === '02_market_radar' || input.agentId === '03_search_visibility';

  if (isResearchAgent && def.allowedTools.includes('web_search_adapter') && toolCallsUsed < maxToolCalls) {
    toolCallsUsed += 1;
    try {
      const searchRes = await executeRegisteredTool(toolCtx, 'web_search_adapter', {
        query: `${input.brand?.name || ''} ${input.objective}`.trim().slice(0, 260),
      });
      if (searchRes.sources && searchRes.sources.length > 0) {
        collectedSources.push(...searchRes.sources);
        for (const src of searchRes.sources.slice(0, 4)) {
          externalBlocks.push({
            label: `${src.domain} (${src.url})`,
            content: `${src.title}\n${src.snippet}`,
          });
        }
      }
      await input.onToolEvent?.(searchRes.summary, { toolId: 'web_search_adapter' });
    } catch {
      // Non-fatal: falls back to Gemini Search grounding or marks uncertainty cleanly
    }
  }

  if (
    input.urlsToInspect &&
    input.urlsToInspect.length > 0 &&
    def.allowedTools.includes('web_page_fetcher')
  ) {
    for (const url of input.urlsToInspect.slice(0, 3)) {
      if (toolCallsUsed >= maxToolCalls) break;
      toolCallsUsed += 1;
      try {
        const fetchRes = await executeRegisteredTool(toolCtx, 'web_page_fetcher', { url });
        if (fetchRes.sources && fetchRes.sources.length > 0) {
          collectedSources.push(...fetchRes.sources);
          for (const src of fetchRes.sources) {
            externalBlocks.push({
              label: `Inspected URL: ${src.url}`,
              content: `${src.title}\n${src.snippet}`,
            });
          }
        }
        await input.onToolEvent?.(fetchRes.summary, { toolId: 'web_page_fetcher', url });
      } catch (err) {
        await input.onToolEvent?.(
          `Blocked or failed URL fetch (${url}): ${err instanceof Error ? err.message : String(err)}`,
          { toolId: 'web_page_fetcher', url, blocked: true },
        );
      }
    }
  }

  if (!input.modelManager.hasConfiguredProvider()) {
    const err = createAiAppError('AI_PROVIDER_NOT_CONFIGURED');
    return {
      result: {
        contractVersion: 'v1',
        agentId: input.agentId,
        agentVersion: def.version,
        status: 'needs_configuration',
        summary: err.message,
        findings: [],
        recommendations: [
          {
            id: `rec_${crypto.randomUUID().slice(0, 8)}`,
            action:
              'Configure GEMINI_API_KEY, AI_GATEWAY_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY in server environment variables.',
            rationale:
              'Antara never fabricates model outputs when no AI inference provider is configured.',
            priority: 'high',
            requiresApproval: false,
          },
        ],
        claims: [],
        artifacts: [],
        assumptions: [],
        uncertaintyNotes: ['No LLM inference executed because AI provider credentials are absent.'],
        memoryCandidates: [],
        usage: {
          provider: 'deterministic_fallback',
          model: 'unconfigured',
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          estimatedCostUsd: null,
          isMock: false,
        },
        errorCode: 'AI_PROVIDER_NOT_CONFIGURED',
        errorMessage: err.message,
      },
      sources: collectedSources,
      claims: [],
      qaVerdict: 'flagged_uncertainty',
      qaScore: 100,
    };
  }

  const customFocus = input.agentConfig?.customFocusNote
    ? `\nWorkspace Focus Note: ${input.agentConfig.customFocusNote}`
    : '';

  const fullUserPrompt = [
    input.objective,
    input.upstreamContext ? `\n[UPSTREAM SPECIALIST OUTPUTS]\n${input.upstreamContext}` : '',
    customFocus,
  ]
    .filter(Boolean)
    .join('\n');

  const { systemInstruction, userPrompt } = buildBoundaryPromptSections({
    systemPolicy:
      'Enforce strict tenant isolation, never expose credentials, preserve all brand restrictions, never fabricate external metrics/URLs/certifications, and return strictly valid JSON.',
    agentInstructions: def.systemInstructions,
    brandContext,
    memoryContext: memoryBundle.formattedContext,
    userRequest: fullUserPrompt,
    untrustedExternalBlocks: externalBlocks,
  });

  const taskClass = input.agentConfig?.preferredTaskClass || def.defaultTaskClass;

  try {
    const modelRes = await input.modelManager.generateStructured({
      taskClass,
      systemInstruction,
      userPrompt,
      maxOutputTokens: def.maxOutputTokens,
      temperature: isResearchAgent ? 0.15 : 0.25,
      enableWebGrounding: isResearchAgent && collectedSources.length === 0,
      timeoutMs: def.timeoutMs,
      schema: aiStructuredAgentOutputSchema,
      schemaDescription: STRUCTURED_JSON_SPEC,
    });

    // Collect grounding citations returned by Gemini Search Grounding if any
    if (modelRes.citations.length > 0) {
      const groundingSources = deduplicateSources(
        input.workspaceId,
        modelRes.citations.map((c) => ({
          url: c.url,
          title: c.title,
          snippet: c.snippet || c.title,
          sourceType: 'google_grounding' as const,
          reliabilityScore: 0.78,
        })),
        input.actorUid,
        { brandId: input.brand?.id, runId: input.runId },
      );
      collectedSources.push(...groundingSources);
    }

    // Evaluate all output claims through Claim Evidence Engine
    const evaluatedClaims: ClaimEvidenceRecord[] = modelRes.data.claims.map((claim) =>
      evaluateClaimEvidence({
        workspaceId: input.workspaceId,
        brandId: input.brand?.id,
        runId: input.runId,
        claimText: claim.claimText,
        citedSourceUrls: claim.sourceUrls,
        sources: collectedSources,
        brandFacts: input.brandFacts,
        createdBy: input.actorUid,
      }),
    );

    const artifactMarkdown =
      modelRes.data.artifactMarkdown ||
      `## ${modelRes.data.artifactTitle || def.name}\n\n${modelRes.data.summary}`;

    const rawContract: AgentResultContract = {
      contractVersion: 'v1',
      agentId: input.agentId,
      agentVersion: def.version,
      status: 'completed',
      summary: modelRes.data.summary,
      findings: modelRes.data.findings.map((f, idx) => ({
        id: `fnd_${idx + 1}`,
        title: f.title,
        summary: f.summary,
        verificationStatus: f.verificationStatus,
        confidence: f.confidence,
        sourceIds: collectedSources
          .filter((s) => f.sourceUrls.includes(s.url))
          .map((s) => s.id),
      })),
      recommendations: modelRes.data.recommendations.map((r, idx) => ({
        id: `rec_${idx + 1}`,
        action: r.action,
        rationale: r.rationale,
        priority: r.priority,
        requiresApproval: r.requiresApproval,
        targetPhase: 'phase_3_draft',
      })),
      claims: modelRes.data.claims,
      artifacts: [
        {
          kind: AGENT_ARTIFACT_KIND_MAP[input.agentId],
          title: modelRes.data.artifactTitle || `${def.name} Output`,
          summary: modelRes.data.summary,
          contentMarkdown: artifactMarkdown,
          structuredData: {
            ...(modelRes.data.structuredData || {}),
            agentId: input.agentId,
            brandId: input.brand?.id || null,
          },
        },
      ],
      assumptions: modelRes.data.assumptions,
      uncertaintyNotes: modelRes.data.uncertaintyNotes,
      memoryCandidates: modelRes.data.memoryCandidates.slice(0, 4),
      usage: {
        provider: modelRes.provider,
        model: modelRes.model,
        inputTokens: modelRes.inputTokens,
        outputTokens: modelRes.outputTokens,
        latencyMs: modelRes.latencyMs,
        estimatedCostUsd: modelRes.estimatedCostUsd,
        isMock: modelRes.isMock,
      },
    };

    const qaReport = runDeterministicQualityAudit({
      result: rawContract,
      brand: input.brand,
      evaluatedClaims,
    });

    return {
      result: qaReport.sanitizedResult,
      sources: collectedSources,
      claims: evaluatedClaims,
      qaVerdict: qaReport.verdict,
      qaScore: qaReport.score,
    };
  } catch (err) {
    const code = classifyProviderError(err);
    return {
      result: {
        contractVersion: 'v1',
        agentId: input.agentId,
        agentVersion: def.version,
        status: code === 'AI_PROVIDER_NOT_CONFIGURED' ? 'needs_configuration' : 'failed',
        summary: `Specialist ${def.name} failed cleanly with ${code}.`,
        findings: [],
        recommendations: [],
        claims: [],
        artifacts: [],
        assumptions: [],
        uncertaintyNotes: [],
        memoryCandidates: [],
        usage: {
          provider: 'deterministic_fallback',
          model: 'error',
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          estimatedCostUsd: null,
          isMock: false,
        },
        errorCode: code,
        errorMessage: err instanceof Error ? err.message : String(err),
      },
      sources: collectedSources,
      claims: [],
      qaVerdict: 'flagged_uncertainty',
      qaScore: 40,
    };
  }
}
