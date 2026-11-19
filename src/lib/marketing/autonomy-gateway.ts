import crypto from 'node:crypto';
import type {
  ApprovalRequestRecord,
  BrandAutonomyPolicy,
  CampaignBudgetPolicy,
  ConnectedSocialAccount,
  ContentFormat,
  ContentQualityCheckResult,
  ExternalActionType,
  Phase4ErrorCode,
  Phase4ProviderId,
  SocialPlatformId,
  WorkspaceEmergencyStopState,
  WorkspaceMember,
} from '@/types/domain';
import { hasPermission } from '@/lib/rbac';

export interface ActionGatewayRequest {
  workspaceId: string;
  brandId: string;
  actorUid: string;
  actorType: 'human' | 'ai_agent' | 'scheduler_cron';
  member?: WorkspaceMember | null;
  actionType: ExternalActionType;
  platform?: Phase4ProviderId;
  contentFormat?: ContentFormat;
  payloadHash: string;
  idempotencyKey: string;
  account?: ConnectedSocialAccount | null;
  requiredScopes?: string[];
  approval?: ApprovalRequestRecord | null;
  autonomyPolicy?: BrandAutonomyPolicy | null;
  emergencyStop?: WorkspaceEmergencyStopState | null;
  qualityCheck?: ContentQualityCheckResult | null;
  todayAutoPublishCount?: number;
  isSensitiveTopic?: boolean;
  isPositiveReview?: boolean;
  budgetPolicy?: CampaignBudgetPolicy | null;
  requestedDailySpend?: number | null;
  requestedTotalSpend?: number | null;
  alreadyExecutedIdempotencyKeys?: Set<string>;
  nowIso?: string;
}

export interface ActionGatewayDecision {
  decisionId: string;
  allowed: boolean;
  code?: Phase4ErrorCode;
  reason: string;
  executionMode: 'blocked' | 'approved_human' | 'authorized_autonomous' | 'owner_budget_authorized';
  checkedAt: string;
}

function requiredPermissionForAction(actionType: ExternalActionType) {
  switch (actionType) {
    case 'publish_post':
      return 'publishing:execute' as const;
    case 'schedule_post':
      return 'publishing:schedule' as const;
    case 'reply_comment':
    case 'send_dm':
      return 'inbox:reply' as const;
    case 'reply_review':
      return 'reviews:reply' as const;
    case 'lead_outreach':
      return 'leads:manage' as const;
    case 'paid_campaign_mutate':
      return 'campaigns:manage' as const;
    case 'canva_export':
      return 'assets:write' as const;
    case 'apps_script_deploy':
      return 'apps_script:deploy' as const;
  }
}

