export type OnboardingStageId =
  | 'ACCOUNT_READY'
  | 'WORKSPACE_READY'
  | 'BRANDS_READY'
  | 'AI_PROVIDER_READY'
  | 'GOOGLE_ACCESS_READY'
  | 'SOCIAL_ACCOUNTS_READY'
  | 'MEDIA_READY'
  | 'AUTONOMY_CONFIGURED'
  | 'READY_TO_OPERATE';

export interface OnboardingStageItem {
  id: OnboardingStageId;
  label: string;
  required: boolean;
  completed: boolean;
  detail: string;
  actionHref: string;
  actionLabel: string;
}

export interface OnboardingProgressSummary {
  stages: OnboardingStageItem[];
  completedRequiredCount: number;
  totalRequiredCount: number;
  completedOptionalCount: number;
  totalOptionalCount: number;
  overallReady: boolean;
  completionPercent: number;
}

export function evaluateOnboardingProgress(input: {
  hasAccount: boolean;
  hasWorkspace: boolean;
  brandsCount: number;
  aiConfigured: boolean;
  activeAiProviders: string[];
  googleConnectedCount: number;
  socialConnectedCount: number;
  mediaAssetsCount: number;
  autonomyPoliciesCount: number;
}): OnboardingProgressSummary {
  const accountReady = input.hasAccount;
  const workspaceReady = input.hasWorkspace;
  const brandsReady = input.brandsCount > 0;
  const aiReady = input.aiConfigured;
  const googleReady = input.googleConnectedCount > 0;
  const socialReady = input.socialConnectedCount > 0;
  const mediaReady = input.mediaAssetsCount > 0;
  const autonomyReady = input.autonomyPoliciesCount > 0;
  const readyToOperate = accountReady && workspaceReady && brandsReady;

  const stages: OnboardingStageItem[] = [
    {
      id: 'ACCOUNT_READY',
      label: 'Account Identity Verified',
      required: true,
      completed: accountReady,
      detail: accountReady
        ? 'Firebase Authentication session verified with isolated identity boundary.'
        : 'Sign in or register an Antara account.',
      actionHref: '/login',
      actionLabel: 'Sign In',
    },
    {
      id: 'WORKSPACE_READY',
      label: 'Workspace Initialized',
      required: true,
      completed: workspaceReady,
      detail: workspaceReady
        ? 'Multi-tenant workspace provisioned with Asia/Kolkata default timezone.'
        : 'Create or select your organization workspace.',
      actionHref: '/onboarding',
      actionLabel: 'Setup Workspace',
    },
    {
      id: 'BRANDS_READY',
      label: 'Brand Profiles Configured',
      required: true,
      completed: brandsReady,
      detail: brandsReady
        ? `${input.brandsCount} brand profile(s) active in this workspace.`
        : 'Initialize starter brands or create a custom brand profile.',
      actionHref: '/dashboard/brands',
      actionLabel: 'Manage Brands',
    },
    {
      id: 'AI_PROVIDER_READY',
      label: 'AI Intelligence Provider',
      required: false,
      completed: aiReady,
      detail: aiReady
        ? `Active AI provider(s): ${input.activeAiProviders.join(', ')}.`
        : 'Optional: configure GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY for live agent synthesis.',
      actionHref: '/dashboard/ai',
      actionLabel: 'Open AI Command Center',
    },
    {
      id: 'GOOGLE_ACCESS_READY',
      label: 'Google Workspace & Apps Script',
      required: false,
      completed: googleReady,
      detail: googleReady
        ? `${input.googleConnectedCount} active Google OAuth connection(s).`
        : 'Optional: authorize Google Workspace & Apps Script for automated script deployments.',
      actionHref: '/dashboard/apps-script',
      actionLabel: 'Connect Google',
    },
    {
      id: 'SOCIAL_ACCOUNTS_READY',
      label: 'Social Publishing Accounts',
      required: false,
      completed: socialReady,
      detail: socialReady
        ? `${input.socialConnectedCount} connected publishing channel(s).`
        : 'Optional: connect Instagram, Facebook, LinkedIn, YouTube, TikTok, or GBP.',
      actionHref: '/dashboard/publishing/accounts',
      actionLabel: 'Connect Channels',
    },
    {
      id: 'MEDIA_READY',
      label: 'Media Library & Creative Assets',
      required: false,
      completed: mediaReady,
      detail: mediaReady
        ? `${input.mediaAssetsCount} validated media asset(s) stored.`
        : 'Optional: upload brand imagery/video or export designs via Canva Connect.',
      actionHref: '/dashboard/assets',
      actionLabel: 'Open Media Library',
    },
    {
      id: 'AUTONOMY_CONFIGURED',
      label: 'Autonomy & Safety Policy',
      required: false,
      completed: autonomyReady,
      detail: autonomyReady
        ? `${input.autonomyPoliciesCount} brand autonomy policy record(s) configured (defaults to Approval Required).`
        : 'Defaults safely to Mode B (Approval Required). Review Modes A/B/C and Emergency Stop.',
      actionHref: '/dashboard/autonomy',
      actionLabel: 'Review Autonomy',
    },
    {
      id: 'READY_TO_OPERATE',
      label: 'Ready to Operate',
      required: true,
      completed: readyToOperate,
      detail: readyToOperate
        ? 'Core workspace operational. Unconnected external providers remain cleanly isolated.'
        : 'Complete required Account, Workspace, and Brand stages to launch operations.',
      actionHref: '/dashboard',
      actionLabel: 'Go to Dashboard',
    },
  ];

  const requiredStages = stages.filter((s) => s.required);
  const optionalStages = stages.filter((s) => !s.required);
  const completedRequiredCount = requiredStages.filter((s) => s.completed).length;
  const completedOptionalCount = optionalStages.filter((s) => s.completed).length;
  const totalCompleted = stages.filter((s) => s.completed).length;

  return {
    stages,
    completedRequiredCount,
    totalRequiredCount: requiredStages.length,
    completedOptionalCount,
    totalOptionalCount: optionalStages.length,
    overallReady: readyToOperate,
    completionPercent: Math.round((totalCompleted / stages.length) * 100),
  };
}
