# Google OAuth Integration Guide (Phase 2 & 4)

## 1. Architecture
- **Flow**: OAuth 2.0 Authorization Code with PKCE (`S256`) and HMAC-signed `state` parameter binding `workspaceId`, `uid`, and nonce (`src/lib/google/oauth.ts`).
- **Token Storage**: Access and refresh tokens are encrypted via AES-256-GCM bound to AAD (`workspaceId:google:<credentialId>`) and stored in `workspaces/{workspaceId}/encryptedCredentials/{id}`. Raw tokens are never sent to browser clients, logs, exports, or Admin Console responses.
- **Disconnect & Revocation**: Disconnecting a Google connection attempts Google OAuth token revocation, marks the connection disconnected, deletes encrypted token material, and logs an audit entry.

## 2. Google Cloud Console Setup
1. Create or open a Google Cloud Project.
2. Enable required APIs:
   - **Apps Script API** (`script.googleapis.com`)
   - **Google Drive API** (`drive.googleapis.com`)
   - Optional (Phase 4): **YouTube Data API v3** (`youtube.googleapis.com`), **Google Business Profile APIs** (after Google approval)
3. Configure **OAuth Consent Screen**:
   - Add authorized domain matching your production Vercel domain.
   - Add privacy policy URL (`https://<your-domain>/privacy`) and terms URL (`https://<your-domain>/terms`).
   - While in Testing mode, add your own Google account under Test Users.
4. Create an **OAuth 2.0 Client ID (Web Application)**:
   - Authorized Redirect URI: `https://<your-domain>/api/integrations/google/callback` (and `http://localhost:3000/api/integrations/google/callback` for local development).
5. Set environment variables:
   - `GOOGLE_INTEGRATION_CLIENT_ID`
   - `GOOGLE_INTEGRATION_CLIENT_SECRET`
   - `GOOGLE_INTEGRATION_REDIRECT_URI`

## 3. Sensitive Scope Verification Notice
Google classifies `script.projects`, `script.deployments`, and Drive scopes as sensitive/restricted. Before inviting external non-test workspace users, complete Google's OAuth App Verification process in Google Cloud Console.
