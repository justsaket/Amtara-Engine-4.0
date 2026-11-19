import type {
  AnalyticsSnapshotRecord,
  ApprovalRequestRecord,
  BrandAutonomyPolicy,
  BrandGrowthObjective,
  BrandProfile,
  ConnectedSocialAccount,
  LeadRecord,
  MarketingContentItem,
  ReviewRecord,
  ScheduledPostRecord,
  SocialConversationRecord,
  WorkspaceEmergencyStopState,
} from '@/types/domain';

export interface BrandGrowthReadinessSummary {
  brandId: string;
  brandName: string;
  primaryColor: string;
  autonomyMode: BrandAutonomyPolicy['publishingMode'];
  paused: boolean;
  connectedAccountsCount: number;
  connectedPlatforms: string[];
  activeObjectivesCount: number;
  draftContentCount: number;
  readyForReviewCount: number;
  scheduledPostsCount: number;
  publishedPostsCount: number;
  failedOrUnknownPostsCount: number;
  pendingApprovalsCount: number;
  openConversationsCount: number;
  unansweredReviewsCount: number;
  activeLeadsCount: number;
  latestObservedImpressions: number | null;
  latestObservedEngagements: number | null;
  operationalPriorities: Array<{
    priority: 'high' | 'medium' | 'low';
    category: 'connections' | 'approvals' | 'recovery' | 'content' | 'reviews' | 'leads';
    title: string;
    detail: string;
    route: string;
  }>;
}

export interface WorkspaceMarketingOverview {
  emergencyStop: WorkspaceEmergencyStopState;
  totals: {
    brands: number;
    connectedAccounts: number;
    contentItems: number;
    scheduledPosts: number;
    publishedPosts: number;
    pendingApprovals: number;
    failedOrUnknownJobs: number;
    openConversations: number;
    unansweredReviews: number;
    activeLeads: number;
    observedImpressions: number | null;
    observedEngagements: number | null;
  };
  brandSummaries: BrandGrowthReadinessSummary[];
  generatedAt: string;
}

/**
 * Deterministic Brand Growth Controller.
 * Computes all counts and priorities directly from persisted workspace records;
 * never fabricates scores or replaces missing analytics with fake zeros.
 */
