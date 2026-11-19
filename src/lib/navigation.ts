export type DashboardIconName =
  | 'LayoutDashboard'
  | 'Building2'
  | 'Layers'
  | 'Plug'
  | 'Settings'
  | 'ShieldCheck'
  | 'Bell'
  | 'Cpu'
  | 'Users'
  | 'FileCode2'
  | 'Workflow'
  | 'PenTool'
  | 'Send'
  | 'CheckSquare'
  | 'BarChart3'
  | 'History'
  | 'Compass'
  | 'Database'
  | 'Megaphone'
  | 'Calendar'
  | 'Image'
  | 'Palette'
  | 'MessageSquare'
  | 'Star'
  | 'UserPlus'
  | 'Target'
  | 'FlaskConical'
  | 'ShieldAlert'
  | 'Activity'
  | 'HeartPulse'
  | 'Gauge'
  | 'HelpCircle'
  | 'Lock'
  | 'FolderSync';

export interface DashboardNavItem {
  label: string;
  href: string;
  iconName: DashboardIconName;
  phaseTag: 'Phase 1' | 'Phase 2' | 'Phase 3' | 'Phase 4' | 'Phase 5';
  description: string;
  adminOnly?: boolean;
}

export interface DashboardNavGroup {
  id: string;
  title: string;
  items: readonly DashboardNavItem[];
}

