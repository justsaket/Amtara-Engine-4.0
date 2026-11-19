import { estimateStringTokens } from '@/lib/ai/model-router';
import type { MemoryItem, MemoryNamespace } from '@/types/domain';

export interface MemoryNamespaceMeta {
  id: MemoryNamespace;
  label: string;
  description: string;
}

export const MEMORY_NAMESPACE_CATALOG: readonly MemoryNamespaceMeta[] = [
  {
    id: 'workspace_memory',
    label: 'Workspace Memory',
    description: 'Organization-wide operating conventions, timezones, and workflow norms.',
  },
  {
    id: 'brand_memory',
    label: 'Brand Memory',
    description: 'Approved voice nuances, audience insights, and positioning refinements.',
  },
  {
    id: 'content_memory',
    label: 'Content Memory',
    description: 'High-performing editorial hooks, structures, and messaging patterns.',
  },
  {
    id: 'performance_memory',
    label: 'Performance Memory',
    description: 'Verified historical campaign outcomes and channel engagement patterns.',
  },
  {
    id: 'research_memory',
    label: 'Research Memory',
    description: 'Verified competitor intelligence, market shifts, and search keyword insights.',
  },
  {
    id: 'decision_memory',
    label: 'Decision Memory',
    description: 'Strategic trade-offs and architectural choices approved by workspace owners.',
  },
  {
    id: 'rejection_memory',
    label: 'Rejection Memory',
    description: 'Rejected drafts, disallowed phrasings, and feedback loops to prevent repeat mistakes.',
  },
] as const;

export interface RetrievedMemoryBundle {
  approvedItems: MemoryItem[];
  rejectionGuardrails: MemoryItem[];
  formattedContext: string;
  totalEstimatedTokens: number;
}

function tokenizeQuery(text: string): Set<string> {
  return new Set(
    (text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3),
  );
}

function scoreMemoryRelevance(
  item: MemoryItem,
  queryTerms: Set<string>,
  brandId?: string,
  preferredNamespaces?: MemoryNamespace[],
): number {
  let score = 0;

  if (brandId && item.brandId === brandId) {
    score += 40;
  } else if (!item.brandId) {
    score += 15;
  } else if (brandId && item.brandId && item.brandId !== brandId) {
    // Strictly penalize another brand's memory so brand contexts do not leak
    return -1;
  }

  if (preferredNamespaces && preferredNamespaces.includes(item.namespace)) {
    score += 20;
  }

  if (item.verificationStatus === 'VERIFIED') score += 20;
  else if (item.verificationStatus === 'SUPPORTED') score += 12;
  else if (item.verificationStatus === 'INFERRED') score += 5;
  else if (item.verificationStatus === 'CONTRADICTED') return -1;

  const haystack = `${item.title} ${item.content} ${item.tags.join(' ')}`.toLowerCase();
  for (const term of queryTerms) {
    if (haystack.includes(term)) score += 8;
  }

  return score;
}

export function retrieveBoundedMemoryContext(options: {
  allItems: MemoryItem[];
  query: string;
  brandId?: string;
  allowedNamespaces: MemoryNamespace[];
  maxTokens?: number;
  maxItems?: number;
}): RetrievedMemoryBundle {
  const maxTokens = options.maxTokens ?? 1100;
  const maxItems = options.maxItems ?? 10;
  const queryTerms = tokenizeQuery(options.query);

  const rejectionGuardrails = options.allItems
    .filter(
      (m) =>
        (m.namespace === 'rejection_memory' || m.status === 'rejected') &&
        (!options.brandId || !m.brandId || m.brandId === options.brandId),
    )
    .slice(0, 4);

  const scoredApproved = options.allItems
    .filter(
      (m) =>
        m.status === 'approved' &&
        m.namespace !== 'rejection_memory' &&
        options.allowedNamespaces.includes(m.namespace),
    )
    .map((item) => ({
      item,
      score: scoreMemoryRelevance(
        item,
        queryTerms,
        options.brandId,
        options.allowedNamespaces,
      ),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt));

  const selectedApproved: MemoryItem[] = [];
  const lines: string[] = [];
  let usedTokens = 0;

  for (const { item } of scoredApproved) {
    if (selectedApproved.length >= maxItems) break;
    const line = `- [${item.namespace} | ${item.verificationStatus}] ${item.title}: ${item.content}`;
    const tokens = estimateStringTokens(line);
    if (usedTokens + tokens > maxTokens - 200) break;
    selectedApproved.push(item);
    lines.push(line);
    usedTokens += tokens;
  }

  if (rejectionGuardrails.length > 0) {
    lines.push('', 'Rejection Guardrails (DO NOT REPEAT):');
    for (const rej of rejectionGuardrails) {
      const line = `- [AVOID] ${rej.title}: ${rej.content}`;
      const tokens = estimateStringTokens(line);
      if (usedTokens + tokens > maxTokens) break;
      lines.push(line);
      usedTokens += tokens;
    }
  }

  return {
    approvedItems: selectedApproved,
    rejectionGuardrails,
    formattedContext: lines.join('\n'),
    totalEstimatedTokens: usedTokens,
  };
}
