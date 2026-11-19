# User Onboarding Guide

Antara Engine 4.0 tracks setup progress through **9 deterministic, resumable stages** (`src/lib/onboarding/progress.ts`) visible on the Executive Dashboard (`/dashboard`).

## Required Core Stages (Unlocks "Ready to Operate")
1. **Account Identity Verified** (`/login` or `/register`): Sign in with Firebase Authentication.
2. **Workspace Initialized** (`/onboarding`): Create your workspace (defaults to `Asia/Kolkata` timezone).
3. **Brand Profiles Configured** (`/dashboard/brands`): Initialize the 4 editable starter brands (`Saket Personal`, `MagnArc`, `GreenWeld`, `Sapphire`) or create custom brands.
4. **Ready to Operate**: Automatically activates once stages 1–3 are complete—**optional third-party providers never block core readiness**.

## Optional Power-Up Stages (Activate Anytime)
5. **AI Intelligence Provider** (`/dashboard/ai`): Configure `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` to activate live multi-agent runs across all 9 specialists.
6. **Google Workspace & Apps Script** (`/dashboard/apps-script`): Connect your Google account via OAuth2 PKCE to create, version, and deploy Apps Script automations.
7. **Social Publishing Accounts** (`/dashboard/publishing/accounts`): Connect authorized Instagram, Facebook Pages, YouTube, LinkedIn, TikTok, or Google Business Profile accounts.
8. **Media Library & Creative Assets** (`/dashboard/assets`): Upload validated brand images/videos or connect Canva Connect to persist designs into Firebase Storage.
9. **Autonomy & Safety Policy** (`/dashboard/autonomy`): Review your per-brand autonomy policy (safely defaulted to Mode B: Approval Required) and verify Emergency Stop controls.