export function buildWorkspaceMarketingOverview(params: {
  brands: BrandProfile[];
  objectives: BrandGrowthObjective[];
  contentItems: MarketingContentItem[];
  accounts: ConnectedSocialAccount[];
  scheduledPosts: ScheduledPostRecord[];
  approvals: ApprovalRequestRecord[];
  policies: BrandAutonomyPolicy[];
  emergencyStop: WorkspaceEmergencyStopState;
  conversations: SocialConversationRecord[];
  reviews: ReviewRecord[];
  leads: LeadRecord[];
  snapshots: AnalyticsSnapshotRecord[];
}): WorkspaceMarketingOverview {
  const policyByBrand = new Map(params.policies.map((p) => [p.brandId, p]));

  const brandSummaries: BrandGrowthReadinessSummary[] = params.brands.map((brand) => {
    const policy = policyByBrand.get(brand.id);
    const brandAccounts = params.accounts.filter(
      (a) => a.status === 'connected' && (!a.brandId || a.brandId === brand.id),
    );
    const brandContent = params.contentItems.filter((c) => c.brandId === brand.id);
    const brandScheduled = params.scheduledPosts.filter((s) => s.brandId === brand.id);
    const brandApprovals = params.approvals.filter(
      (a) => a.brandId === brand.id && a.status === 'pending',
    );
    const brandObjectives = params.objectives.filter(
      (o) => o.brandId === brand.id && o.status === 'active',
    );
    const brandConvos = params.conversations.filter(
      (c) => c.brandId === brand.id && (c.status === 'open' || c.status === 'escalated'),
    );
    const brandReviews = params.reviews.filter(
      (r) => r.brandId === brand.id && r.replyStatus !== 'replied',
    );
    const brandLeads = params.leads.filter(
      (l) => l.brandId === brand.id && !['CONVERTED', 'LOST', 'ARCHIVED'].includes(l.stage),
    );
    const brandSnapshots = params.snapshots.filter((s) => s.brandId === brand.id);

    const impValues = brandSnapshots
      .map((s) => s.metrics.impressions)
      .filter((v): v is number => typeof v === 'number');
    const engValues = brandSnapshots
      .map((s) => s.metrics.engagements)
      .filter((v): v is number => typeof v === 'number');

    const failedOrUnknown = brandScheduled.filter(
      (s) => s.status === 'failed' || s.status === 'publish_status_unknown' || s.status === 'dead_letter',
    );

    const priorities: BrandGrowthReadinessSummary['operationalPriorities'] = [];

    if (failedOrUnknown.length > 0) {
      priorities.push({
        priority: 'high',
        category: 'recovery',
        title: `${failedOrUnknown.length} publishing job(s) require recovery or reconciliation`,
        detail: 'Inspect Publishing Recovery before retrying any ambiguous status job.',
        route: '/dashboard/publishing',
      });
    }
    if (brandApprovals.length > 0) {
      priorities.push({
        priority: 'high',
        category: 'approvals',
        title: `${brandApprovals.length} pending approval request(s)`,
        detail: 'Review exact content, media, and destination accounts in Approval Queue.',
        route: '/dashboard/approvals',
      });
    }
    if (brandReviews.some((r) => r.escalationRequired)) {
      priorities.push({
        priority: 'high',
        category: 'reviews',
        title: 'Escalated customer review requires human response',
        detail: 'Low-rating or sensitive feedback detected in Reputation Manager.',
        route: '/dashboard/reviews',
      });
    }
    if (brandAccounts.length === 0) {
      priorities.push({
        priority: 'medium',
        category: 'connections',
        title: 'No connected publishing accounts yet',
        detail: 'Connect Instagram, Facebook, LinkedIn, YouTube, TikTok, or GBP under Publishing Accounts.',
        route: '/dashboard/publishing/accounts',
      });
    }
    if (brandScheduled.filter((s) => s.status === 'scheduled').length === 0) {
      priorities.push({
        priority: 'medium',
        category: 'content',
        title: 'Publishing calendar has no upcoming scheduled posts',
        detail: 'Create or schedule approved drafts to maintain weekly brand cadence.',
        route: '/dashboard/calendar',
      });
    }
    if (brandLeads.length > 0) {
      priorities.push({
        priority: 'low',
        category: 'leads',
        title: `${brandLeads.length} active lead(s) in qualification or follow-up`,
        detail: 'Verify consent status and assign next follow-up steps.',
        route: '/dashboard/leads',
      });
    }

    return {
      brandId: brand.id,
      brandName: brand.name,
      primaryColor: brand.primaryColor,
      autonomyMode: policy?.publishingMode || 'APPROVAL_REQUIRED',
      paused: Boolean(
        params.emergencyStop.globalStopped ||
          params.emergencyStop.pausedBrandIds.includes(brand.id) ||
          policy?.paused,
      ),
      connectedAccountsCount: brandAccounts.length,
      connectedPlatforms: Array.from(new Set(brandAccounts.map((a) => a.provider))),
      activeObjectivesCount: brandObjectives.length,
      draftContentCount: brandContent.filter((c) =>
        ['IDEA', 'RESEARCHED', 'BRIEF_CREATED', 'DRAFTED', 'CREATIVE_IN_PROGRESS', 'ASSET_READY'].includes(
          c.status,
        ),
      ).length,
      readyForReviewCount: brandContent.filter((c) => c.status === 'READY_FOR_REVIEW').length,
      scheduledPostsCount: brandScheduled.filter((s) => s.status === 'scheduled').length,
      publishedPostsCount: brandScheduled.filter((s) => s.status === 'published').length,
      failedOrUnknownPostsCount: failedOrUnknown.length,
      pendingApprovalsCount: brandApprovals.length,
      openConversationsCount: brandConvos.length,
      unansweredReviewsCount: brandReviews.length,
      activeLeadsCount: brandLeads.length,
      latestObservedImpressions:
        impValues.length > 0 ? impValues.reduce((sum, n) => sum + n, 0) : null,
      latestObservedEngagements:
        engValues.length > 0 ? engValues.reduce((sum, n) => sum + n, 0) : null,
      operationalPriorities: priorities,
    };
  });

  const allImpressions = params.snapshots
    .map((s) => s.metrics.impressions)
    .filter((v): v is number => typeof v === 'number');
  const allEngagements = params.snapshots
    .map((s) => s.metrics.engagements)
    .filter((v): v is number => typeof v === 'number');

  return {
    emergencyStop: params.emergencyStop,
    totals: {
      brands: params.brands.length,
      connectedAccounts: params.accounts.filter((a) => a.status === 'connected').length,
      contentItems: params.contentItems.length,
      scheduledPosts: params.scheduledPosts.filter((s) => s.status === 'scheduled').length,
      publishedPosts: params.scheduledPosts.filter((s) => s.status === 'published').length,
      pendingApprovals: params.approvals.filter((a) => a.status === 'pending').length,
      failedOrUnknownJobs: params.scheduledPosts.filter(
        (s) => s.status === 'failed' || s.status === 'publish_status_unknown' || s.status === 'dead_letter',
      ).length,
      openConversations: params.conversations.filter(
        (c) => c.status === 'open' || c.status === 'escalated',
      ).length,
      unansweredReviews: params.reviews.filter((r) => r.replyStatus !== 'replied').length,
      activeLeads: params.leads.filter((l) => !['CONVERTED', 'LOST', 'ARCHIVED'].includes(l.stage)).length,
      observedImpressions:
        allImpressions.length > 0 ? allImpressions.reduce((sum, n) => sum + n, 0) : null,
      observedEngagements:
        allEngagements.length > 0 ? allEngagements.reduce((sum, n) => sum + n, 0) : null,
    },
    brandSummaries,
    generatedAt: new Date().toISOString(),
  };
}
