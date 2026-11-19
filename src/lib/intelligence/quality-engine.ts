import type {
  AgentResultContract,
  BrandProfile,
  ClaimEvidenceRecord,
} from '@/types/domain';

export interface QualityCheckIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface QualityAuditReport {
  verdict: 'pass' | 'revised_pass' | 'flagged_uncertainty';
  score: number;
  issues: QualityCheckIssue[];
  sanitizedResult: AgentResultContract;
}

const PHASE_4_LIVE_CLAIM_RX = /\b(i have published|successfully posted live|dm has been sent|email was dispatched|budget was increased|executed live ad)\b/i;
const UNVERIFIED_CERT_RX = /\b(iso\s*\d{4,5}|ce\s*certified|ul\s*listed|fda\s*approved|100%\s*guaranteed|zero\s*emission\s*certified)\b/i;

export function runDeterministicQualityAudit(params: {
  result: AgentResultContract;
  brand: BrandProfile | null;
  evaluatedClaims: ClaimEvidenceRecord[];
}): QualityAuditReport {
  const issues: QualityCheckIssue[] = [];
  const nextResult: AgentResultContract = structuredClone(params.result);

  const combinedText = [
    nextResult.summary,
    ...nextResult.artifacts.map((a) => `${a.title}\n${a.contentMarkdown}`),
  ].join('\n');

  // 1. Check strict Phase 3 boundary (never falsely claim Phase 4 execution occurred)
  if (PHASE_4_LIVE_CLAIM_RX.test(combinedText)) {
    issues.push({
      severity: 'error',
      code: 'PHASE_BOUNDARY_VIOLATION',
      message: 'Output implied live external publishing or messaging already executed. Phase 3 produces drafts/packages only.',
    });
    nextResult.uncertaintyNotes.push(
      'QA Notice: All outputs are Phase 3 drafts/recommendations requiring explicit approval before Phase 4 execution.',
    );
  }

  // 2. Check Brand Restrictions (e.g. unverified certifications / pricing claims)
  const restrictionText = (params.brand?.restrictions || '').toLowerCase();
  const restrictsCerts =
    restrictionText.includes('certification') ||
    restrictionText.includes('unverified') ||
    restrictionText.includes('environmental');

  if (restrictsCerts && UNVERIFIED_CERT_RX.test(combinedText)) {
    const hasVerifiedCertClaim = params.evaluatedClaims.some(
      (c) => c.verificationStatus === 'VERIFIED' && UNVERIFIED_CERT_RX.test(c.claimText),
    );
    if (!hasVerifiedCertClaim) {
      issues.push({
        severity: 'error',
        code: 'RESTRICTED_BRAND_CLAIM',
        message:
          'Detected certification or absolute performance phrasing prohibited by brand restrictions without verified evidence.',
      });
      nextResult.uncertaintyNotes.push(
        'QA Restriction Flag: Certification/compliance phrasing requires verified brand documentation before approval.',
      );
    }
  }

  // 3. Downgrade contradicted/unverified claims explicitly on output
  const contradicted = params.evaluatedClaims.filter(
    (c) => c.verificationStatus === 'CONTRADICTED',
  );
  if (contradicted.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'CONTRADICTED_CLAIM_PRESENT',
      message: `${contradicted.length} claim(s) conflicted with brand facts or retrieved sources.`,
    });
    for (const c of contradicted) {
      nextResult.uncertaintyNotes.push(`Conflict detected: ${c.claimText} — ${c.conflictNote || c.rationale}`);
    }
  }

  // 4. Synchronize claim verification statuses from the Claim Evidence Engine
  if (params.evaluatedClaims.length > 0 && nextResult.claims.length > 0) {
    nextResult.claims = nextResult.claims.map((claim, idx) => {
      const evaluated = params.evaluatedClaims[idx];
      if (!evaluated) return claim;
      return {
        ...claim,
        verificationStatus: evaluated.verificationStatus,
        confidence: evaluated.confidence,
      };
    });
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const score = Math.max(20, 100 - errorCount * 28 - warningCount * 12);

  const verdict: QualityAuditReport['verdict'] =
    errorCount > 0
      ? 'flagged_uncertainty'
      : warningCount > 0
        ? 'revised_pass'
        : 'pass';

  return {
    verdict,
    score,
    issues,
    sanitizedResult: nextResult,
  };
}
