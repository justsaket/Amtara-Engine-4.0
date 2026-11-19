import { NextRequest } from 'next/server';
import { listBrandCategories } from '@/lib/intelligence/brand-knowledge';
import { MEMORY_NAMESPACE_CATALOG } from '@/lib/intelligence/memory-engine';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  createBrandKnowledgeFact,
  createMemoryItem,
  ensureBrandBaselineFacts,
  getBrandInsideWorkspace,
  listMemoryItems,
  listWorkspaceBrandFacts,
} from '@/lib/server/phase3-repositories';
import { getStore, requireWorkspaceAccess } from '@/lib/server/repositories';
import { brandFactCreateSchema, memoryItemCreateSchema } from '@/lib/validation';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const { store } = await requireWorkspaceAccess(user.uid, workspaceId, 'memory:read', {
      idToken: user.idToken,
    });

    const brandId = req.nextUrl.searchParams.get('brandId') || undefined;
    if (brandId) {
      const brand = await getBrandInsideWorkspace(store, workspaceId, brandId);
      if (brand) {
        await ensureBrandBaselineFacts(store, workspaceId, brand, user.uid);
      }
    }

    const [facts, memoryItems] = await Promise.all([
      listWorkspaceBrandFacts(workspaceId, brandId, { idToken: user.idToken, store }),
      listMemoryItems(workspaceId, { brandId }, { idToken: user.idToken, store }),
    ]);

    return jsonOk({
      categories: listBrandCategories(),
      namespaces: MEMORY_NAMESPACE_CATALOG,
      facts,
      memoryItems,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const user = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const body = (await req.json()) as Record<string, unknown>;

    if (body.kind === 'brand_fact') {
      const input = brandFactCreateSchema.parse(body);
      const fact = await createBrandKnowledgeFact(
        user.uid,
        workspaceId,
        user.email,
        {
          ...input,
          autoApprove: input.verificationStatus === 'VERIFIED',
        },
        { idToken: user.idToken },
      );
      return jsonOk({ fact }, 201);
    }

    const { store } = await requireWorkspaceAccess(user.uid, workspaceId, 'memory:propose', {
      idToken: user.idToken,
    });
    const input = memoryItemCreateSchema.parse(body);
    const item = await createMemoryItem(store, workspaceId, user.uid, {
      brandId: input.brandId,
      namespace: input.namespace,
      title: input.title,
      content: input.content,
      tags: input.tags,
      status: 'candidate',
      verificationStatus: input.verificationStatus,
      confidence: 0.7,
      provenanceRef: input.provenanceRef,
    });

    return jsonOk({ memoryItem: item }, 201);
  } catch (err) {
    return jsonError(err);
  }
}
