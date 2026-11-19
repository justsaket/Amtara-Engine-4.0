import type {
  AgentId,
  NormalizedEventRecord,
  PlaybookDefinition,
  PlaybookId,
  PlaybookRunRecord,
} from '@/types/domain';
import type { ModelProviderManager } from '@/lib/ai/provider-manager';
import { startAndExecuteOrchestratorRun } from '@/lib/agents/orchestrator';
import { createAiAppError } from '@/lib/intelligence/error-codes';
import { sanitizeUntrustedText } from '@/lib/intelligence/security';
import {
  makeId,
  recordAuditLog,
  requireWorkspaceAccess,
  type RepositoryContext,
} from '@/lib/server/repositories';

export const PLAYBOOK_DEFINITIONS: Record<PlaybookId, PlaybookDefinition> = {
  '01_search_demand_spikes': {
    id: '01_search_demand_spikes',
    code: 'PB-01',
    title: 'Search Demand Spikes',
    triggerType: 'search_demand_spike',
    description:
      'Triggered when keyword or topic search demand surges. Coordinates Search Visibility, Market Radar, and Content Engine to capture rising intent.',
    agentChain: ['03_search_visibility', '02_market_radar', '04_content_engine'],
    phase3OutputDescription: 'Keyword cluster brief + trend validation + draft article/post package.',
    phaseBoundaryNote: 'Drafts and SEO recommendations only; zero live CMS/social publishing.',
  },
  '02_competitor_drops_promo': {
    id: '02_competitor_drops_promo',
    code: 'PB-02',
    title: 'Competitor Drops a Promo',
    triggerType: 'competitor_promo_detected',
    description:
      'Evaluates a competitor pricing or promotional move, isolates untrusted promo copy, and prepares a measured brand-safe counter-brief.',
    agentChain: ['02_market_radar', '04_content_engine', '05_creative_studio'],
    phase3OutputDescription: 'Competitive counter-positioning memo + draft campaign response assets.',
    phaseBoundaryNote: 'Never invents pricing/discounts; all counter-offers require human approval.',
  },
  '03_one_star_review_lands': {
    id: '03_one_star_review_lands',
    code: 'PB-03',
    title: 'One-Star Review Lands',
    triggerType: 'negative_review_received',
    description:
      'Assesses negative customer review severity, strips prompt-injection risks, and produces calm reply drafts + internal escalation notes.',
    agentChain: ['07_reviews_reputation'],
    phase3OutputDescription: 'Severity classification + 2 policy-safe reply options + escalation checklist.',
    phaseBoundaryNote: 'Draft reply only — never auto-posts publicly to review platforms.',
  },
  '04_content_calendar_thin': {
    id: '04_content_calendar_thin',
    code: 'PB-04',
    title: 'Content Calendar Looks Thin',
    triggerType: 'calendar_gap_detected',
    description:
      'Detects upcoming publishing gaps and refills a 7-to-14 day pillar-balanced content pipeline with creative direction and draft packages.',
    agentChain: ['04_content_engine', '05_creative_studio', '06_publishing_social'],
    phase3OutputDescription: '7/14-day recovery schedule + channel drafts + Phase 4 approval package.',
    phaseBoundaryNote: 'Saves calendar & drafts inside Antara only; zero auto-scheduling.',
  },
  '05_post_goes_viral': {
    id: '05_post_goes_viral',
    code: 'PB-05',
    title: 'A Post Goes Viral',
    triggerType: 'high_engagement_outlier',
    description:
      'Analyzes why a piece of content outperformed baseline and prepares spin-off follow-ups, hook repurposing, and ROI attribution notes.',
    agentChain: ['09_results_roi', '04_content_engine', '06_publishing_social'],
    phase3OutputDescription: 'Outlier breakdown + 3 follow-up draft variations + memory candidate.',
    phaseBoundaryNote: 'Prepares follow-up drafts only; respects brand authenticity.',
  },
  '06_ranking_drops_page': {
    id: '06_ranking_drops_page',
    code: 'PB-06',
    title: 'Ranking Drops a Page',
    triggerType: 'serp_ranking_regression',
    description:
      'Diagnoses SERP rank drops by auditing competitor movements, search intent shifts, and on-page content freshness gaps.',
    agentChain: ['03_search_visibility', '02_market_radar', '04_content_engine'],
    phase3OutputDescription: 'Diagnostic checklist + refreshed page outline + remediation brief.',
    phaseBoundaryNote: 'Diagnostic & rewrite draft only; zero live site edits.',
  },
  '07_ad_creative_fatigues': {
    id: '07_ad_creative_fatigues',
    code: 'PB-07',
    title: 'Ad Creative Fatigues',
    triggerType: 'creative_fatigue_detected',
    description:
      'Responds to declining CTR / rising frequency with root-cause attribution and fresh hook/visual creative variation briefs.',
    agentChain: ['09_results_roi', '05_creative_studio', '04_content_engine'],
    phase3OutputDescription: 'Fatigue analysis + 3 fresh creative angle briefs + draft copy variants.',
    phaseBoundaryNote: 'Never modifies live ad spend, budgets, or ad-set states.',
  },
  '08_dm_lead_arrives_night': {
    id: '08_dm_lead_arrives_night',
    code: 'PB-08',
    title: 'DM Lead Arrives at 11 PM',
    triggerType: 'after_hours_inbound_lead',
    description:
      'Respects workspace timezone (e.g. Asia/Kolkata), evaluates after-hours urgency cleanly, qualifies inquiry intent, and prepares a ready-to-send morning reply.',
    agentChain: ['08_leads_conversations'],
    phase3OutputDescription: 'Timezone-aware SLA classification + qualification score + draft reply.',
    phaseBoundaryNote: 'Prepares draft DM reply and SLA tag only; never auto-sends messages.',
  },
};

