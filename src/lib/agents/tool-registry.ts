import { z } from 'zod';
import type {
  AgentId,
  BrandKnowledgeFact,
  BrandProfile,
  MemoryItem,
  ResearchSourceRecord,
  ToolId,
} from '@/types/domain';
import { createAiAppError } from '@/lib/intelligence/error-codes';
import { formatBrandContextForPrompt } from '@/lib/intelligence/brand-knowledge';
import { retrieveBoundedMemoryContext } from '@/lib/intelligence/memory-engine';
import {
  deduplicateSources,
  fetchSafeExternalPage,
  normalizeUrlKey,
  searchWebWithConfiguredProvider,
} from '@/lib/intelligence/research-engine';
import { validateExternalResearchUrl } from '@/lib/intelligence/security';

export interface ToolDescriptor {
  id: ToolId;
  name: string;
  category: 'brand' | 'memory' | 'research' | 'strategy' | 'drafting' | 'qa';
  description: string;
  readOnly: boolean;
  requiresExternalNetwork: boolean;
}

export const TOOL_CATALOG: Record<ToolId, ToolDescriptor> = {
  brand_knowledge_reader: {
    id: 'brand_knowledge_reader',
    name: 'Brand Knowledge Reader',
    category: 'brand',
    description: 'Reads verified workspace brand facts and restrictions.',
    readOnly: true,
    requiresExternalNetwork: false,
  },
  brand_voice_and_restrictions_reader: {
    id: 'brand_voice_and_restrictions_reader',
    name: 'Brand Voice & Restrictions Reader',
    category: 'brand',
    description: 'Reads tone, audience, content pillars, and non-negotiable brand restrictions.',
    readOnly: true,
    requiresExternalNetwork: false,
  },
  memory_retriever: {
    id: 'memory_retriever',
    name: 'Bounded Memory Retriever',
    category: 'memory',
    description: 'Retrieves token-budgeted approved workspace and brand memories plus rejection guardrails.',
    readOnly: true,
    requiresExternalNetwork: false,
  },
  memory_candidate_proposer: {
    id: 'memory_candidate_proposer',
    name: 'Memory Candidate Proposer',
    category: 'memory',
    description: 'Proposes candidate memory entries requiring provenance and owner approval.',
    readOnly: false,
    requiresExternalNetwork: false,
  },
  web_search_adapter: {
    id: 'web_search_adapter',
    name: 'Web Search Adapter',
    category: 'research',
    description: 'Queries configured search API or Google Search grounding cleanly without inventing results.',
    readOnly: true,
    requiresExternalNetwork: true,
  },
  web_page_fetcher: {
    id: 'web_page_fetcher',
    name: 'SSRF-Guarded Web Fetcher',
    category: 'research',
    description: 'Fetches public https/http pages with private IP rejection and prompt-injection isolation.',
    readOnly: true,
    requiresExternalNetwork: true,
  },
  citation_normalizer: {
    id: 'citation_normalizer',
    name: 'Citation Normalizer',
    category: 'research',
    description: 'Normalizes URLs, deduplicates sources by SHA-256 content hash, and tracks retrieval dates.',
    readOnly: true,
    requiresExternalNetwork: false,
  },
  keyword_cluster_builder: {
    id: 'keyword_cluster_builder',
    name: 'SEO Keyword Cluster Builder',
    category: 'research',
    description: 'Structures search intent clusters and page-level opportunities without inventing traffic metrics.',
    readOnly: true,
    requiresExternalNetwork: false,
  },
  strategy_planner: {
    id: 'strategy_planner',
    name: 'Content Strategy Planner',
    category: 'strategy',
    description: 'Generates structured 7/14/30-day multi-channel content calendars.',
    readOnly: false,
    requiresExternalNetwork: false,
  },
  content_draft_writer: {
    id: 'content_draft_writer',
    name: 'Content Draft Writer',
    category: 'drafting',
    description: 'Produces brand-grounded LinkedIn, blog, email, and script drafts (drafts only, never auto-published).',
    readOnly: false,
    requiresExternalNetwork: false,
  },
  creative_brief_builder: {
    id: 'creative_brief_builder',
    name: 'Creative Brief Builder',
    category: 'drafting',
    description: 'Builds visual direction, hooks, carousel frames, and video storyboards.',
    readOnly: false,
    requiresExternalNetwork: false,
  },
  publishing_package_builder: {
    id: 'publishing_package_builder',
    name: 'Publishing Package Builder',
    category: 'drafting',
    description: 'Assembles Phase 3 channel-ready draft packages for future Phase 4 approval.',
    readOnly: false,
    requiresExternalNetwork: false,
  },
  review_reply_drafter: {
    id: 'review_reply_drafter',
    name: 'Review Reply Drafter',
    category: 'drafting',
    description: 'Prepares escalated, brand-safe review response drafts without auto-posting.',
    readOnly: false,
    requiresExternalNetwork: false,
  },
  lead_response_drafter: {
    id: 'lead_response_drafter',
    name: 'Lead Response Drafter',
    category: 'drafting',
    description: 'Qualifies lead inquiries and prepares reply drafts with timezone awareness.',
    readOnly: false,
    requiresExternalNetwork: false,
  },
  performance_snapshot_reader: {
    id: 'performance_snapshot_reader',
    name: 'Performance Snapshot Reader',
    category: 'strategy',
    description: 'Reads verified historical usage, artifact, and performance memory records.',
    readOnly: true,
    requiresExternalNetwork: false,
  },
  quality_assurance_checker: {
    id: 'quality_assurance_checker',
    name: 'Quality Assurance Checker',
    category: 'qa',
    description: 'Validates brand restrictions, verification badges, and Phase 3 boundaries.',
    readOnly: true,
    requiresExternalNetwork: false,
  },
};

