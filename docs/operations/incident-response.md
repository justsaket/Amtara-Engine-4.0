# Incident Response Playbook

## 1. Immediate Containment (Priority 0)
If an unauthorized publish, unexpected automation loop, or compromised external account is suspected:
1. Open `/dashboard/autonomy` and activate **Global Emergency Stop** immediately.
   - Blocks all immediate external publishing, replies, and `/api/cron/publish-dispatcher` execution via the Central Action Gateway.
2. If only a single brand or channel is affected, pause that specific brand or platform instead.
3. Review `/dashboard/audit-logs` and `/dashboard/system-health` (Recent Structured Logs) using the event's `correlationId`.

## 2. Credential Compromise Response
1. **Compromised Social / Google OAuth Account**: Disconnect the affected account in `/dashboard/publishing/accounts` or `/dashboard/apps-script` (automatically revokes tokens where supported, deletes `encryptedCredentials`, and cancels pending scheduled jobs). Revoke Antara access directly in the external provider's security console as well.
2. **Compromised `ENCRYPTION_KEY`**:
   - Generate a new 32-byte hex key.
   - Move the old key to `ENCRYPTION_KEY_PREVIOUS` and `ENCRYPTION_KEY_PREVIOUS_VERSION`.
   - Set the new key in `ENCRYPTION_KEY` and increment `ENCRYPTION_KEY_VERSION` (e.g., `v2`).
   - Re-deploy and instruct users to re-authorize high-sensitivity accounts.
3. **Compromised `SESSION_SECRET` or `CRON_SECRET`**: Rotate in Vercel Environment Variables and redeploy immediately.

## 3. Severity & Triage Classification
Antara classifies runtime failures into 7 operational buckets (`src/lib/server/observability.ts`):
- `AUTHORIZATION`: Expired/revoked tokens, missing scopes, or RBAC denials → Re-authorize account or inspect role assignment.
- `CONFIGURATION`: Missing optional provider keys or invalid OAuth redirect URI → Review `/dashboard/system-health` & Vercel env vars.
- `RATE_LIMIT`: Provider HTTP 429 or Antara sliding-window protection → Wait for retry window / check daily caps.
- `TRANSIENT`: Upstream 502/503/504 or network timeout → Handled by bounded exponential backoff (`2m → 8m → 32m`).
- `PERMANENT`: Invalid media format, unsupported capability, or 404 → Fix content/media payload before rescheduling.
- `VALIDATION`: Zod schema or QA gate failure → Review field errors in UI.
- `UNKNOWN`: Inspect structured logs + correlation ID.
