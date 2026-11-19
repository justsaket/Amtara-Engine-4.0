import crypto from 'node:crypto';
import type {
  BrandKnowledgeFact,
  ClaimEvidenceRecord,
  ResearchSourceRecord,
  VerificationStatus,
} from '@/types/domain';
import { createAiAppError } from './error-codes';
import {
  sanitizeUntrustedText,
  validateExternalResearchUrl,
} from './security';

export interface RawWebSearchHit {
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
  sourceType: ResearchSourceRecord['sourceType'];
  reliabilityScore: number;
}

export function normalizeUrlKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl.trim());
    u.hash = '';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return rawUrl.trim();
  }
}

export function hashSourceContent(url: string, snippet: string): string {
  return crypto
    .createHash('sha256')
    .update(`${normalizeUrlKey(url)}::${snippet.trim().slice(0, 1000)}`)
    .digest('hex')
    .slice(0, 32);
}

export function estimateDomainReliability(domain: string): number {
  const d = domain.toLowerCase();
  if (d.endsWith('.gov') || d.endsWith('.edu') || d.endsWith('.gov.in')) return 0.92;
  if (
    d.includes('reuters.com') ||
    d.includes('bloomberg.com') ||
    d.includes('developers.google.com') ||
    d.includes('support.google.com') ||
    d.includes('standards') ||
    d.includes('iso.org')
  ) {
    return 0.88;
  }
  if (d.includes('reddit.com') || d.includes('quora.com') || d.includes('medium.com')) {
    return 0.52;
  }
  return 0.72;
}

function stripHtmlToPlainText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 160) : '';
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const text = withoutScripts
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, text };
}

export async function fetchSafeExternalPage(
  rawUrl: string,
  timeoutMs = 10_000,
): Promise<RawWebSearchHit> {
  const validation = validateExternalResearchUrl(rawUrl);
  if (!validation.valid || !validation.normalizedUrl || !validation.domain) {
    throw createAiAppError('SOURCE_VERIFICATION_FAILED', validation.reason);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(validation.normalizedUrl, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'AntaraEngineResearchBot/4.0 (+https://antara.local)',
        Accept: 'text/html,application/json,text/plain',
      },
    });

    if (!res.ok) {
      throw createAiAppError(
        'RESEARCH_SOURCE_UNAVAILABLE',
        `Remote source returned HTTP ${res.status} for ${validation.domain}.`,
      );
    }

    const finalCheck = validateExternalResearchUrl(res.url || validation.normalizedUrl);
    if (!finalCheck.valid || !finalCheck.domain) {
      throw createAiAppError(
        'SOURCE_VERIFICATION_FAILED',
        'Redirect target failed SSRF security validation.',
      );
    }

    const rawBody = (await res.text()).slice(0, 180_000);
    const { title, text } = stripHtmlToPlainText(rawBody);
    const safe = sanitizeUntrustedText(text, 2000);

    return {
      url: finalCheck.normalizedUrl || validation.normalizedUrl,
      title: sanitizeUntrustedText(title || finalCheck.domain, 160).sanitized,
      snippet: safe.sanitized.slice(0, 1200),
      sourceType: 'web_fetch',
      reliabilityScore: estimateDomainReliability(finalCheck.domain),
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AppError') throw err;
    throw createAiAppError(
      'RESEARCH_SOURCE_UNAVAILABLE',
      `Failed fetching ${validation.domain}: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function searchWebWithConfiguredProvider(
  query: string,
): Promise<{ hits: RawWebSearchHit[]; providerUsed: string | null }> {
  const tavilyKey = (process.env.TAVILY_API_KEY || process.env.SEARCH_API_KEY || '').trim();
  if (tavilyKey && tavilyKey.length >= 8) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: query.slice(0, 400),
          max_results: 6,
          include_answer: false,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          results?: Array<{
            url?: string;
            title?: string;
            content?: string;
            published_date?: string;
          }>;
        };
        const hits: RawWebSearchHit[] = [];
        for (const row of data.results || []) {
          if (!row.url) continue;
          const v = validateExternalResearchUrl(row.url);
          if (!v.valid || !v.domain || !v.normalizedUrl) continue;
          hits.push({
            url: v.normalizedUrl,
            title: sanitizeUntrustedText(row.title || v.domain, 180).sanitized,
            snippet: sanitizeUntrustedText(row.content || '', 1200).sanitized,
            publishedAt: row.published_date,
            sourceType: 'search_api',
            reliabilityScore: estimateDomainReliability(v.domain),
          });
        }
        return { hits, providerUsed: 'tavily' };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return { hits: [], providerUsed: null };
}

export function deduplicateSources(
  workspaceId: string,
  hits: RawWebSearchHit[],
  createdBy: string,
  options?: { brandId?: string; runId?: string },
): ResearchSourceRecord[] {
  const seenUrls = new Set<string>();
  const seenHashes = new Set<string>();
  const nowIso = new Date().toISOString();
  const out: ResearchSourceRecord[] = [];

  for (const hit of hits) {
    const validation = validateExternalResearchUrl(hit.url);
    if (!validation.valid || !validation.normalizedUrl || !validation.domain) continue;
    const normUrl = normalizeUrlKey(validation.normalizedUrl);
    const contentHash = hashSourceContent(normUrl, hit.snippet);
    if (seenUrls.has(normUrl) || seenHashes.has(contentHash)) continue;
    seenUrls.add(normUrl);
    seenHashes.add(contentHash);

    out.push({
      id: `src_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      workspaceId,
      ...(options?.brandId ? { brandId: options.brandId } : {}),
      ...(options?.runId ? { runId: options.runId } : {}),
      url: validation.normalizedUrl,
      domain: validation.domain,
      title: hit.title || validation.domain,
      snippet: hit.snippet,
      sourceType: hit.sourceType,
      contentHash,
      reliabilityScore: hit.reliabilityScore,
      ...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
      retrievedAt: nowIso,
      createdBy,
      createdAt: nowIso,
    });
  }

  return out;
}