export interface ToolExecutionContext {
  workspaceId: string;
  actorUid: string;
  agentId: AgentId;
  allowedTools: ToolId[];
  brand: BrandProfile | null;
  brandFacts: BrandKnowledgeFact[];
  memoryItems: MemoryItem[];
  allowedNamespaces: MemoryItem['namespace'][];
  runId: string;
}

const searchArgsSchema = z.object({
  query: z.string().min(2).max(400),
});

const fetchUrlArgsSchema = z.object({
  url: z.string().min(8).max(512),
});

export async function executeRegisteredTool(
  ctx: ToolExecutionContext,
  toolId: ToolId,
  rawArgs: Record<string, unknown>,
): Promise<{
  ok: boolean;
  toolId: ToolId;
  summary: string;
  sources?: ResearchSourceRecord[];
  data: Record<string, unknown>;
}> {
  if (!ctx.allowedTools.includes(toolId)) {
    throw createAiAppError(
      'TOOL_PERMISSION_DENIED',
      `Agent ${ctx.agentId} is not permitted to invoke tool "${toolId}".`,
    );
  }

  switch (toolId) {
    case 'brand_knowledge_reader':
    case 'brand_voice_and_restrictions_reader': {
      const formatted = formatBrandContextForPrompt(ctx.brand, ctx.brandFacts, 1200);
      return {
        ok: true,
        toolId,
        summary: ctx.brand
          ? `Loaded verified profile and ${ctx.brandFacts.length} knowledge records for ${ctx.brand.name}.`
          : 'Loaded workspace-level context (no specific brand selected).',
        data: {
          brandName: ctx.brand?.name || null,
          restrictions: ctx.brand?.restrictions || null,
          formattedContext: formatted,
        },
      };
    }

    case 'memory_retriever': {
      const query = typeof rawArgs.query === 'string' ? rawArgs.query : '';
      const bundle = retrieveBoundedMemoryContext({
        allItems: ctx.memoryItems,
        query,
        brandId: ctx.brand?.id,
        allowedNamespaces: ctx.allowedNamespaces,
        maxTokens: 1000,
      });
      return {
        ok: true,
        toolId,
        summary: `Retrieved ${bundle.approvedItems.length} approved memories and ${bundle.rejectionGuardrails.length} rejection guardrails.`,
        data: {
          approvedCount: bundle.approvedItems.length,
          rejectionCount: bundle.rejectionGuardrails.length,
          formattedContext: bundle.formattedContext,
        },
      };
    }

    case 'web_search_adapter': {
      const parsed = searchArgsSchema.parse(rawArgs);
      const res = await searchWebWithConfiguredProvider(parsed.query);
      const sources = deduplicateSources(
        ctx.workspaceId,
        res.hits,
        ctx.actorUid,
        { brandId: ctx.brand?.id, runId: ctx.runId },
      );
      return {
        ok: res.providerUsed !== null || sources.length > 0,
        toolId,
        summary: res.providerUsed
          ? `Found ${sources.length} external sources via ${res.providerUsed}.`
          : 'No standalone search API configured; rely on model web grounding if available or mark source unavailable.',
        sources,
        data: {
          providerUsed: res.providerUsed,
          sourceCount: sources.length,
        },
      };
    }

    case 'web_page_fetcher': {
      const parsed = fetchUrlArgsSchema.parse(rawArgs);
      const check = validateExternalResearchUrl(parsed.url);
      if (!check.valid) {
        throw createAiAppError('SOURCE_VERIFICATION_FAILED', check.reason);
      }
      const hit = await fetchSafeExternalPage(parsed.url);
      const sources = deduplicateSources(ctx.workspaceId, [hit], ctx.actorUid, {
        brandId: ctx.brand?.id,
        runId: ctx.runId,
      });
      return {
        ok: true,
        toolId,
        summary: `Fetched and isolated external page from ${check.domain}.`,
        sources,
        data: {
          domain: check.domain,
          url: normalizeUrlKey(parsed.url),
          snippetPreview: hit.snippet.slice(0, 300),
        },
      };
    }

    default: {
      return {
        ok: true,
        toolId,
        summary: `Validated scoped Phase 3 read/draft capability "${toolId}".`,
        data: { phaseBoundary: 'phase_3_draft_only' },
      };
    }
  }
}
