import { NextRequest } from 'next/server';
import { z } from 'zod';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import {
  getPhase4MarketingAppsScriptTemplate,
  PHASE_4_MARKETING_APPS_SCRIPT_TEMPLATES,
} from '@/lib/google/marketing-templates';
import { DEFAULT_WORKSPACE_TIMEZONE, idSchema } from '@/lib/validation';
import { requireAuthenticatedUser } from '@/lib/server/auth';
import { AppError, handleRouteError, okResponse } from '@/lib/server/error-handler';
import {
  createOrImportWorkspaceAppsScriptProject,
  listWorkspaceAppsScriptProjects,
  listWorkspaceGoogleConnections,
} from '@/lib/server/phase2-repositories';
import { requireWorkspaceAccess } from '@/lib/server/repositories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const deployMarketingTemplateSchema = z.object({
  templateKey: z.string().trim().min(3).max(80),
  title: z.string().trim().min(3).max(160).optional(),
  timezone: z.string().trim().min(2).max(64).default(DEFAULT_WORKSPACE_TIMEZONE),
  connectionId: idSchema.optional(),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const ctx = { idToken: user.idToken };
    await requireWorkspaceAccess(user.uid, workspaceId, 'marketing:read', ctx);

    const [projects, googleConnResult] = await Promise.all([
      listWorkspaceAppsScriptProjects(user.uid, workspaceId, ctx).catch(() => []),
      listWorkspaceGoogleConnections(user.uid, workspaceId, ctx).catch(() => ({
        connections: [],
        activeConnection: null,
        capabilities: [],
        platformOAuthConfigured: false,
      })),
    ]);
    const googleConnections = googleConnResult.connections;

    const cfg = resolveAutonomousConfiguration();
    const marketingTemplateKeys = new Set(
      PHASE_4_MARKETING_APPS_SCRIPT_TEMPLATES.map((t) => t.key),
    );
    const linkedMarketingProjects = projects.filter(
      (p) => p.templateKey && marketingTemplateKeys.has(p.templateKey),
    );

    const templates = PHASE_4_MARKETING_APPS_SCRIPT_TEMPLATES.map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      marketingCategory: t.marketingCategory,
      recommendedDeploymentType: t.recommendedDeploymentType,
      defaultScopes: t.defaultScopes,
      filePreview: t.buildFiles(DEFAULT_WORKSPACE_TIMEZONE).map((f) => ({
        name: f.name,
        type: f.type,
        lineCount: f.source.split('\n').length,
      })),
    }));

    return okResponse({
      templates,
      linkedMarketingProjects,
      allAppsScriptProjectsCount: projects.length,
      googleReadiness: {
        oauthConfigured: cfg.snapshot.capabilities.googleOAuthConfigured,
        activeConnectionsCount: googleConnections.filter((c) => c.status === 'connected').length,
        connections: googleConnections.map((c) => ({
          id: c.id,
          googleEmail: c.googleEmail,
          status: c.status,
          scopesCount: c.grantedScopes.length,
        })),
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { workspaceId } = await context.params;
    idSchema.parse(workspaceId);
    const body = deployMarketingTemplateSchema.parse(await request.json());

    const template = getPhase4MarketingAppsScriptTemplate(body.templateKey);
    if (!template) {
      throw new AppError(
        400,
        'UNKNOWN_MARKETING_TEMPLATE',
        `Unknown Phase 4 marketing Apps Script template: ${body.templateKey}`,
      );
    }

    const result = await createOrImportWorkspaceAppsScriptProject(
      user.uid,
      user.email,
      workspaceId,
      {
        mode: 'create',
        title: body.title || `Antara — ${template.name}`,
        templateKey: template.key,
        timezone: body.timezone,
        connectionId: body.connectionId,
      },
      { idToken: user.idToken },
    );

    return okResponse({ deployed: true, templateKey: template.key, ...result }, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