function extractNumericTokens(text: string): string[] {
  return (text.match(/\b\d+(?:[.,]\d+)?%?\b/g) || []).slice(0, 8);
}

/**
 * Evaluates a candidate claim against retrieved sources and existing verified brand facts.
 * Detects source contradictions and downgrades unsupported external assertions cleanly.
 */
export function evaluateClaimEvidence(params: {
  workspaceId: string;
  brandId?: string;
  runId?: string;
  claimText: string;
  citedSourceUrls: string[];
  sources: ResearchSourceRecord[];
  brandFacts: BrandKnowledgeFact[];
  createdBy: string;
}): ClaimEvidenceRecord {
  const nowIso = new Date().toISOString();
  const normalizedCited = new Set(params.citedSourceUrls.map(normalizeUrlKey));
  const matchedSources = params.sources.filter((s) =>
    normalizedCited.has(normalizeUrlKey(s.url)),
  );

  const uniqueDomains = new Set(matchedSources.map((s) => s.domain));
  const claimLower = params.claimText.toLowerCase();
  const claimNumbers = extractNumericTokens(params.claimText);

  // Conflict check against verified brand facts (e.g. prohibited claims or numeric mismatches)
  const contradictingFact = params.brandFacts.find((fact) => {
    if (fact.approvalStatus !== 'approved') return false;
    const factNums = extractNumericTokens(fact.statement);
    if (claimNumbers.length > 0 && factNums.length > 0) {
      const sameTopic = fact.title
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w.length >= 4 && claimLower.includes(w));
      const overlapsNum = claimNumbers.some((n) => factNums.includes(n));
      if (sameTopic && !overlapsNum) {
        return true;
      }
    }
    return false;
  });

  // Conflict check across retrieved sources
  let sourceConflictNote: string | undefined;
  if (matchedSources.length >= 2 && claimNumbers.length > 0) {
    const targetNum = claimNumbers[0];
    const disagreeingSource = matchedSources.find((src) => {
      const srcNums = extractNumericTokens(src.snippet);
      return srcNums.length > 0 && !srcNums.includes(targetNum);
    });
    if (disagreeingSource) {
      sourceConflictNote = `Source ${disagreeingSource.domain} reports different numeric figures (${extractNumericTokens(disagreeingSource.snippet).join(', ')}) than "${targetNum}".`;
    }
  }

  let verificationStatus: VerificationStatus = 'UNVERIFIED';
  let confidence = 0.35;
  let rationale = 'No verified external source or brand fact directly supports this claim.';

  if (contradictingFact || sourceConflictNote) {
    verificationStatus = 'CONTRADICTED';
    confidence = 0.2;
    rationale =
      sourceConflictNote ||
      `Conflicts with approved brand knowledge record "${contradictingFact?.title}".`;
  } else if (uniqueDomains.size >= 2) {
    const avgReliability =
      matchedSources.reduce((acc, s) => acc + s.reliabilityScore, 0) /
      matchedSources.length;
    verificationStatus = avgReliability >= 0.7 ? 'VERIFIED' : 'SUPPORTED';
    confidence = Number(Math.min(0.95, avgReliability).toFixed(2));
    rationale = `Supported by ${uniqueDomains.size} distinct domains (${Array.from(uniqueDomains).join(', ')}).`;
  } else if (matchedSources.length === 1) {
    verificationStatus = 'SUPPORTED';
    confidence = Number(Math.min(0.82, matchedSources[0].reliabilityScore).toFixed(2));
    rationale = `Supported by single retrieved source (${matchedSources[0].domain}). Independent secondary corroboration recommended.`;
  } else if (
    params.brandFacts.some(
      (f) =>
        f.approvalStatus === 'approved' &&
        f.verificationStatus === 'VERIFIED' &&
        f.statement
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length >= 5)
          .some((w) => claimLower.includes(w)),
    )
  ) {
    verificationStatus = 'INFERRED';
    confidence = 0.65;
    rationale = 'Synthesized from verified workspace brand profile attributes.';
  }

  return {
    id: `clm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    workspaceId: params.workspaceId,
    ...(params.brandId ? { brandId: params.brandId } : {}),
    ...(params.runId ? { runId: params.runId } : {}),
    claimText: params.claimText.slice(0, 600),
    verificationStatus,
    confidence,
    supportingSourceIds:
      verificationStatus === 'CONTRADICTED' ? [] : matchedSources.map((s) => s.id),
    contradictingSourceIds:
      verificationStatus === 'CONTRADICTED' ? matchedSources.map((s) => s.id) : [],
    ...(contradictingFact
      ? { conflictNote: `Conflicts with verified brand record "${contradictingFact.title}".` }
      : sourceConflictNote
        ? { conflictNote: sourceConflictNote }
        : {}),
    rationale,
    reviewState: 'open',
    createdBy: params.createdBy,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
