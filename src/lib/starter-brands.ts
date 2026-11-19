import type { BrandStatus, StarterBrandKey } from '@/types/domain';

export interface StarterBrandPreset {
  starterKey: Exclude<StarterBrandKey, 'custom'>;
  name: string;
  slug: string;
  description: string;
  industry: string;
  targetAudience: string;
  brandVoice: string;
  contentPillars: string[];
  primaryColor: string;
  accentColor: string;
  restrictions: string;
  status: BrandStatus;
}

/**
 * Editable Phase 1 baseline brand profiles.
 * Deliberately free of invented product specs, pricing, certifications, or performance claims;
 * all attributes are editable or archivable directly inside the Brand Profiles dashboard.
 */
export const STARTER_BRAND_PRESETS: readonly StarterBrandPreset[] = [
  {
    starterKey: 'saket_personal',
    name: 'Saket Personal',
    slug: 'saket-personal',
    description:
      'Founder personal identity and executive communications profile configured for workspace editorial coordination.',
    industry: 'Leadership & Advisory',
    targetAudience: 'Founders, industry partners, engineering leaders, and ecosystem collaborators.',
    brandVoice: 'Direct, thoughtful, grounded in practical execution and clear first-principles reasoning.',
    contentPillars: ['Systems Thinking', 'Operational Leadership', 'Industrial Automation', 'Lessons Learned'],
    primaryColor: '#1E293B',
    accentColor: '#2563EB',
    restrictions: 'Avoid unverified performance numbers, speculative commentary, or generic motivational clichés.',
    status: 'active',
  },
  {
    starterKey: 'magnarc',
    name: 'MAGNARC',
    slug: 'magnarc',
    description:
      'Editable workspace brand profile for MAGNARC technical communications and digital channel readiness.',
    industry: 'Industrial & Engineering',
    targetAudience: 'Technical buyers, procurement leads, and operations engineers.',
    brandVoice: 'Precise, authoritative, specification-aware, and engineering-led.',
    contentPillars: ['Engineering Reliability', 'Application Workflows', 'Technical Documentation', 'Partner Briefings'],
    primaryColor: '#0F172A',
    accentColor: '#0EA5E9',
    restrictions: 'Do not publish unverified technical certifications, unapproved specifications, or pricing claims.',
    status: 'active',
  },
  {
    starterKey: 'greenweld',
    name: 'GreenWeld',
    slug: 'greenweld',
    description:
      'Editable workspace brand profile for GreenWeld sustainability-focused industrial messaging and documentation.',
    industry: 'Sustainable Industrial Solutions',
    targetAudience: 'Manufacturing teams, safety managers, and sustainability stakeholders.',
    brandVoice: 'Clear, accountable, practical, and focused on verifiable process improvements.',
    contentPillars: ['Efficient Processes', 'Workshop Standards', 'Field Insights', 'Material Stewardship'],
    primaryColor: '#065F46',
    accentColor: '#10B981',
    restrictions: 'Never make unsubstantiated environmental claims or cite unverified compliance standards.',
    status: 'active',
  },
  {
    starterKey: 'sapphire',
    name: 'Sapphire',
    slug: 'sapphire',
    description:
      'Editable workspace brand profile for Sapphire customer communications and structured digital presence.',
    industry: 'Commercial & Consumer Brands',
    targetAudience: 'Commercial partners, distribution contacts, and end customers.',
    brandVoice: 'Composed, refined, transparent, and service-oriented.',
    contentPillars: ['Design Craft', 'Customer Guidance', 'Service Excellence', 'Brand Storytelling'],
    primaryColor: '#1D4ED8',
    accentColor: '#3B82F6',
    restrictions: 'Maintain factual product naming only; prohibit invented warranty terms or promotional claims.',
    status: 'active',
  },
] as const;

export function getStarterPreset(key: Exclude<StarterBrandKey, 'custom'>): StarterBrandPreset {
  const found = STARTER_BRAND_PRESETS.find((item) => item.starterKey === key);
  return found || STARTER_BRAND_PRESETS[0];
}
