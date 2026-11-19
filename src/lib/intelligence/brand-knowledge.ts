import {
  BRAND_FACT_CATEGORIES,
  type BrandFactCategory,
  type BrandKnowledgeFact,
  type BrandProfile,
} from '@/types/domain';
import { estimateStringTokens } from '@/lib/ai/model-router';

export interface BrandCategoryMetadata {
  id: BrandFactCategory;
  label: string;
  description: string;
}

export const BRAND_CATEGORY_CATALOG: Record<BrandFactCategory, BrandCategoryMetadata> = {
  identity_and_positioning: {
    id: 'identity_and_positioning',
    label: 'Identity & Positioning',
    description: 'Core brand identity, category definition, and market positioning.',
  },
  mission_and_values: {
    id: 'mission_and_values',
    label: 'Mission & Values',
    description: 'Guiding organizational purpose and operating principles.',
  },
  products_and_services: {
    id: 'products_and_services',
    label: 'Products & Services',
    description: 'Verified product lines, service offerings, and deliverables.',
  },
  technical_capabilities: {
    id: 'technical_capabilities',
    label: 'Technical Capabilities',
    description: 'Documented engineering, manufacturing, or platform capabilities.',
  },
  pricing_and_offers: {
    id: 'pricing_and_offers',
    label: 'Pricing & Offers',
    description: 'Explicitly approved pricing structures, bundles, or commercial terms.',
  },
  target_audiences_icp: {
    id: 'target_audiences_icp',
    label: 'Target Audiences (ICP)',
    description: 'Ideal customer profiles, buyer roles, and procurement stakeholders.',
  },
  pain_points_and_objections: {
    id: 'pain_points_and_objections',
    label: 'Pain Points & Objections',
    description: 'Verified buyer friction points and recurring technical concerns.',
  },
  value_propositions: {
    id: 'value_propositions',
    label: 'Value Propositions',
    description: 'Core practical outcomes delivered for customers.',
  },
  differentiators: {
    id: 'differentiators',
    label: 'Differentiators',
    description: 'Evidence-backed advantages separating the brand from alternatives.',
  },
  brand_voice_and_tone: {
    id: 'brand_voice_and_tone',
    label: 'Brand Voice & Tone',
    description: 'Editorial personality, cadence, and writing posture.',
  },
  terminology_and_preferred_phrases: {
    id: 'terminology_and_preferred_phrases',
    label: 'Preferred Terminology',
    description: 'Required naming conventions and domain vocabulary.',
  },
  prohibited_claims_and_restrictions: {
    id: 'prohibited_claims_and_restrictions',
    label: 'Prohibited Claims & Restrictions',
    description: 'Non-negotiable boundaries on specs, certifications, pricing, and hype.',
  },
  compliance_and_legal_constraints: {
    id: 'compliance_and_legal_constraints',
    label: 'Compliance & Legal Constraints',
    description: 'Regulatory, disclosure, and statutory compliance boundaries.',
  },
  geographic_markets_and_languages: {
    id: 'geographic_markets_and_languages',
    label: 'Markets & Languages',
    description: 'Target regions, locales, and language standards.',
  },
  competitor_landscape: {
    id: 'competitor_landscape',
    label: 'Competitor Landscape',
    description: 'Documented peer organizations and verified market comparisons.',
  },
  proof_points_and_metrics: {
    id: 'proof_points_and_metrics',
    label: 'Proof Points & Metrics',
    description: 'Audited performance numbers, benchmarks, and verifiable results.',
  },
  customer_testimonials_case_studies: {
    id: 'customer_testimonials_case_studies',
    label: 'Case Studies & Testimonials',
    description: 'Approved customer quotes and documented deployment case notes.',
  },
  visual_identity_and_creative_guidelines: {
    id: 'visual_identity_and_creative_guidelines',
    label: 'Visual & Creative Guidelines',
    description: 'Color palette, visual restraint, and layout principles.',
  },
  channel_priorities_and_rules: {
    id: 'channel_priorities_and_rules',
    label: 'Channel Priorities & Rules',
    description: 'LinkedIn, SEO blog, YouTube, Instagram, and email formatting rules.',
  },
  faqs_and_objection_handling: {
    id: 'faqs_and_objection_handling',
    label: 'FAQs & Objection Handling',
    description: 'Verified standard responses to common customer or lead inquiries.',
  },
};

