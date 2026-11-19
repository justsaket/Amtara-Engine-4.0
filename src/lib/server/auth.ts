import crypto from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { resolveAutonomousConfiguration } from '@/lib/config/manager';
import { AppError } from './error-handler';
import { getFirebaseAdmin } from './firebase-admin';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  displayName: string;
  photoUrl?: string;
  authProvider: 'password' | 'google.com' | 'unknown';
  idToken?: string;
}

interface SignedSessionClaims {
  uid: string;
  email: string;
  displayName: string;
  authProvider: AuthenticatedUser['authProvider'];
  iat: number;
  exp: number;
}

function mapProvider(raw?: string): AuthenticatedUser['authProvider'] {
  if (raw === 'password') return 'password';
  if (raw === 'google.com') return 'google.com';
  return 'unknown';
}

export function signSessionToken(
  claims: Omit<SignedSessionClaims, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds = 60 * 60 * 24 * 5,
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullClaims: SignedSessionClaims = {
    ...claims,
    iat: now,
    exp: now + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(fullClaims), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySignedSessionToken(
  token: string,
  secret: string,
): SignedSessionClaims | null {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as SignedSessionClaims;
    if (!decoded.uid || !decoded.email || typeof decoded.exp !== 'number') {
      return null;
    }
    if (decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export async function verifyFirebaseIdTokenString(
  idToken: string,
): Promise<AuthenticatedUser> {
  const { auth } = getFirebaseAdmin();
  if (!auth) {
    throw new AppError(
      503,
      'AUTH_UNAVAILABLE',
      'Firebase Authentication verification is unavailable because Firebase project credentials are not configured.',
    );
  }

  try {
    const decoded = await auth.verifyIdToken(idToken);
    if (!decoded.email) {
      throw new AppError(403, 'EMAIL_REQUIRED', 'Authenticated account must include an email address.');
    }
    const rawName =
      (typeof decoded.name === 'string' && decoded.name.trim()) ||
      decoded.email.split('@')[0] ||
      'Antara Member';
    const displayName = rawName.slice(0, 100);
    const photoUrl =
      typeof decoded.picture === 'string' && decoded.picture.length <= 1024
        ? decoded.picture
        : undefined;

    return {
      uid: decoded.uid,
      email: decoded.email.toLowerCase(),
      displayName,
      photoUrl,
      authProvider: mapProvider(decoded.firebase?.sign_in_provider),
      idToken,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      401,
      'UNAUTHORIZED',
      'Invalid or expired authentication credentials. Please sign in again.',
    );
  }
}

export async function authenticateRequest(req: NextRequest): Promise<AuthenticatedUser> {
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      return verifyFirebaseIdTokenString(token);
    }
  }

  const { sessionCookieName, sessionSecret } = resolveAutonomousConfiguration();
  const cookieVal = req.cookies.get(sessionCookieName)?.value;
  if (cookieVal && sessionSecret) {
    const verified = verifySignedSessionToken(cookieVal, sessionSecret);
    if (verified) {
      return {
        uid: verified.uid,
        email: verified.email,
        displayName: verified.displayName,
        authProvider: verified.authProvider,
      };
    }
  }

  throw new AppError(
    401,
    'UNAUTHORIZED',
    'Authentication required. Sign in to Antara Engine to access this workspace endpoint.',
  );
}

function isHttpsRequest(req?: NextRequest): boolean {
  if (!req) return false;
  const forwardedProto = req.headers.get('x-forwarded-proto') || '';
  if (forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https') {
    return true;
  }
  return req.nextUrl.protocol === 'https:';
}

export function attachSessionCookie(
  res: NextResponse,
  user: AuthenticatedUser,
  req?: NextRequest,
): void {
  const { sessionCookieName, sessionSecret, snapshot } = resolveAutonomousConfiguration();
  if (!sessionSecret) return;

  const token = signSessionToken(
    {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      authProvider: user.authProvider,
    },
    sessionSecret,
  );

  const useSecureIframeCookie =
    isHttpsRequest(req) || snapshot.environment.nodeEnv === 'production';

  res.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    secure: useSecureIframeCookie,
    sameSite: useSecureIframeCookie ? 'none' : 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 5,
  });
}

export function clearSessionCookie(res: NextResponse, req?: NextRequest): void {
  const { sessionCookieName, snapshot } = resolveAutonomousConfiguration();
  const useSecureIframeCookie =
    isHttpsRequest(req) || snapshot.environment.nodeEnv === 'production';
  res.cookies.set(sessionCookieName, '', {
    httpOnly: true,
    secure: useSecureIframeCookie,
    sameSite: useSecureIframeCookie ? 'none' : 'lax',
    path: '/',
    maxAge: 0,
  });
}

export const requireAuthenticatedUser = authenticateRequest;

