# Usage, Quotas & Cost Visibility Guide

Available at `/dashboard/usage` (backed by `GET/PUT /api/workspaces/[workspaceId]/usage`).

## 1. Honest Separation of Cost Sources
Antara Engine 4.0 strictly distinguishes three billing categories so operators never mistake application estimates for actual provider invoices:
1. **Estimated Application Cost (AI Ledger)**: Calculated from real token counts (`inputTokens`, `outputTokens`) logged in `aiUsageLedger` multiplied by known model pricing tables. Models with unknown pricing report `pricingKnown: false` rather than fabricating costs.
2. **Provider-Reported Cost**: Reported as `null` / unavailable until directly fetched from an authorized billing API (never guessed).
3. **Infrastructure Billing (Firebase / GCP / Vercel)**: Reported honestly as `unavailable_from_app_runtime`. Inspect actual invoices directly in Google Cloud Billing and Vercel Usage dashboards.

## 2. Configurable Warning Thresholds
Workspace Admins/Owners can configure soft operational warning thresholds saved to `workspaces/{workspaceId}/settings/usage_thresholds`:
- **Monthly AI Estimated Spend Warning (USD)** (default `$25`)
- **Daily AI Requests Warning** (default `200`)
- **Workspace Media Storage Warning (MB)** (default `500 MB`)

Warnings trigger at `80%` of each configured threshold.

> **Important Disclaimer**: Application thresholds issue operational warnings only and do **not** enforce hard billing caps on external cloud or AI providers. Always configure hard spending limits/budget alerts directly inside Google Cloud Billing, AI provider consoles (Google AI Studio / OpenAI / Anthropic), Meta Ads Manager, and Vercel.

## 3. Paid Advertising Spend Governance (Phase 4)
Paid ad campaign mutations are independently gated by `campaignBudgetPolicies` requiring explicit Owner role approval and hard numeric daily/total spend caps before any campaign can leave `draft_plan` / `dry_run_validated`.