export const ALL_PLAYBOOK_IDS: readonly PlaybookId[] = [
  '01_search_demand_spikes',
  '02_competitor_drops_promo',
  '03_one_star_review_lands',
  '04_content_calendar_thin',
  '05_post_goes_viral',
  '06_ranking_drops_page',
  '07_ad_creative_fatigues',
  '08_dm_lead_arrives_night',
] as const;

export function listPlaybooks(): PlaybookDefinition[] {
  return ALL_PLAYBOOK_IDS.map((id) => PLAYBOOK_DEFINITIONS[id]);
}

export function getLocalHourInTimezone(isoTimestamp: string, timezone: string): number {
  try {
    const date = new Date(isoTimestamp);
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'Asia/Kolkata',
      hour: 'numeric',
      hour12: false,
    }).format(date);
    const num = Number.parseInt(formatted, 10);
    return Number.isNaN(num) ? 12 : num % 24;
  } catch {
    return 12;
  }
}

export function isQuietHoursInTimezone(isoTimestamp: string, timezone: string): boolean {
  const hour = getLocalHourInTimezone(isoTimestamp, timezone);
  return hour >= 21 || hour < 8;
}

/**
 * TEST ONLY helper generating realistic sample fixtures for each of the 8 playbooks.
 * Strictly tagged `isTestFixture: true` so real production triggers remain cleanly separated.
 */
