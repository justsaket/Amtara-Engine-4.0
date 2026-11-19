# Security Model — Antara Engine 4.0

## 1. Identity, Tenant Isolation & RBAC
- **Authentication**: Firebase Authentication ID tokens verified server-side on every protected API endpoint.
- **5-Tier RBAC**: `owner`, `admin`, `editor`, `operator`, and `viewer` (`src/lib/rbac.ts`), with strict least-privilege permissions and anti-privilege-escalation checks (`canAssignRole`, `canManageMember`).
- **Tenant Isolation**: Every document is scoped under `workspaces/{workspaceId}/...`. Cross-tenant reads and writes are blocked in both server repositories (`src/lib/server/tenant-guard.ts`) and deployed `firestore.rules`.
- **Admin Console Restriction**: `/api/workspaces/[workspaceId]/admin-console` and `/api/workspaces/[workspaceId]/export` strictly require `owner` or `admin` roles and never expose raw tokens or encrypted envelopes.

## 2. Secrets & Credential Vault
- **AES-256-GCM with AAD**: All Google OAuth and social platform tokens are encrypted server-side (`src/lib/server/crypto.ts`) using AES-256-GCM bound to Additional Authenticated Data (`workspaceId:provider:credentialId`), preventing cross-tenant ciphertext replay.
- **Key Separation**: `ENCRYPTION_KEY` and `SESSION_SECRET` are never stored in Firestore, never placed in `NEXT_PUBLIC_*` variables, and never bundled into `.next/static/`.
- **Key Rotation**: Supports `ENCRYPTION_KEY_VERSION` plus optional `ENCRYPTION_KEY_PREVIOUS` / `ENCRYPTION_KEY_PREVIOUS_VERSION` for non-destructive decryption during key rotation.
- **Public Health Sanitization**: `/api/health` intentionally omits Firebase project IDs, Firestore database IDs, secret file paths, and internal secret metadata.

## 3. HTTP Security Headers & Transport Controls (`next.config.ts`)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-DNS-Prefetch-Control: off`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- Compatible `Content-Security-Policy` (`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`) allowing Firebase Auth/Storage and Google APIs while blocking unsafe object/base injection.
- `Cache-Control: no-store, no-cache, must-revalidate, private` on all `/api/:path*` routes.

## 4. Defense Against Common Attack Classes
- **SSRF Protection**: Research URL fetcher rejects `localhost`, loopback, link-local, private IPv4/IPv6 ranges, cloud metadata endpoints (`169.254.169.254`), and non-HTTP(S) schemes.
- **Prompt Injection Defense**: Untrusted external text is delimited and stripped of directive override markers before model invocation.
- **Webhook Authenticity**: Meta (`X-Hub-Signature-256`) and TikTok webhook endpoints verify constant-time HMAC signatures before accepting events.
- **Open Redirect Prevention**: `sanitizeInternalRedirect` rejects protocol-relative (`//`), absolute external URLs, backslashes, and CRLF characters.
- **Rate Limiting & Payload Bounds**: Sliding-window rate limiter (`src/lib/server/rate-limit.ts`) and Content-Length checks protect high-cost/export routes.
- **Log Redaction**: `src/lib/server/observability.ts` recursively masks keys matching secrets/tokens/credentials and strips `Bearer`, `ya29.`, `AIza`, `sk-`, and PEM private key patterns.

## 5. Firestore Security Rules Review Notice
`firestore.rules` passes `npm run lint:rules` (`@firebase/eslint-plugin-security-rules`) with 0 errors and enforces authenticated workspace-member isolation. Before opening broad multi-organization commercial signups, operators should review and tighten any custom organization-specific constraints in `firestore.rules` and deploy via Firebase CLI.
