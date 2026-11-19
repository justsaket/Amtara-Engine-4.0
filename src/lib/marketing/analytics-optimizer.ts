import crypto from 'node:crypto';
import type {
  AnalyticsSnapshotRecord,
  MemoryItem,
  PerformanceExperimentRecord,
} from '@/types/domain';

export function buildAnalyticsSnapshotDedupeKey(params: {
  workspaceId: string;
  brandId: string;
  platform: string;
  externalObjectId?: string;
  contentItemId?: string;
  periodStart: string;
  periodEnd: string;
}): string {
  const basis = [
    params.workspaceId,
    params.brandId,
    params.platform,
    params.externalObjectId || params.contentItemId || 'account_level',
    params.periodStart,
    params.periodEnd,
  ].join('|');
  return `anl_${crypto.createHash('sha256').update(basis).digest('hex').slice(0, 24)}`;
}

export function validateAnalyticsSnapshotInput(params: {
  periodStart: string;
  periodEnd: string;
  existingSnapshots: AnalyticsSnapshotRecord[];
  dedupeKey: string;
  currency?: 'INR' | 'USD';
  spendAmount: number | null;
  revenueAmount: number | null;
}): {
  valid: boolean;
  isDuplicate: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const startMs = Date.parse(params.periodStart);
  const endMs = Date.parse(params.periodEnd);

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    errors.push('Snapshot periodStart and periodEnd must be valid ISO-8601 timestamps.');
  } else if (endMs <= startMs) {
    errors.push('Conflicting period: periodEnd must be strictly later than periodStart.');
  }

  if ((params.spendAmount !== null || params.revenueAmount !== null) && !params.currency) {
    errors.push('Unit mismatch: currency (INR or USD) is required whenever spendAmount or revenueAmount is provided.');
  }

  const isDuplicate = params.existingSnapshots.some((s) => s.dedupeKey === params.dedupeKey);

  return {
    valid: errors.length === 0,
    isDuplicate,
    errors,
  };
}

export interface AggregatedAnalyticsSummary {
  snapshotCount: number;
  impressions: number | null;
  reach: number | null;
  engagements: number | null;
  clicks: number | null;
  videoViews: number | null;
  leadsAttributed: number | null;
  spendByCurrency: Record<string, number>;
  revenueByCurrency: Record<string, number>;
  engagementRatePct: number | null;
  ctrPct: number | null;
  roasByCurrency: Record<string, number | null>;
  missingMetricNotes: string[];
}

/**
 * Aggregates analytics strictly preserving null for unavailable metrics (never zero-fills missing data)
 * and separating financial totals by currency so INR and USD are never silently mixed.
 */
export function aggregateAnalyticsSnapshots(
  snapshots: AnalyticsSnapshotRecord[],
): AggregatedAnalyticsSummary {
  const sumNullable = (values: Array<number | null | undefined>): number | null => {
    const present = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (present.length === 0) return null;
    return present.reduce((acc, n) => acc + n, 0);
  };

  const impressions = sumNullable(snapshots.map((s) => s.metrics.impressions));
  const reach = sumNullable(snapshots.map((s) => s.metrics.reach));
  const engagements = sumNullable(snapshots.map((s) => s.metrics.engagements));
  const clicks = sumNullable(snapshots.map((s) => s.metrics.clicks));
  const videoViews = sumNullable(snapshots.map((s) => s.metrics.videoViews));
  const leadsAttributed = sumNullable(snapshots.map((s) => s.metrics.leadsAttributed));

  const spendByCurrency: Record<string, number> = {};
  const revenueByCurrency: Record<string, number> = {};

  for (const snap of snapshots) {
    const cur = snap.units.currency;
    if (cur && typeof snap.metrics.spendAmount === 'number') {
      spendByCurrency[cur] = (spendByCurrency[cur] || 0) + snap.metrics.spendAmount;
    }
    if (cur && typeof snap.metrics.revenueAmount === 'number') {
      revenueByCurrency[cur] = (revenueByCurrency[cur] || 0) + snap.metrics.revenueAmount;
    }
  }

  const roasByCurrency: Record<string, number | null> = {};
  for (const cur of new Set([...Object.keys(spendByCurrency), ...Object.keys(revenueByCurrency)])) {
    const spend = spendByCurrency[cur];
    const rev = revenueByCurrency[cur];
    if (typeof spend === 'number' && spend > 0 && typeof rev === 'number') {
      roasByCurrency[cur] = Number((rev / spend).toFixed(2));
    } else {
      roasByCurrency[cur] = null;
    }
  }

  const engagementRatePct =
    impressions !== null && impressions > 0 && engagements !== null
      ? Number(((engagements / impressions) * 100).toFixed(2))
      : null;

  const ctrPct =
    impressions !== null && impressions > 0 && clicks !== null
      ? Number(((clicks / impressions) * 100).toFixed(2))
      : null;

  const missingMetricNotes: string[] = [];
  if (snapshots.length === 0) {
    missingMetricNotes.push('No real analytics snapshots collected yet. Metrics remain null until provider data is synced.');
  } else {
    if (impressions === null) missingMetricNotes.push('Impressions unavailable in current snapshots.');
    if (Object.keys(revenueByCurrency).length === 0) {
      missingMetricNotes.push('No attributed revenue data present; ROAS is intentionally omitted rather than estimated.');
    }
  }

  return {
    snapshotCount: snapshots.length,
    impressions,
    reach,
    engagements,
    clicks,
    videoViews,
    leadsAttributed,
    spendByCurrency,
    revenueByCurrency,
    engagementRatePct,
    ctrPct,
    roasByCurrency,
    missingMetricNotes,
  };
}

