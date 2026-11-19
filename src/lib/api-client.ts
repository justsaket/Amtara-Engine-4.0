'use client';

import { auth } from '@/lib/firebase/client';
import type { ApiResponse } from '@/types/domain';

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  if (auth?.currentUser && !headers.has('Authorization')) {
    const token = await auth.currentUser.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });

  const payload = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!res.ok || !payload || !payload.ok) {
    const code = payload && !payload.ok ? payload.error.code : 'REQUEST_FAILED';
    const message =
      (payload && !payload.ok && payload.error.message) ||
      `Request failed with status ${res.status}.`;
    throw new ApiClientError(res.status, code, message);
  }

  return payload.data;
}
