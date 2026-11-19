import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function escapeJsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\u003c');
}

function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const safeProvider = provider.replace(/[^a-z0-9_-]/gi, '');
  const code = request.nextUrl.searchParams.get('code') || '';
  const state = request.nextUrl.searchParams.get('state') || '';
  const oauthError = request.nextUrl.searchParams.get('error') || '';
  const oauthErrorDescription =
    request.nextUrl.searchParams.get('error_description') || '';

  const cookieRaw = request.cookies.get(`antara_social_oauth_${safeProvider}`)?.value;
  let stateValidated = false;
  let workspaceId = '';

  if (cookieRaw && state) {
    try {
      const parsed = JSON.parse(cookieRaw) as {
        state?: string;
        workspaceId?: string;
        issuedAt?: number;
      };
      const fresh = typeof parsed.issuedAt === 'number' && Date.now() - parsed.issuedAt <= 15 * 60 * 1000;
      if (parsed.state && fresh && timingSafeEquals(parsed.state, state)) {
        stateValidated = true;
        workspaceId = parsed.workspaceId || '';
      }
    } catch {
      stateValidated = false;
    }
  }

  const status = oauthError
    ? 'error'
    : !code
      ? 'missing_code'
      : !stateValidated
        ? 'state_mismatch'
        : 'authorized';

  const message =
    status === 'authorized'
      ? `Authorization received for ${safeProvider}. Closing window...`
      : oauthErrorDescription || oauthError || `OAuth callback status: ${status}`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Antara OAuth Callback</title>
  </head>
  <body style="font-family:system-ui,-apple-system,sans-serif;padding:32px;color:#0f172a;background:#f8fafc;">
    <h1 style="font-size:16px;margin:0 0 8px;">Antara Engine — ${escapeJsString(safeProvider.toUpperCase())} Authorization</h1>
    <p style="font-size:13px;color:#475569;margin:0;">${escapeJsString(message)}</p>
    <script>
      (function () {
        var payload = {
          type: 'OAUTH_AUTH_SUCCESS',
          provider: '${escapeJsString(safeProvider)}',
          workspaceId: '${escapeJsString(workspaceId)}',
          status: '${escapeJsString(status)}',
          stateValidated: ${stateValidated ? 'true' : 'false'},
          codePresent: ${code ? 'true' : 'false'},
          error: '${escapeJsString(oauthError || '')}'
        };
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, '*');
          setTimeout(function () { window.close(); }, 350);
        }
      })();
    </script>
  </body>
</html>`;

  const response = new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
  response.cookies.delete(`antara_social_oauth_${safeProvider}`);
  return response;
}
