# Daily Marketing Workflows Guide

## 1. Brand Intelligence & Multi-Agent Planning (`/dashboard/ai`, `/dashboard/brands`)
1. Populate verified facts in **Brand Knowledge** (20 categories) so AI agents never invent technical specifications, certifications, or warranty claims.
2. Select a brand in the **AI Command Center** (`/dashboard/ai`) and ask the Central Orchestrator to run market research, SEO audits, content calendars, or any of the 8 Event Playbooks.
3. Review proposed learnings in **Brand Memory** (`/dashboard/memory`) and approve or reject them before they influence future runs.

## 2. Content Creation & Quality Gate (`/dashboard/content`, `/dashboard/assets`)
1. Upload brand visuals in **Media Library** (`/dashboard/assets`) or export designs via Canva Connect.
2. Create or refine posts in **Content Studio** (`/dashboard/content`), selecting target platforms to generate channel-specific variants.
3. Run the **Quality Gate** to check prohibited terms, character/hashtag limits, media aspect/MIME compatibility, and duplicate risks.

## 3. Approval & Publishing (`/dashboard/approvals`, `/dashboard/publishing`)
1. Submit validated drafts to the **Approval Queue** (`/dashboard/approvals`).
2. Owners/Admins approve or reject each item. Approvals bind cryptographically to the content's `payloadHash`—any subsequent edit invalidates approval and requires re-review.
3. Schedule approved posts in **Publishing Queue** (`/dashboard/publishing/queue`) using UTC storage with `Asia/Kolkata` (or chosen IANA timezone) display.

## 4. Engagement, Reputation & Optimization (`/dashboard/inbox`, `/dashboard/reviews`, `/dashboard/leads`, `/dashboard/analytics`)
- Respond to comments/DMs in **Social Inbox** with automatic 24-hour window and sensitive-topic safeguards.
- Classify and draft replies for customer reviews across 8 categories in **Reviews**.
- Track lead consent provenance before outreach in **Leads**.
- Inspect real null-preserving channel metrics and promote statistically validated A/B experiment learnings back into Phase 3 Brand Memory from **Analytics & Experiments**.
