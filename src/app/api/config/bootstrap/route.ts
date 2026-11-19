import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { requireWorkspaceAccess, recordAuditLog } from '@/lib/server/repositories';
import {
  ensureInternalSecrets,
  rotateInternalEncryptionKey,
} from '@/lib/server/secret-manager';

export const dynamic = 'force-dynamic';

const bootstrapSchema = z.object({
  action: z.enum(['initialize', 'rotate_encryption_key']).default('initialize'),
  workspaceId: z.string().trim().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const authUser = await authenticateRequest(req);
    const body = bootstrapSchema.parse(await req.json().catch(() => ({})));

    if (body.workspaceId) {
      const { store } = await requireWorkspaceAccess(
        authUser.uid,
        body.workspaceId,
        'security:manage',
        { idToken: authUser.idToken },
      );

      const result =
        body.action === 'rotate_encryption_key'
          ? rotateInternalEncryptionKey()
          : ensureInternalSecrets({ autoPersistLocal: true });

      await recordAuditLog(
        store,
        body.workspaceId,
        authUser.uid,
        authUser.email,
        body.action === 'rotate_encryption_key'
          ? 'security.encryption_key_rotated'
          : 'security.internal_secrets_verified',
        'security',
        result.encryptionKeyVersion,
        body.action === 'rotate_encryption_key'
          ? `Rotated AES-256-GCM encryption key version to ${result.encryptionKeyVersion}.`
          : 'Verified and ensured internal secret vault initialization.',
      );

      const { snapshot } = resolveAutonomousConfiguration();
      return jsonOk({ result, snapshot });
    }

    const result =
      body.action === 'rotate_encryption_key'
        ? rotateInternalEncryptionKey()
        : ensureInternalSecrets({ autoPersistLocal: true });
    const { snapshot } = resolveAutonomousConfiguration();
    return jsonOk({ result, snapshot });
  } catch (err) {
    return jsonError(err);
  }
}
