import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import type { ApiErrorResponse, ApiSuccessResponse } from '@/types/domain';
import {
  classifyOperationalError,
  logStructuredEvent,
  redactSensitiveString,
} from './observability';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, string[] | undefined>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, string[] | undefined>,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function jsonOk<T>(data: T, status = 200): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

export function jsonError(
  err: unknown,
  context?: { operation?: string; workspaceId?: string; userId?: string; provider?: string },
): NextResponse<ApiErrorResponse> {
  const classification = classifyOperationalError(err);

  if (err instanceof AppError) {
    if (err.statusCode >= 500 || err.statusCode === 429) {
      logStructuredEvent({
        operation: context?.operation || 'api_request',
        workspaceId: context?.workspaceId,
        userId: context?.userId,
        provider: context?.provider,
        status: err.statusCode >= 500 ? 'error' : 'warning',
        errorClassification: classification,
        metadata: { code: err.code, statusCode: err.statusCode, message: err.message },
      });
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: err.code,
          message: redactSensitiveString(err.message),
          ...(err.details ? { details: err.details } : {}),
        },
      },
      { status: err.statusCode },
    );
  }

  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: err.issues[0]?.message || 'Request validation failed.',
          details: err.flatten().fieldErrors,
        },
      },
      { status: 400 },
    );
  }

  const rawMessage = err instanceof Error ? err.message : String(err);
  logStructuredEvent({
    operation: context?.operation || 'api_request',
    workspaceId: context?.workspaceId,
    userId: context?.userId,
    provider: context?.provider,
    status: 'error',
    errorClassification: classification,
    metadata: { message: redactSensitiveString(rawMessage) },
  });

  const safeMessage =
    process.env.NODE_ENV === 'production'
      ? 'An internal server error occurred. Please try again or inspect System Health.'
      : redactSensitiveString(rawMessage);

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: safeMessage,
      },
    },
    { status: 500 },
  );
}

export const okResponse = jsonOk;
export const handleRouteError = jsonError;
