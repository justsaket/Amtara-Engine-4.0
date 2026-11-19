import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { resolveRequestOrigin } from '@/lib/server/platform-oauth';
import { triggerImmediatePolicyScanAndRun } from '@/lib/server/autopilot-repositories';
import { idSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; policyId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId, policyId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const validPolicyId = idSchema.parse(policyId);

    const origin = resolveRequestOrigin(req);
    const body = (await req.json().catch(() => ({}))) as { registerWatch?: boolean };
    const registerWatchWebhookUrl =
      body.registerWatch && origin.startsWith('https://')
        ? `${origin}/api/webhooks/google-drive`
        : undefined;

    const summary = await triggerImmediatePolicyScanAndRun(
      authUser.uid,
      validWorkspaceId,
      validPolicyId,
      {
        registerWatchWebhookUrl,
        ctx: { idToken: authUser.idToken, origin },
      },
    );

    return jsonOk({ summary });
  } catch (err) {
    return jsonError(err);
  }
}