export function createTestPlaybookFixture(
  playbookId: PlaybookId,
  timezone = 'Asia/Kolkata',
): {
  source: 'manual_test';
  isTestFixture: true;
  occurredAt: string;
  payload: Record<string, unknown>;
} {
  const baseTime = new Date().toISOString();
  switch (playbookId) {
    case '01_search_demand_spikes':
      return {
        source: 'manual_test',
        isTestFixture: true,
        occurredAt: baseTime,
        payload: {
          topic: 'industrial welding fume extraction standards',
          observedSpikePercent: 48,
          note: 'TEST FIXTURE: Simulated surge in search queries.',
        },
      };
    case '02_competitor_drops_promo':
      return {
        source: 'manual_test',
        isTestFixture: true,
        occurredAt: baseTime,
        payload: {
          competitorName: 'Example Peer Corp',
          observedOfferText: 'TEST FIXTURE: Seasonal maintenance service bundle highlighted on public landing page.',
        },
      };
    case '03_one_star_review_lands':
      return {
        source: 'manual_test',
        isTestFixture: true,
        occurredAt: baseTime,
        payload: {
          rating: 1,
          channel: 'Google Business Profile',
          reviewerAlias: 'Verified Buyer (Test Fixture)',
          reviewText: 'Delivery arrived two days behind schedule and onboarding instructions were unclear.',
        },
      };
    case '04_content_calendar_thin':
      return {
        source: 'manual_test',
        isTestFixture: true,
        occurredAt: baseTime,
        payload: {
          scheduledCountNext14Days: 1,
          minimumTargetCount: 6,
          priorityChannels: ['linkedin', 'blog'],
        },
      };
    case '05_post_goes_viral':
      return {
        source: 'manual_test',
        isTestFixture: true,
        occurredAt: baseTime,
        payload: {
          channel: 'LinkedIn',
          postTopic: 'Why automation systems fail when credentials are scattered across scripts',
          relativeEngagementMultiplier: '4.6x workspace baseline',
        },
      };
    case '06_ranking_drops_page':
      return {
        source: 'manual_test',
        isTestFixture: true,
        occurredAt: baseTime,
        payload: {
          pageTopic: 'Automated Welding Process Guide',
          positionChange: 'Position 4 -> Position 14 (Page 2)',
        },
      };
    case '07_ad_creative_fatigues':
      return {
        source: 'manual_test',
        isTestFixture: true,
        occurredAt: baseTime,
        payload: {
          campaignLabel: 'TEST FIXTURE Q4 Industrial Awareness',
          signal: 'CTR declined across last 10 days while frequency climbed.',
        },
      };
    case '08_dm_lead_arrives_night':
      return {
        source: 'manual_test',
        isTestFixture: true,
        // 23:15 Asia/Kolkata (17:45 UTC)
        occurredAt: '2026-11-18T17:45:00.000Z',
        payload: {
          timezone,
          channel: 'LinkedIn DM',
          senderLabel: 'Operations Director (Test Fixture)',
          messageText: 'Hi team, evaluating plant automation support for Q1. Can someone share technical intake requirements?',
        },
      };
  }
}