/**
 * Evaluates a performance experiment and builds a Phase 3 CANDIDATE memory item
 * (never auto-promotes unverified learnings to approved memory).
 */
export function evaluateExperimentAndBuildCandidateMemory(
  experiment: PerformanceExperimentRecord,
  snapshots: AnalyticsSnapshotRecord[],
  actorUid: string,
): {
  status: PerformanceExperimentRecord['status'];
  observedControlValue: number | null;
  observedVariantValue: number | null;
  confidenceNote: string;
  candidateMemory: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'> | null;
} {
  const controlSnaps = experiment.controlContentId
    ? snapshots.filter((s) => s.contentItemId === experiment.controlContentId)
    : [];
  const variantSnaps = experiment.variantContentId
    ? snapshots.filter((s) => s.contentItemId === experiment.variantContentId)
    : [];

  const extractMetric = (list: AnalyticsSnapshotRecord[]) => {
    const vals = list
      .map((s) => s.metrics[experiment.primaryMetric])
      .filter((v): v is number => typeof v === 'number');
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null;
  };

  const controlVal = extractMetric(controlSnaps);
  const variantVal = extractMetric(variantSnaps);

  if (controlVal === null || variantVal === null) {
    return {
      status: 'running',
      observedControlValue: controlVal,
      observedVariantValue: variantVal,
      confidenceNote: 'Awaiting real provider analytics snapshots for both control and variant content items.',
      candidateMemory: null,
    };
  }

  const totalObserved = controlVal + variantVal;
  if (totalObserved < experiment.minSampleSize) {
    return {
      status: 'inconclusive',
      observedControlValue: controlVal,
      observedVariantValue: variantVal,
      confidenceNote: `Observed sample (${totalObserved}) is below minimum threshold (${experiment.minSampleSize}); result remains inconclusive.`,
      candidateMemory: null,
    };
  }

  const deltaPct =
    controlVal > 0 ? Number((((variantVal - controlVal) / controlVal) * 100).toFixed(1)) : null;
  const winner = variantVal > controlVal ? 'Variant' : variantVal < controlVal ? 'Control' : 'Tie';

  const confidenceNote =
    winner === 'Tie'
      ? `Observed ${experiment.primaryMetric} tied (${controlVal} vs ${variantVal}).`
      : `${winner} outperformed on ${experiment.primaryMetric} (${variantVal} vs ${controlVal}${deltaPct !== null ? `, ${deltaPct > 0 ? '+' : ''}${deltaPct}%` : ''}) with sample ${totalObserved} >= ${experiment.minSampleSize}.`;

  // Always write as status: 'candidate' so human or Phase 3 governance must review before promotion
  const candidateMemory: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'> = {
    workspaceId: experiment.workspaceId,
    brandId: experiment.brandId,
    namespace: 'performance_memory',
    title: `Experiment Learning: ${experiment.title}`,
    content: `Platform: ${experiment.platform}. Hypothesis: ${experiment.hypothesis}. Result: ${confidenceNote}`,
    tags: ['phase4_experiment', experiment.platform, experiment.primaryMetric],
    status: 'candidate',
    verificationStatus: 'SUPPORTED',
    confidence: 0.72,
    provenanceRef: `experiment:${experiment.id}`,
    tokensEstimate: Math.ceil((experiment.title.length + experiment.hypothesis.length + confidenceNote.length) / 4),
    createdBy: actorUid,
  };

  return {
    status: 'completed',
    observedControlValue: controlVal,
    observedVariantValue: variantVal,
    confidenceNote,
    candidateMemory,
  };
}
