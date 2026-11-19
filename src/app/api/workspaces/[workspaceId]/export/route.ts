import { NextRequest } from 'next/server';
import { idSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { handleRouteError, okResponse } from '@/lib/server/error-handler';
import { enforceRateLimit } from '@/lib/server/rate-limit';
import {
  recordAuditLog,
  requireWorkspaceAccess,
} from '@/lib/server/repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Exports sanitized workspace-owned records for data portability / governance.
 * Explicitly NEVER exports `encryptedCredentials`, raw OAuth tokens, or master keys.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);

    enforceRateLimit({
      key: `export:${workspaceId}:${user.uid}`,
      maxRequests: 5,
      windowMs: 60_000,
    });

    const ctx = { idToken: user.idToken };
    const { store, workspace } = await requireWorkspaceAccess(
      user.uid,
      workspaceId,
      'security:manage',
      ctx,
    );

    const [
      brands,
      brandKnowledgeFacts,
      brandMemory,
      contentItems,
      creativeBriefs,
      scheduledPosts,
      leads,
      reviews,
      campaigns,
      analyticsSnapshots,
      experiments,
      socialAccountsRaw,
      googleConnectionsRaw,
    ] = await Promise.all([
      store.listWorkspaceSubcollection(workspaceId, 'brands').catch(() => []),
      store.listWorkspaceSubcollection(workspaceId, 'brandKnowledgeFacts').catch(() => []),
      store.listWorkspaceSubcollection(workspaceId, 'brandMemory').catch(() => []),
      store.listWorkspaceSubcollection(workspaceId, 'contentItems').catch(() => []),
      store.listWorkspaceSubcollection(workspaceId, 'creativeBriefs').catch(() => []),
      store.listWorkspaceSubcollection(workspaceId, 'scheduledPosts').catch(() => []),
      store.listWorkspaceSubcollection(workspaceId, 'leads').catch(() => []),
      store.listWorkspaceSubcollection(workspaceId, 'reviews').catch(() => []),
      store.listWorkspaceSubcollection(workspaceId, 'adCampaigns').catch(() => []),
      store.listWorkspaceSubcollection(workspaceId, 'analyticsSnapshots').catch(() => []),
      store.listWorkspaceSubcollection(workspaceId, 'experiments').catch(() => []),
      store.listWorkspaceSubcollection(workspaceId, 'socialAccounts').catch(() => []),
      store.listWorkspaceSubcollection(workspaceId, 'googleConnections').catch(() => []),
    ]);

    // Strip any credential references from exported metadata
    const sanitizedSocialAccounts = socialAccountsRaw.map((acc) => ({
      id: acc.id,
      provider: acc.provider,
      displayName: acc.displayName,
      handle: acc.handle,
      status: acc.status,
      grantedScopes: acc.grantedScopes,
      connectedAt: acc.connectedAt,
    }));
    const sanitizedGoogleConnections = googleConnectionsRaw.map((conn) => ({
      id: conn.id,
      googleEmail: conn.googleEmail,
      status: conn.status,
      grantedScopes: conn.grantedScopes,
      connectedAt: conn.connectedAt,
    }));

    await recordAuditLog(
      store,
      workspaceId,
      user.uid,
      user.email,
      'workspace.data_exported',
      'workspace',
      workspaceId,
      'Exported sanitized workspace governance package (credentials and OAuth tokens excluded).',
    );

    return okResponse({
      exportVersion: '5.0.0',
      exportedAt: new Date().toISOString(),
      exportedBy: { uid: user.uid, email: user.email },
      securityNotice:
        'Encrypted OAuth credentials, access tokens, refresh tokens, and encryption keys are strictly excluded from data exports.',
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        timezone: workspace.timezone,
        createdAt: workspace.createdAt,
      },
      counts: {
        brands: brands.length,
        brandKnowledgeFacts: brandKnowledgeFacts.length,
        brandMemory: brandMemory.length,
        contentItems: contentItems.length,
        creativeBriefs: creativeBriefs.length,
        scheduledPosts: scheduledPosts.length,
        leads: leads.length,
        reviews: reviews.length,
        campaigns: campaigns.length,
        analyticsSnapshots: analyticsSnapshots.length,
        experiments: experiments.length,
      },
      data: {
        brands,
        brandKnowledgeFacts,
        brandMemory,
        contentItems,
        creativeBriefs,
        scheduledPosts,
        leads,
        reviews,
        campaigns,
        analyticsSnapshots,
        experiments,
        socialAccounts: sanitizedSocialAccounts,
        googleConnections: sanitizedGoogleConnections,
      },
    });
  } catch (error) {
    return handleRouteError(error, { operation: 'workspace.export' });
  }
}