export async function triggerPlaybookEvent(params: {
  uid: string;
  actorEmail: string;
  workspaceId: string;
  eventType: PlaybookId;
  brandId?: string;
  source: NormalizedEventRecord['source'];
  isTestFixture: boolean;
  dedupeKey?: string;
  occurredAt?: string;
  payload: Record<string, unknown>;
  modelManager?: ModelProviderManager;
  ctx?: RepositoryContext;
}): Promise<{
  event: NormalizedEventRecord;
  playbookRun: PlaybookRunRecord;
  deduplicated: boolean;
  orchestratorRunId?: string;
}> {
  const { store, workspace } = await requireWorkspaceAccess(
    params.uid,
    params.workspaceId,
    'playbooks:trigger',
    params.ctx,
  );

  const def = PLAYBOOK_DEFINITIONS[params.eventType];
  const tz = workspace.timezone || 'Asia/Kolkata';
  const occurredAt = params.occurredAt || new Date().toISOString();
  const dedupeKey =
    params.dedupeKey ||
    `${params.eventType}_${params.brandId || 'ws'}_${Date.now()}`;

  // Duplicate event protection
  const existingEvents = await store.listWorkspaceSubcollection(
    params.workspaceId,
    'normalizedEvents',
  );
  const dupEvent = existingEvents.find(
    (e) => e.dedupeKey === dedupeKey && e.workspaceId === params.workspaceId,
  ) as NormalizedEventRecord | undefined;

  if (dupEvent) {
    const existingPlaybookRuns = await store.listWorkspaceSubcollection(
      params.workspaceId,
      'playbookRuns',
    );
    const linkedRun = existingPlaybookRuns.find(
      (r) => r.eventId === dupEvent.id,
    ) as PlaybookRunRecord | undefined;
    if (linkedRun) {
      return {
        event: dupEvent,
        playbookRun: linkedRun,
        deduplicated: true,
        orchestratorRunId: linkedRun.orchestratorRunId,
      };
    }
    throw createAiAppError('DUPLICATE_TASK', `Duplicate event dedupeKey "${dedupeKey}".`);
  }

  const nowIso = new Date().toISOString();
  const eventId = makeId('nevt');
  const playbookRunId = makeId('pbr');
  const safePayload = sanitizeUntrustedText(JSON.stringify(params.payload), 4000);

  const eventRecord: NormalizedEventRecord = {
    id: eventId,
    workspaceId: params.workspaceId,
    ...(params.brandId ? { brandId: params.brandId } : {}),
    eventType: params.eventType,
    source: params.source,
    isTestFixture: params.isTestFixture,
    dedupeKey,
    timezone: tz,
    occurredAt,
    payloadJson: safePayload.sanitized,
    status: 'received',
    playbookRunId,
    createdBy: params.uid,
    createdAt: nowIso,
  };

  const quietHours = isQuietHoursInTimezone(occurredAt, tz);
  const localHour = getLocalHourInTimezone(occurredAt, tz);

  const playbookPrompt = [
    `Execute Playbook ${def.code}: ${def.title}.`,
    `Trigger Type: ${def.triggerType}. Workspace Timezone: ${tz}. Local Event Hour: ${localHour}:00 (${quietHours ? 'QUIET HOURS — prepare morning draft & priority queue tag, do not dispatch outbound reply' : 'BUSINESS HOURS'}).`,
    params.isTestFixture
      ? 'NOTE: This event is a flagged TEST FIXTURE for controlled validation.'
      : 'NOTE: Live normalized workspace event.',
    `Expected Phase 3 Output: ${def.phase3OutputDescription}`,
  ].join(' ');

  await store.commit([
    {
      path: `workspaces/${params.workspaceId}/normalizedEvents/${eventId}`,
      data: eventRecord as unknown as Record<string, unknown>,
    },
  ]);

  const execBundle = await startAndExecuteOrchestratorRun({
    uid: params.uid,
    actorEmail: params.actorEmail,
    workspaceId: params.workspaceId,
    prompt: playbookPrompt,
    brandId: params.brandId,
    playbookRunId,
    preferredAgentIds: def.agentChain as AgentId[],
    complexityHint: def.agentChain.length > 1 ? 'standard' : 'simple',
    idempotencyKey: `pb_${dedupeKey}`,
    untrustedExternalBlocks: [
      {
        label: `NormalizedEvent:${params.eventType} (${params.source})`,
        content: safePayload.sanitized,
      },
    ],
    modelManager: params.modelManager,
    ctx: { ...(params.ctx || {}), store },
  });

  const playbookRun: PlaybookRunRecord = {
    id: playbookRunId,
    workspaceId: params.workspaceId,
    ...(params.brandId ? { brandId: params.brandId } : {}),
    playbookId: params.eventType,
    eventId,
    orchestratorRunId: execBundle.run.id,
    status: execBundle.run.status,
    summary: execBundle.run.finalSummary || def.phase3OutputDescription,
    outputArtifactsCount: execBundle.artifacts.length,
    createdBy: params.uid,
    createdAt: nowIso,
    updatedAt: new Date().toISOString(),
  };

  eventRecord.status = 'processed';

  await store.commit([
    {
      path: `workspaces/${params.workspaceId}/normalizedEvents/${eventId}`,
      data: eventRecord as unknown as Record<string, unknown>,
    },
    {
      path: `workspaces/${params.workspaceId}/playbookRuns/${playbookRunId}`,
      data: playbookRun as unknown as Record<string, unknown>,
    },
  ]);

  await recordAuditLog(
    store,
    params.workspaceId,
    params.uid,
    params.actorEmail,
    'playbook.triggered',
    'playbookRuns',
    playbookRunId,
    `Triggered ${def.code} (${def.title}) -> ${playbookRun.status}`,
  );

  return {
    event: eventRecord,
    playbookRun,
    deduplicated: false,
    orchestratorRunId: execBundle.run.id,
  };
}
