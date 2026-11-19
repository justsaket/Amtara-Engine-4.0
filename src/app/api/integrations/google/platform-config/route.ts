import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { AppError, jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  clearPlatformGoogleOAuthConfig,
  getPlatformGoogleOAuthPublicStatus,
  resolveRequestOrigin,
  savePlatformGoogleOAuthConfig,
} from '@/lib/server/platform-oauth';
import { requireWorkspaceAccess } from '@/lib/server/repositories';
import { platformGoogleOAuthSetupSchema } from '@/lib/validation';

export async function GET(req: NextRequest) {
  try {
    await authenticateRequest(req);
    const origin = resolveRequestOrigin(req);
    const status = await getPlatformGoogleOAuthPublicStatus({ origin });
    return jsonOk(status);
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await authenticateRequest(req);
    const body = await req.json();
    const parsed = platformGoogleOAuthSetupSchema.parse(body);

    if (parsed.workspaceId) {
      await requireWorkspaceAccess(
        user.uid,
        parsed.workspaceId,
        'integrations:configure',
        { idToken: user.idToken },
      );
    }

    const origin = resolveRequestOrigin(req);
    const saved = await savePlatformGoogleOAuthConfig({
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
      redirectUri: parsed.redirectUri,
      actorUid: user.uid,
    });

    const refreshed = await getPlatformGoogleOAuthPublicStatus({ origin });
    return jsonOk({
      ...saved,
      redirectUri: refreshed.redirectUri,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await authenticateRequest(req);
    const workspaceId = req.nextUrl.searchParams.get('workspaceId') || '';
    if (!workspaceId) {
      throw new AppError(400, 'WORKSPACE_REQUIRED', 'workspaceId query parameter is required.');
    }
    await requireWorkspaceAccess(user.uid, workspaceId, 'integrations:configure', {
      idToken: user.idToken,
    });
    await clearPlatformGoogleOAuthConfig();
    const origin = resolveRequestOrigin(req);
    const status = await getPlatformGoogleOAuthPublicStatus({ origin });
    return jsonOk(status);
  } catch (err) {
    return jsonError(err);
  }
}