export function listBrandCategories(): BrandCategoryMetadata[] {
  return BRAND_FACT_CATEGORIES.map((id) => BRAND_CATEGORY_CATALOG[id]);
}

/**
 * Generates non-fabricated baseline facts strictly derived from an existing Phase 1 BrandProfile.
 * Never invents certifications, prices, specs, or performance numbers.
 */
export function buildBaselineBrandFacts(
  brand: BrandProfile,
  actorUid: string,
  nowIso: string,
): BrandKnowledgeFact[] {
  const facts: BrandKnowledgeFact[] = [];
  const add = (
    suffix: string,
    category: BrandFactCategory,
    title: string,
    statement: string,
  ) => {
    if (!statement.trim()) return;
    facts.push({
      id: `bf_${brand.id}_${suffix}`,
      workspaceId: brand.workspaceId,
      brandId: brand.id,
      category,
      title,
      statement: statement.trim(),
      verificationStatus: 'VERIFIED',
      approvalStatus: 'approved',
      confidence: 1,
      provenanceType: 'brand_profile',
      sourceIds: [`brand:${brand.id}`],
      createdBy: actorUid,
      approvedBy: actorUid,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  };

  add(
    'identity',
    'identity_and_positioning',
    `${brand.name} Core Positioning`,
    brand.description || `${brand.name} workspace brand profile (${brand.industry || 'General'}).`,
  );

  if (brand.targetAudience) {
    add(
      'icp',
      'target_audiences_icp',
      `${brand.name} Target Audience`,
      brand.targetAudience,
    );
  }

  if (brand.brandVoice) {
    add(
      'voice',
      'brand_voice_and_tone',
      `${brand.name} Editorial Voice`,
      brand.brandVoice,
    );
  }

  if (brand.contentPillars.length > 0) {
    add(
      'pillars',
      'channel_priorities_and_rules',
      `${brand.name} Core Content Pillars`,
      `Approved editorial focus pillars: ${brand.contentPillars.join(', ')}.`,
    );
  }

  if (brand.restrictions) {
    add(
      'restrictions',
      'prohibited_claims_and_restrictions',
      `${brand.name} Strict Restrictions`,
      brand.restrictions,
    );
  }

  add(
    'visual',
    'visual_identity_and_creative_guidelines',
    `${brand.name} Color System`,
    `Primary color ${brand.primaryColor}${brand.accentColor ? `; Accent color ${brand.accentColor}` : ''}.`,
  );

  return facts;
}

export function formatBrandContextForPrompt(
  brand: BrandProfile | null,
  facts: BrandKnowledgeFact[],
  maxTokens = 1200,
): string {
  if (!brand) {
    return 'No specific brand selected. Operate at workspace governance level and avoid inventing brand-specific claims.';
  }

  const lines: string[] = [
    `Brand: ${brand.name} (ID: ${brand.id}, Industry: ${brand.industry || 'Unspecified'}, Status: ${brand.status})`,
    brand.description ? `Positioning: ${brand.description}` : '',
    brand.targetAudience ? `Target Audience: ${brand.targetAudience}` : '',
    brand.brandVoice ? `Brand Voice: ${brand.brandVoice}` : '',
    brand.contentPillars.length > 0
      ? `Content Pillars: ${brand.contentPillars.join(' | ')}`
      : '',
    brand.restrictions
      ? `MANDATORY RESTRICTIONS: ${brand.restrictions}`
      : 'MANDATORY RESTRICTIONS: Do not fabricate specifications, certifications, pricing, or unverified metrics.',
    brand.websiteUrl ? `Website: ${brand.websiteUrl}` : '',
  ].filter(Boolean);

  const approvedFacts = facts.filter(
    (f) => f.brandId === brand.id && f.approvalStatus === 'approved' && f.verificationStatus !== 'CONTRADICTED',
  );

  if (approvedFacts.length > 0) {
    lines.push('', 'Approved Brand Knowledge Facts:');
    let usedTokens = estimateStringTokens(lines.join('\n'));
    for (const fact of approvedFacts) {
      const line = `- [${fact.category}] (${fact.verificationStatus}) ${fact.title}: ${fact.statement}`;
      const cost = estimateStringTokens(line);
      if (usedTokens + cost > maxTokens) break;
      lines.push(line);
      usedTokens += cost;
    }
  }

  return lines.join('\n');
}
