import type { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/server/auth';
import { jsonError, jsonOk } from '@/lib/server/error-handler';
import { deleteBrand, updateBrand } from '@/lib/server/repositories';
import { brandUpdateSchema, idSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; brandId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId, brandId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const validBrandId = idSchema.parse(brandId);
    const body = brandUpdateSchema.parse(await req.json());
    const brand = await updateBrand(
      authUser.uid,
      authUser.email,
      validWorkspaceId,
      validBrandId,
      body,
      { idToken: authUser.idToken },
    );
    return jsonOk({ brand });
  } catch (err) {
    return jsonError(err);
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ workspaceId: string; brandId: string }> },
) {
  try {
    const authUser = await authenticateRequest(req);
    const { workspaceId, brandId } = await context.params;
    const validWorkspaceId = idSchema.parse(workspaceId);
    const validBrandId = idSchema.parse(brandId);
    await deleteBrand(
      authUser.uid,
      authUser.email,
      validWorkspaceId,
      validBrandId,
      { idToken: authUser.idToken },
    );
    return jsonOk({ deleted: true, brandId: validBrandId });
  } catch (err) {
    return jsonError(err);
  }
}
