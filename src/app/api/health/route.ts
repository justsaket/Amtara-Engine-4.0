import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { getFirebaseAdmin } from '@/lib/server/firebase-admin';
import { jsonOk } from '@/lib/server/error-handler';

export const dynamic = 'force-dynamic';

/**
 * Public sanitized health endpoint.
 * Intentionally excludes internal project IDs, database names, secret sources,
 * file paths, and provider credentials. Full diagnostics live behind the
 * authenticated `/api/workspaces/[workspaceId]/system-health` endpoint.
 */
export async function GET() {
  const { snapshot } = resolveAutonomousConfiguration();
  const admin = getFirebaseAdmin();

  return jsonOk({
    status: 'ok',
    service: 'Antara Engine 4.0',
    phase: 'phase_5_production_release',
    timestamp: new Date().toISOString(),
    readiness: {
      authReady: snapshot.capabilities.authReady,
      databaseReady: snapshot.capabilities.databaseReady,
      encryptedVaultReady: snapshot.capabilities.encryptedVaultReady,
      aiConfigured: snapshot.capabilities.aiConfigured,
      googleOAuthConfigured: snapshot.capabilities.googleOAuthConfigured,
      adminRuntimeInitialized: Boolean(admin.app && admin.auth),
    },
  });
}
