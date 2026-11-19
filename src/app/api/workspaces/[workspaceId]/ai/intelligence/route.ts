import { NextRequest } from 'next/server';
import { z } from 'zod';
import { startAndExecuteOrchestratorRun } from '@/lib/agents/orchestrator';
import { authenticateRequest } from '@/lib/server/auth';
import { AppError, jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  createMemoryItem,
  listResearchClaims,
  listResearchSources,
} from '@/lib/server/phase3-repositories';
import {
  getStore,
  makeId,
  recordAuditLog,
  requireWorkspaceAccess,
} from '@/lib/server/repositories';
import { claimActionSchema, researchRunRequestSchema } from '@/lib/validation';
import type { AgentArtifactPayload, ClaimEvidenceRecord, ContentDraftRecord } from '@/types/domain';

const claimActionPayloadSchema = claimActionSchema.extend({
  claimId: z.string().min(2).max(128),
});

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    await requireWorkspaceAccess(user.uid, workspaceId, 'research:read', {
      idToken: user.idToken,
    });

    const store = getStore({ idToken: user.idToken });
    const [sources, claims, artifactsRaw] = await Promise.all([
      listResearchSources(workspaceId, { idToken: user.idToken, store }),
      listResearchClaims(workspaceId, { idToken: user.idToken, store }),
      store.listWorkspaceSubcollection(workspaceId, 'agentArtifacts'),
    ]);

    const researchArtifacts = (artifactsRaw as unknown as AgentArtifactPayload[])
      .filter(
        (a) =>
          a.workspaceId === workspaceId &&
          (a.agentId === '02_market_radar' || a.agentId === '03_search_visibility'),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return jsonOk({
      sources: sources.slice(0, 60),
      claims: claims.slice(0, 60),
      artifacts: researchArtifacts.slice(0, 25),
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;

    if (typeof body.claimId === 'string') {
      const parsed = claimActionPayloadSchema.parse(body);
      const { store } = await requireWorkspaceAccess(user.uid, workspaceId, 'memory:approve', {
        idToken: user.idToken,
      });

      const rawClaim = await store.getDoc(`workspaces/${workspaceId}/researchClaims/${parsed.claimId}`);
      if (!rawClaim || rawClaim.workspaceId !== workspaceId) {
        throw new AppError(404, 'CLAIM_NOT_FOUND', 'Research claim record not found.');
      }
      const claim = rawClaim as unknown as ClaimEvidenceRecord;
      const nowIso = new Date().toISOString();

      if (parsed.action === 'promote_to_memory') {
        const mem = await createMemoryItem(store, workspaceId, user.uid, {
          brandId: parsed.brandId || claim.brandId,
          namespace: 'research_memory',
          title: claim.claimText.slice(0, 110),
          content: `${claim.claimText}\n\nVerification Rationale: ${claim.rationale}`,
          tags: ['promoted_research', claim.verificationStatus.toLowerCase()],
          status: 'approved',
          verificationStatus: claim.verificationStatus,
          confidence: claim.confidence,
          provenanceRef: `claim:${claim.id}`,
          sourceRunId: claim.runId,
        });
        await store.commit([
          {
            path: `workspaces/${workspaceId}/researchClaims/${claim.id}`,
            data: { ...claim, reviewState: 'promoted_to_memory', updatedAt: nowIso },
          },
        ]);
        await recordAuditLog(
          store,
          workspaceId,
          user.uid,
          user.email,
          'claim.promoted_to_memory',
          'researchClaims',
          claim.id,
          `Promoted claim to approved research memory (${mem.id}).`,
        );
        return jsonOk({ memory: mem, claimId: claim.id });
      }

      if (parsed.action === 'reject') {
        await store.commit([
          {
            path: `workspaces/${workspaceId}/researchClaims/${claim.id}`,
            data: { ...claim, reviewState: 'rejected', updatedAt: nowIso },
          },
        ]);
        const rej = await createMemoryItem(store, workspaceId, user.uid, {
          brandId: parsed.brandId || claim.brandId,
          namespace: 'rejection_memory',
          title: `Rejected Research Claim`,
          content: `${parsed.note || 'Rejected during intelligence review'}: ${claim.claimText}`,
          tags: ['rejected_claim'],
          status: 'approved',
          verificationStatus: 'VERIFIED',
          confidence: 1,
          provenanceRef: `rejected_claim:${claim.id}`,
        });
        return jsonOk({ rejected: true, guardrailMemoryId: rej.id });
      }

      // create_brief -> creates an editable Phase 3 content draft brief anchored to the insight
      const draftId = makeId('drf');
      const draft: ContentDraftRecord = {
        id: draftId,
        workspaceId,
        brandId: parsed.brandId || claim.brandId || 'workspace',
        runId: claim.runId,
        channel: 'linkedin',
        title: `Research Brief: ${claim.claimText.slice(0, 90)}`,
        hook: claim.claimText,
        bodyMarkdown: `## Research-Backed Content Brief\n\n**Verified Insight (${claim.verificationStatus}):**\n${claim.claimText}\n\n**Evidence Rationale:**\n${claim.rationale}\n\n**Editorial Next Step:**\nDevelop draft copy aligned with Brand Profile restrictions before Phase 4 approval.`,
        verificationStatus: claim.verificationStatus,
        qaScore: 90,
        status: 'draft',
        createdBy: user.uid,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await store.commit([
        {
          path: `workspaces/${workspaceId}/contentDrafts/${draftId}`,
          data: draft as unknown as Record<string, unknown>,
        },
      ]);
      return jsonOk({ draft }, 201);
    }

    const input = researchRunRequestSchema.parse(body);
    await requireWorkspaceAccess(user.uid, workspaceId, 'research:run', {
      idToken: user.idToken,
    });

    const agents = input.includeSeoAudit
      ? (['02_market_radar', '03_search_visibility'] as const)
      : (['02_market_radar'] as const);

    const bundle = await startAndExecuteOrchestratorRun({
      uid: user.uid,
      actorEmail: user.email,
      workspaceId,
      prompt: input.query,
      brandId: input.brandId,
      preferredAgentIds: [...agents],
      complexityHint: 'standard',
      urlsToInspect: input.urlsToInspect,
      ctx: { idToken: user.idToken },
    });

    return jsonOk(bundle, 201);
  } catch (err) {
    return jsonError(err);
  }
}