export function createDefaultAutonomyPolicy(
  workspaceId: string,
  brandId: string,
  actorUid: string,
): BrandAutonomyPolicy {
  const now = new Date().toISOString();
  return {
    id: brandId,
    schemaVersion: '4.0.0',
    workspaceId,
    brandId,
    publishingMode: 'APPROVAL_REQUIRED',
    allowedAutoPlatforms: [],
    allowedAutoFormats: [],
    maxAutoPostsPerDay: 2,
    commentReplyPolicy: 'approval_required',
    dmReplyPolicy: 'approval_required',
    reviewReplyPolicy: 'approval_required',
    leadOutreachPolicy: 'internal_tasks_only',
    paidAdsPolicy: 'disabled',
    requireQualityGatePass: true,
    blockSensitiveTopicsAuto: true,
    paused: false,
    pausedPlatforms: [],
    updatedBy: actorUid,
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultEmergencyStopState(workspaceId: string): WorkspaceEmergencyStopState {
  return {
    id: 'emergency_stop',
    schemaVersion: '4.0.0',
    workspaceId,
    globalStopped: false,
    pausedBrandIds: [],
    pausedPlatforms: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Mandatory Central Action Gateway for ALL Phase 4 external mutations.
 * No AI agent, scheduler job, or API handler may bypass this decision function.
 */
export function evaluateActionGateway(req: ActionGatewayRequest): ActionGatewayDecision {
  const decisionId = `gwd_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  const nowIso = req.nowIso || new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  const deny = (code: Phase4ErrorCode, reason: string): ActionGatewayDecision => ({
    decisionId,
    allowed: false,
    code,
    reason,
    executionMode: 'blocked',
    checkedAt: nowIso,
  });

  // 1. Idempotency / duplicate execution check
  if (req.alreadyExecutedIdempotencyKeys?.has(req.idempotencyKey)) {
    return deny(
      'DUPLICATE_EXECUTION_BLOCKED',
      `Duplicate execution prevented for idempotency key "${req.idempotencyKey}".`,
    );
  }

  // 2. Emergency stop / global, brand, or platform pause checks
  if (req.emergencyStop?.globalStopped) {
    return deny(
      'EMERGENCY_STOP_ACTIVE',
      `Workspace emergency stop is active${req.emergencyStop.reason ? `: ${req.emergencyStop.reason}` : '.'}`,
    );
  }
  if (req.emergencyStop?.pausedBrandIds.includes(req.brandId)) {
    return deny('EMERGENCY_STOP_ACTIVE', 'Publishing and external actions are paused for this brand.');
  }
  if (
    req.platform &&
    req.platform !== 'canva' &&
    req.platform !== 'meta_ads' &&
    req.emergencyStop?.pausedPlatforms.includes(req.platform)
  ) {
    return deny('EMERGENCY_STOP_ACTIVE', `External actions are paused for platform "${req.platform}".`);
  }

  // 3. Membership & RBAC verification (for human actors)
  if (req.actorType === 'human') {
    if (!req.member || req.member.status !== 'active' || req.member.workspaceId !== req.workspaceId) {
      return deny('PERMISSION_MISSING', 'Active workspace membership is required for external execution.');
    }
    const perm = requiredPermissionForAction(req.actionType);
    if (!hasPermission(req.member.role, perm)) {
      return deny(
        'PERMISSION_MISSING',
        `Role "${req.member.role}" lacks required permission "${perm}" for "${req.actionType}".`,
      );
    }
  }

  // 4. Connected external account & scope checks (when targeting an external provider)
  if (req.platform && req.actionType !== 'apps_script_deploy') {
    if (!req.account) {
      return deny(
        'ACCOUNT_NOT_CONNECTED',
        `No connected ${req.platform} account supplied for brand "${req.brandId}".`,
      );
    }
    if (req.account.workspaceId !== req.workspaceId) {
      return deny('PERMISSION_MISSING', 'Connected account belongs to a different workspace.');
    }
    if (req.account.brandId && req.account.brandId !== req.brandId) {
      return deny('PERMISSION_MISSING', 'Connected account is bound to a different brand.');
    }
    if (req.account.provider !== req.platform) {
      return deny(
        'PERMISSION_MISSING',
        `Connected account provider "${req.account.provider}" does not match target platform "${req.platform}".`,
      );
    }
    if (req.account.status === 'app_review_required') {
      return deny(
        'APP_REVIEW_REQUIRED',
        `${req.platform} account cannot perform this action until provider app review / API access is approved.`,
      );
    }
    if (req.account.status !== 'connected') {
      return deny(
        req.account.status === 'reauth_required' ? 'TOKEN_EXPIRED' : 'ACCOUNT_NOT_CONNECTED',
        `${req.platform} account "${req.account.displayName}" is currently "${req.account.status}".`,
      );
    }
    if (req.account.tokenExpiresAt && Date.parse(req.account.tokenExpiresAt) <= nowMs) {
      return deny(
        'TOKEN_EXPIRED',
        `Access token for ${req.platform} account "${req.account.displayName}" has expired.`,
      );
    }
    if (req.requiredScopes && req.requiredScopes.length > 0) {
      const granted = new Set(req.account.grantedScopes);
      const missing = req.requiredScopes.filter((s) => !granted.has(s));
      if (missing.length > 0) {
        return deny(
          'PERMISSION_MISSING',
          `Connected ${req.platform} account is missing required scope(s): ${missing.join(', ')}.`,
        );
      }
    }
  }

  // 5. Paid advertising strict financial gate (cannot be bypassed by autonomy mode)
  if (req.actionType === 'paid_campaign_mutate') {
    if (!req.budgetPolicy || !req.budgetPolicy.enabled) {
      return deny(
        'PAID_SPEND_NOT_AUTHORIZED',
        'Paid advertising spend is disabled for this brand until explicit numeric budget limits are enabled by the owner.',
      );
    }
    if (
      req.budgetPolicy.maxDailySpend === null ||
      req.budgetPolicy.maxMonthlySpend === null ||
      req.budgetPolicy.maxDailySpend <= 0 ||
      req.budgetPolicy.maxMonthlySpend <= 0
    ) {
      return deny(
        'PAID_SPEND_NOT_AUTHORIZED',
        'Both numeric daily and monthly spend caps must be configured before paid campaign execution.',
      );
    }
    if (!req.budgetPolicy.ownerAuthorizedByUid) {
      return deny(
        'PAID_SPEND_NOT_AUTHORIZED',
        'Explicit workspace owner authorization is required on the budget policy before paid spend.',
      );
    }
    if (req.requestedDailySpend && req.requestedDailySpend > req.budgetPolicy.maxDailySpend) {
      return deny(
        'PAID_SPEND_NOT_AUTHORIZED',
        `Requested daily budget (${req.requestedDailySpend}) exceeds configured cap (${req.budgetPolicy.maxDailySpend}).`,
      );
    }
    if (req.requestedTotalSpend && req.requestedTotalSpend > req.budgetPolicy.maxMonthlySpend) {
      return deny(
        'PAID_SPEND_NOT_AUTHORIZED',
        `Requested total budget (${req.requestedTotalSpend}) exceeds configured monthly cap (${req.budgetPolicy.maxMonthlySpend}).`,
      );
    }
    // Paid spend ALWAYS requires an explicit approved request matching payloadHash
    const paidApprovalCheck = verifyApprovalRecord(req.approval, req, nowMs);
    if (!paidApprovalCheck.valid) {
      return deny(paidApprovalCheck.code, paidApprovalCheck.reason);
    }
    return {
      decisionId,
      allowed: true,
      reason: 'Paid campaign mutation passed budget cap verification and explicit human approval.',
      executionMode: 'owner_budget_authorized',
      checkedAt: nowIso,
    };
  }

  // 6. Brand autonomy policy pause check
  const policy = req.autonomyPolicy;
  if (policy?.paused) {
    return deny('AUTONOMY_POLICY_BLOCKED', 'Brand autonomy policy is currently paused.');
  }
  if (
    policy &&
    req.platform &&
    req.platform !== 'canva' &&
    req.platform !== 'meta_ads' &&
    policy.pausedPlatforms.includes(req.platform)
  ) {
    return deny(
      'AUTONOMY_POLICY_BLOCKED',
      `Brand autonomy policy has paused external execution on ${req.platform}.`,
    );
  }
  if (
    policy &&
    policy.publishingMode === 'DRAFT_ONLY' &&
    (req.actionType === 'publish_post' || req.actionType === 'schedule_post')
  ) {
    return deny(
      'AUTONOMY_POLICY_BLOCKED',
      'Brand is in Mode A (DRAFT_ONLY). Autonomous or direct publishing is blocked.',
    );
  }

  // 7. Quality gate requirement for publishing actions
  if (
    (req.actionType === 'publish_post' || req.actionType === 'schedule_post') &&
    (policy?.requireQualityGatePass ?? true) &&
    req.qualityCheck &&
    !req.qualityCheck.passed
  ) {
    return deny(
      'AUTONOMY_POLICY_BLOCKED',
      'Content failed mandatory quality validation gate (brand facts, prohibited claims, or media checks).',
    );
  }

  // 8. Canva export is an internal asset preparation call (no external publication)
  if (req.actionType === 'canva_export') {
    return {
      decisionId,
      allowed: true,
      reason: 'Canva export authorized for connected workspace account.',
      executionMode: 'approved_human',
      checkedAt: nowIso,
    };
  }

  // 9. Check if an explicit valid human approval exists and matches payloadHash
  if (req.approval) {
    const check = verifyApprovalRecord(req.approval, req, nowMs);
    if (check.valid) {
      return {
        decisionId,
        allowed: true,
        reason: `Explicit human approval "${req.approval.id}" verified with matching payload hash.`,
        executionMode: 'approved_human',
        checkedAt: nowIso,
      };
    }
    // If an approval was supplied but invalidated (e.g. edited caption/media/destination) or expired, NEVER silently fall back to auto!
    if (check.code === 'APPROVAL_INVALIDATED' || check.code === 'PERMISSION_MISSING') {
      return deny(check.code, check.reason);
    }
  }

  // 10. Evaluate Autonomous Policy (Mode A / Mode B / Mode C)
  if (!policy) {
    return deny(
      'APPROVAL_REQUIRED',
      'No autonomy policy configured; defaulting to APPROVAL_REQUIRED. Obtain explicit human approval before execution.',
    );
  }

  // Check policy expiry
  if (policy.policyExpiresAt && Date.parse(policy.policyExpiresAt) <= nowMs) {
    return deny(
      'AUTONOMY_POLICY_BLOCKED',
      'Brand autonomy policy has expired. Re-authorize policy or submit for explicit human approval.',
    );
  }

  // Sensitive topics NEVER auto-execute
  if (req.isSensitiveTopic && policy.blockSensitiveTopicsAuto) {
    return deny(
      'APPROVAL_REQUIRED',
      'Sensitive topic detected (complaint, refund, legal, or escalation). Human approval is mandatory.',
    );
  }

  // Separate policies per external action category
  if (req.actionType === 'publish_post' || req.actionType === 'schedule_post') {
    if (policy.publishingMode === 'DRAFT_ONLY') {
      return deny(
        'AUTONOMY_POLICY_BLOCKED',
        'Brand is in Mode A (DRAFT_ONLY). Autonomous or direct publishing is blocked.',
      );
    }
    if (policy.publishingMode === 'APPROVAL_REQUIRED') {
      return deny(
        'APPROVAL_REQUIRED',
        'Brand is in Mode B (APPROVAL_REQUIRED). Explicit human approval matching current payload hash is required.',
      );
    }
    // Mode C: AUTHORIZED_AUTO_PUBLISHING — enforce strict scope boundaries
    const platform = req.platform as SocialPlatformId | undefined;
    if (!platform || !policy.allowedAutoPlatforms.includes(platform)) {
      return deny(
        'AUTONOMY_POLICY_BLOCKED',
        `Platform "${platform || 'unknown'}" is outside the authorized Mode C auto-publishing scope.`,
      );
    }
    if (req.contentFormat && !policy.allowedAutoFormats.includes(req.contentFormat)) {
      return deny(
        'AUTONOMY_POLICY_BLOCKED',
        `Content format "${req.contentFormat}" is outside the authorized Mode C auto-publishing scope.`,
      );
    }
    const usedToday = req.todayAutoPublishCount ?? 0;
    if (usedToday >= policy.maxAutoPostsPerDay) {
      return deny(
        'AUTONOMY_POLICY_BLOCKED',
        `Daily Mode C auto-publishing limit reached (${usedToday}/${policy.maxAutoPostsPerDay}).`,
      );
    }
    return {
      decisionId,
      allowed: true,
      reason: `Authorized under Brand Mode C policy (${platform}, ${usedToday + 1}/${policy.maxAutoPostsPerDay} today).`,
      executionMode: 'authorized_autonomous',
      checkedAt: nowIso,
    };
  }

  if (req.actionType === 'reply_comment') {
    if (policy.commentReplyPolicy === 'auto_non_sensitive' && !req.isSensitiveTopic) {
      return {
        decisionId,
        allowed: true,
        reason: 'Authorized under non-sensitive comment auto-reply policy.',
        executionMode: 'authorized_autonomous',
        checkedAt: nowIso,
      };
    }
    return deny(
      'APPROVAL_REQUIRED',
      `Comment replies require explicit approval under current policy (${policy.commentReplyPolicy}).`,
    );
  }

  if (req.actionType === 'send_dm') {
    return deny(
      'APPROVAL_REQUIRED',
      'Direct messages always require explicit human approval before transmission.',
    );
  }

  if (req.actionType === 'reply_review') {
    if (policy.reviewReplyPolicy === 'auto_positive_only' && req.isPositiveReview && !req.isSensitiveTopic) {
      return {
        decisionId,
        allowed: true,
        reason: 'Authorized under positive-only review reply policy.',
        executionMode: 'authorized_autonomous',
        checkedAt: nowIso,
      };
    }
    return deny(
      'APPROVAL_REQUIRED',
      'Review replies require human approval by default (especially for critical or negative feedback).',
    );
  }

  if (req.actionType === 'lead_outreach') {
    return deny(
      'APPROVAL_REQUIRED',
      'External lead outreach requires explicit human approval and verified lead consent.',
    );
  }

  return deny('APPROVAL_REQUIRED', 'External action requires explicit human approval.');
}

function verifyApprovalRecord(
  approval: ApprovalRequestRecord | null | undefined,
  req: ActionGatewayRequest,
  nowMs: number,
): { valid: true } | { valid: false; code: Phase4ErrorCode; reason: string } {
  if (!approval) {
    return {
      valid: false,
      code: 'APPROVAL_REQUIRED',
      reason: 'Explicit human approval record is required before execution.',
    };
  }
  if (approval.workspaceId !== req.workspaceId || approval.brandId !== req.brandId) {
    return {
      valid: false,
      code: 'PERMISSION_MISSING',
      reason: 'Approval record belongs to a different workspace or brand.',
    };
  }
  if (req.platform && approval.platform && approval.platform !== req.platform) {
    return {
      valid: false,
      code: 'APPROVAL_INVALIDATED',
      reason: `Approval was issued for "${approval.platform}", not "${req.platform}". Re-approval required.`,
    };
  }
  if (req.account && approval.accountId && approval.accountId !== req.account.id) {
    return {
      valid: false,
      code: 'APPROVAL_INVALIDATED',
      reason: 'Destination account changed after approval. Re-approval required.',
    };
  }
  if (approval.status !== 'approved') {
    return {
      valid: false,
      code: approval.status === 'invalidated' ? 'APPROVAL_INVALIDATED' : 'APPROVAL_REQUIRED',
      reason: `Approval record "${approval.id}" is in status "${approval.status}", not "approved".`,
    };
  }
  if (
    !approval.decidedByUid ||
    approval.decidedByUid.startsWith('agent_') ||
    approval.decidedByUid.startsWith('ai_agent') ||
    (req.actorType === 'ai_agent' && approval.decidedByUid === req.actorUid)
  ) {
    return {
      valid: false,
      code: 'APPROVAL_REQUIRED',
      reason: 'AI agents cannot self-approve external actions. Human approver UID is required.',
    };
  }
  if (Date.parse(approval.expiresAt) <= nowMs) {
    return {
      valid: false,
      code: 'APPROVAL_INVALIDATED',
      reason: `Approval record "${approval.id}" expired at ${approval.expiresAt}.`,
    };
  }
  if (approval.payloadHash !== req.payloadHash) {
    return {
      valid: false,
      code: 'APPROVAL_INVALIDATED',
      reason:
        'Content caption, media, destination, or budget changed after approval (payload hash mismatch). Re-approval required.',
    };
  }
  return { valid: true };
}
