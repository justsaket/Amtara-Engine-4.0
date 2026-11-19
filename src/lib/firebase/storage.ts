'use client';

import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './client';

export async function uploadBrandLogoFile(
  workspaceId: string,
  brandId: string,
  file: File,
): Promise<string> {
  if (!storage) {
    throw new Error('Firebase Storage is not initialized in this environment.');
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  const objectPath = `workspaces/${workspaceId}/brands/${brandId}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, objectPath);
  await uploadBytes(storageRef, file, {
    contentType: file.type || 'image/png',
  });
  return getDownloadURL(storageRef);
}
