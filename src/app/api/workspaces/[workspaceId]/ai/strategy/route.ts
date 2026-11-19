import { NextRequest } from 'next/server';
import { startAndExecuteOrchestratorRun } from '@/lib/agents/orchestrator';
import { authenticateRequest } from '@/lib/server/auth';
import { AppError, jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  getBrandInsideWorkspace,
  listContentDrafts,
  listStrategyPlans,
} from '@/lib/server/phase3-repositories';
import {
  getStore,
  makeId,
  recordAuditLog,
  requireWorkspaceAccess,
} from '@/lib/server/repositories';
import { contentDraftCreateSchema, strategyGenerateSchema } from '@/lib/validation';
import type { ContentDraftRecord, StrategyPlanRecord } from '@/types/domain';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    await requireWorkspaceAccess(user.uid, workspaceId, 'ai:read', {
      idToken: user.idToken,
    });

    const brandId = req.nextUrl.searchParams.get('brandId') || undefined;
    const [plans, drafts] = await Promise.all([
      listStrategyPlans(workspaceId, brandId, { idToken: user.idToken }),
      listContentDrafts(workspaceId, brandId, { idToken: user.idToken }),
    ]);

    return jsonOk({ plans, drafts });
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
    const { store } = await requireWorkspaceAccess(user.uid, workspaceId, 'strategy:write', {
      idToken: user.idToken,
    });

    if (body.mode === 'content_draft') {
      const input = contentDraftCreateSchema.parse(body);
      const brand = await getBrandInsideWorkspace(store, workspaceId, input.brandId);
      if (!brand) {
        throw new AppError(404, 'BRAND_CONTEXT_UNAVAILABLE', 'Selected brand not found.');
      }

      const bundle = await startAndExecuteOrchestratorRun({
        uid: user.uid,
        actorEmail: user.email,
        workspaceId,
        brandId: brand.id,
        prompt: `Write a brand-safe ${input.channel} content draft titled "${input.title}" covering: ${input.topic}. Save as Phase 3 draft only.`,
        preferredAgentIds: ['04_content_engine', '05_creative_studio'],
        complexityHint: 'standard',
        ctx: { idToken: user.idToken, store },
      });

      const primaryArtifact = bundle.artifacts[0];
      const nowIso = new Date().toISOString();
      const draftId = makeId('drf');
      const draft: ContentDraftRecord = {
        id: draftId,
        workspaceId,
        brandId: brand.id,
        ...(input.strategyId ? { strategyId: input.strategyId } : {}),
        runId: bundle.run.id,
        channel: input.channel,
        title: input.title,
        hook: primaryArtifact?.summary,
        bodyMarkdown:
          primaryArtifact?.contentMarkdown ||
          bundle.run.finalMarkdown ||
          bundle.run.finalSummary ||
          'Configuration required to generate AI draft.',
        verificationStatus: primaryArtifact?.verificationStatus || 'INFERRED',
        qaScore: bundle.run.status === 'completed' ? 92 : 60,
        status: bundle.run.status === 'completed' ? 'ready_for_phase4_approval' : 'draft',
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

      return jsonOk({ draft, run: bundle.run }, 201);
    }

    const input = strategyGenerateSchema.parse(body);
    const brand = await getBrandInsideWorkspace(store, workspaceId, input.brandId);
    if (!brand) {
      throw new AppError(404, 'BRAND_CONTEXT_UNAVAILABLE', 'Selected brand not found.');
    }

    const bundle = await startAndExecuteOrchestratorRun({
      uid: user.uid,
      actorEmail: user.email,
      workspaceId,
      brandId: brand.id,
      prompt: `Generate a structured ${input.horizonDays}-day content strategy plan across channels (${input.focusChannels.join(', ')}) for ${brand.name}. Objective: ${input.objective}`,
      preferredAgentIds: ['04_content_engine', '06_publishing_social'],
      complexityHint: 'standard',
      ctx: { idToken: user.idToken, store },
    });

    const nowIso = new Date().toISOString();
    const strategyId = makeId('str');
    const plan: StrategyPlanRecord = {
      id: strategyId,
      workspaceId,
      brandId: brand.id,
      runId: bundle.run.id,
      title: `${brand.name} · ${input.horizonDays}-Day Content Strategy`,
      horizonDays: input.horizonDays,
      objective: input.objective,
      pillars: brand.contentPillars,
      itemsJson: JSON.stringify({
        channels: input.focusChannels,
        summary: bundle.run.finalSummary || '',
        markdown: bundle.run.finalMarkdown || '',
        artifacts: bundle.artifacts.map((a) => ({ title: a.title, summary: a.summary })),
      }),
      status: 'draft',
      createdBy: user.uid,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await store.commit([
      {
        path: `workspaces/${workspaceId}/strategyRecords/${strategyId}`,
        data: plan as unknown as Record<string, unknown>,
      },
    ]);

    await recordAuditLog(
      store,
      workspaceId,
      user.uid,
      user.email,
      'strategy_plan.created',
      'strategyRecords',
      strategyId,
      `Created ${input.horizonDays}-day strategy for ${brand.name} (${bundle.run.status}).`,
    );

    return jsonOk({ plan, run: bundle.run }, 201);
  } catch (err) {
    return jsonError(err);
  }
}