export const DASHBOARD_NAV_GROUPS: readonly DashboardNavGroup[] = [
  {
    id: 'main',
    title: 'Main',
    items: [
      {
        label: 'Overview',
        href: '/dashboard',
        iconName: 'LayoutDashboard',
        phaseTag: 'Phase 5',
        description: 'Unified workspace executive overview, readiness tracker, and live queues.',
      },
      {
        label: 'Marketing Overview',
        href: '/dashboard/marketing',
        iconName: 'Megaphone',
        phaseTag: 'Phase 4',
        description: 'Brand Growth Controller, daily priorities, and growth objectives.',
      },
      {
        label: 'AI Command Center',
        href: '/dashboard/ai',
        iconName: 'Cpu',
        phaseTag: 'Phase 3',
        description: 'Natural-language multi-agent orchestrator, DAG runner, and cited briefs.',
      },
      {
        label: 'Agent Team',
        href: '/dashboard/agents',
        iconName: 'Users',
        phaseTag: 'Phase 3',
        description: 'Nine specialist agents, tool allowlists, and eight event playbooks.',
      },
    ],
  },
  {
    id: 'intelligence',
    title: 'Intelligence',
    items: [
      {
        label: 'Market Radar & SEO',
        href: '/dashboard/intelligence',
        iconName: 'Compass',
        phaseTag: 'Phase 3',
        description: 'Grounded research sources, SEO visibility audits, and claim verification.',
      },
      {
        label: 'Brand Memory',
        href: '/dashboard/brand-memory',
        iconName: 'Database',
        phaseTag: 'Phase 3',
        description: '20-category structured brand facts and 7-namespace memory governance.',
      },
      {
        label: 'Strategy',
        href: '/dashboard/strategy',
        iconName: 'PenTool',
        phaseTag: 'Phase 3',
        description: '7/14/30-day brand content strategy plans and campaign briefs.',
      },
    ],
  },
  {
    id: 'content',
    title: 'Content',
    items: [
      {
        label: 'Content Factory',
        href: '/dashboard/content',
        iconName: 'PenTool',
        phaseTag: 'Phase 4',
        description: '5-stage content CMS, brand QA gate, platform variants, and versioning.',
      },
      {
        label: 'Creative Studio',
        href: '/dashboard/creative-studio',
        iconName: 'Palette',
        phaseTag: 'Phase 4',
        description: 'Brand creative briefs, visual rules, and Canva Connect export workflows.',
      },
      {
        label: 'Media Library',
        href: '/dashboard/assets',
        iconName: 'Image',
        phaseTag: 'Phase 4',
        description: 'Validated Firebase Storage media library with SHA-256 deduplication.',
      },
      {
        label: 'Content Calendar',
        href: '/dashboard/calendar',
        iconName: 'Calendar',
        phaseTag: 'Phase 4',
        description: 'IANA timezone & DST-aware scheduling calendar across all brands.',
      },
      {
        label: 'Publishing Center',
        href: '/dashboard/publishing',
        iconName: 'Send',
        phaseTag: 'Phase 4',
        description: 'Multi-platform publishing execution, recovery center, and audit history.',
      },
    ],
  },
  {
    id: 'engagement',
    title: 'Engagement',
    items: [
      {
        label: 'Social Inbox',
        href: '/dashboard/inbox',
        iconName: 'MessageSquare',
        phaseTag: 'Phase 4',
        description: 'Policy-aware comments and direct messages with 24h window guards.',
      },
      {
        label: 'Reviews & GBP',
        href: '/dashboard/reviews',
        iconName: 'Star',
        phaseTag: 'Phase 4',
        description: '8-category review classifier, brand-safe drafts, and GBP readiness.',
      },
      {
        label: 'Leads & Follow-ups',
        href: '/dashboard/leads',
        iconName: 'UserPlus',
        phaseTag: 'Phase 4',
        description: 'Consent-tracked lead CRM with provenance and follow-up activity.',
      },
    ],
  },
  {
    id: 'performance',
    title: 'Performance',
    items: [
      {
        label: 'Analytics',
        href: '/dashboard/analytics',
        iconName: 'BarChart3',
        phaseTag: 'Phase 4',
        description: 'Null-preserving cross-platform metrics with currency separation.',
      },
      {
        label: 'Campaigns',
        href: '/dashboard/campaigns',
        iconName: 'Target',
        phaseTag: 'Phase 4',
        description: 'Meta Ads budget caps, dry-run validation, and owner launch guard.',
      },
      {
        label: 'Experiments',
        href: '/dashboard/experiments',
        iconName: 'FlaskConical',
        phaseTag: 'Phase 4',
        description: 'A/B marketing experiments feeding verified learnings into Brand Memory.',
      },
    ],
  },
  {
    id: 'automation',
    title: 'Automation',
    items: [
      {
        label: 'Drive Autopilot',
        href: '/dashboard/autopilot',
        iconName: 'FolderSync',
        phaseTag: 'Phase 5',
        description: 'Autonomous Google Drive video monitoring, multimodal analysis, scheduling & publishing.',
      },
      {
        label: 'Apps Script Center',
        href: '/dashboard/apps-script',
        iconName: 'FileCode2',
        phaseTag: 'Phase 2',
        description: 'Google OAuth Doctor, Drive discovery, editor, versions & deployments.',
      },
      {
        label: 'Marketing Scripts',
        href: '/dashboard/apps-script-automation',
        iconName: 'Workflow',
        phaseTag: 'Phase 4',
        description: '8 marketing Google Apps Script templates integrated with Phase 2.',
      },
      {
        label: 'Activity & History',
        href: '/dashboard/activity',
        iconName: 'Activity',
        phaseTag: 'Phase 4',
        description: 'Unified filterable timeline of workflow, publishing, and AI events.',
      },
    ],
  },
  {
    id: 'management',
    title: 'Management',
    items: [
      {
        label: 'Brands',
        href: '/dashboard/brands',
        iconName: 'Layers',
        phaseTag: 'Phase 1',
        description: 'Manage Saket Personal, MAGNARC, GreenWeld, Sapphire & custom brands.',
      },
      {
        label: 'Connected Accounts',
        href: '/dashboard/publishing/accounts',
        iconName: 'Plug',
        phaseTag: 'Phase 4',
        description: 'Authorize and monitor social publishing and Canva accounts.',
      },
      {
        label: 'Integrations',
        href: '/dashboard/integrations',
        iconName: 'Plug',
        phaseTag: 'Phase 1',
        description: 'Honest capability matrix for Google, AI, and external providers.',
      },
      {
        label: 'Approvals',
        href: '/dashboard/approvals',
        iconName: 'CheckSquare',
        phaseTag: 'Phase 4',
        description: 'Payload-hash bound human signoff queue for external actions.',
      },
      {
        label: 'Autonomy Settings',
        href: '/dashboard/autonomy',
        iconName: 'ShieldAlert',
        phaseTag: 'Phase 4',
        description: 'Mode A/B/C rules, daily caps, and Global/Brand/Platform Emergency Stop.',
      },
      {
        label: 'Workspaces',
        href: '/dashboard/workspaces',
        iconName: 'Building2',
        phaseTag: 'Phase 1',
        description: 'Tenant switching, team RBAC roles, and member invitations.',
      },
    ],
  },
  {
    id: 'system',
    title: 'System',
    items: [
      {
        label: 'System Health',
        href: '/dashboard/system-health',
        iconName: 'HeartPulse',
        phaseTag: 'Phase 5',
        description: 'Live database latency, provider matrix, scheduler queue & integrity audit.',
      },
      {
        label: 'Usage & Costs',
        href: '/dashboard/usage',
        iconName: 'Gauge',
        phaseTag: 'Phase 5',
        description: 'AI tokens, storage bytes, cost separation & configurable alert thresholds.',
      },
      {
        label: 'Notifications',
        href: '/dashboard/notifications',
        iconName: 'Bell',
        phaseTag: 'Phase 1',
        description: 'System notices, onboarding confirmations, and operational alerts.',
      },
      {
        label: 'Security & Audit',
        href: '/dashboard/security',
        iconName: 'ShieldCheck',
        phaseTag: 'Phase 1',
        description: 'Encryption status, data export, boundary verification, and audit logs.',
      },
      {
        label: 'Workspace Settings',
        href: '/dashboard/settings',
        iconName: 'Settings',
        phaseTag: 'Phase 1',
        description: 'Centralized 12-category settings, timezone, and account governance.',
      },
      {
        label: 'Help & Support',
        href: '/dashboard/help',
        iconName: 'HelpCircle',
        phaseTag: 'Phase 5',
        description: 'Integration guides, error code lookup, recovery runbooks, and governance.',
      },
      {
        label: 'Platform Admin',
        href: '/dashboard/admin',
        iconName: 'Lock',
        phaseTag: 'Phase 5',
        description: 'Owner/Admin governance view for failure rates, members & schema migrations.',
        adminOnly: true,
      },
    ],
  },
] as const;

export const ALL_DASHBOARD_NAV_ITEMS: readonly DashboardNavItem[] = DASHBOARD_NAV_GROUPS.flatMap(
  (g) => g.items,
);

// Backward-compatible named exports
export const PHASE_1_NAV_ITEMS = ALL_DASHBOARD_NAV_ITEMS.filter((i) => i.phaseTag === 'Phase 1');
export const PHASE_2_NAV_ITEMS = ALL_DASHBOARD_NAV_ITEMS.filter((i) => i.phaseTag === 'Phase 2');
export const PHASE_3_NAV_ITEMS = ALL_DASHBOARD_NAV_ITEMS.filter((i) => i.phaseTag === 'Phase 3');
export const PHASE_4_NAV_ITEMS = ALL_DASHBOARD_NAV_ITEMS.filter((i) => i.phaseTag === 'Phase 4');
export const FUTURE_ARCHITECTURE_NAV_ITEMS: readonly DashboardNavItem[] = [] as const;

export const PUBLIC_NAV_LINKS = [
  { label: 'Product', href: '/product' },
  { label: 'Features', href: '/features' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Terms', href: '/terms' },
] as const;
