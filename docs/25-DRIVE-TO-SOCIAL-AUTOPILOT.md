# 25 — Drive-to-Social Autopilot Engine

## Overview

The **Drive-to-Social Autopilot Engine** is a continuous, server-backed video publishing automation pipeline inside Antara Engine 4.0 (`/dashboard/autopilot`). Owners connect Google Drive via official OAuth (`drive.readonly`), choose one or more Drive folders per brand, configure recurring publishing policies once, and allow Antara to discover, analyze, schedule, and publish eligible videos continuously without daily prompts or open browser sessions.

## Architecture

1. **Google Drive Source Monitoring (`src/lib/autopilot/drive-monitor.ts`)**
   - Incremental OAuth capability `drive_autopilot_read` (`https://www.googleapis.com/auth/drive.readonly`).
   - Live Drive Folder Picker (`/api/workspaces/[workspaceId]/autopilot/folders`) plus direct Folder ID selection.
   - Recursive subfolder traversal (configurable depth cap) with graceful handling of inaccessible subfolders, trashed files, and unsupported MIME types.
   - Drive Changes push notifications (`/api/webhooks/google-drive`) paired with durable scheduled reconciliation (`/api/cron/autopilot-worker`, registered in `vercel.json` every 5 minutes).
   - Persistent file registry (`workspaces/{workspaceId}/autopilotFiles/{fileId}`) with duplicate detection by Drive file ID and content hash (`md5Checksum` + `contentSha256`). Unchanged videos are never reprocessed unless explicitly requested.

2. **Intelligent Multimodal Video Analysis & Unique Metadata (`src/lib/autopilot/video-analyzer.ts`)**
   - Server-side `@google/genai` (`gemini-4-hydrogen`) analyzes retrieved video bytes or extracted representative frames + audio transcripts.
   - **Hard anti-filename-only invariant**: refuses to generate captions solely from filenames (`VIDEO_MEDIA_REQUIRED_FOR_ANALYSIS`).
   - Generates per-video content title, opening hook, Instagram caption, YouTube title, YouTube description, hashtags, keywords, CTA, short description, platform-specific metadata, and suggested thumbnail text grounded in the brand's tone, target audience, verified facts, and restrictions.
   - Enforces caption uniqueness across prior videos in the policy (`Jaccard similarity < 0.72`) and flags misleading claims, sensitive content, and platform format issues.

3. **Durable Scheduling & Recovery (`src/lib/autopilot/scheduler.ts`)**
   - IANA timezone-aware slot planner (`Asia/Kolkata` default) honoring `maxPostsPerDay` (strict cap, never forced when queue is empty), `minGapMinutes`, `publishingDays`, `dailyTimeWindows`, and `chronological` or `priority_first` ordering.
   - Prevents duplicate scheduling and simultaneous slot conflicts, recalculates future slots on schedule changes/failures, and recovers stale worker leases after restarts without discarding queued content or blindly retrying `publish_status_unknown`.

4. **Authorized Publishing & Safety (`src/lib/autopilot/engine.ts`)**
   - Strictly routes every publish job through the **Central Action Gateway** (`evaluateActionGateway`) and verified provider adapters (`getSocialPublishingAdapter`).
   - Strict separation between `DRAFT_ONLY`, `APPROVAL_REQUIRED` (payload-hash-bound human approval invalidated on caption edit), and `AUTOMATIC_PUBLISHING` (requires explicit per-account authorization in `authorizedAutoPublishAccountIds`).
   - Paid advertising is never auto-enabled. Authentication expiry or serious policy violations automatically pause the affected policy.

## Verification

Run the dedicated 17-step acceptance test suite:

```bash
npm test
```

Automated tests use deterministic test-only adapters explicitly flagged with `isLiveProviderVerification: false` so mock runs are never misreported as live social platform verification.
