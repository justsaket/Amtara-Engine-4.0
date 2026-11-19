import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import {
  createBrand,
  listBrands,
  seedStarterBrandsForWorkspace,
} from '@/lib/server/repositories';
import { brandCreateSchema, idSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const seedStarterSchema = z.object({
  action: z.literal('seed_starter_brands'),
  keys: z
    .array(z.enum(['saket_personal', 'magnarc', 'greenweld', 'sapphire']))
    .optional(),
});

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const brands = await listBrands(authUser.uid, validWorkspaceId, {
      idToken: authUser.idToken,
    });
    return jsonOk({ brands });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const raw = (await req.json()) as Record<string, unknown>;

    if (raw && raw.action === 'seed_starter_brands') {
      const parsedSeed = seedStarterSchema.parse(raw);
      const brands = await seedStarterBrandsForWorkspace(
        authUser.uid,
        authUser.email,
        validWorkspaceId,
        parsedSeed.keys,
        { idToken: authUser.idToken },
      );
      return jsonOk({ brands }, 201);
    }

    const body = brandCreateSchema.parse(raw);
    const brand = await createBrand(
      authUser.uid,
      authUser.email,
      validWorkspaceId,
      body,
      { idToken: authUser.idToken },
    );
    return jsonOk({ brand }, 201);
  } catch (err) {
    return jsonError(err);
  }
}
