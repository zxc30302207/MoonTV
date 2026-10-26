import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from './auth';
import { generateSignature, safeEqual } from './auth-crypto';

export type AuthCookieData = {
  role?: 'owner' | 'admin' | 'user';
  username?: string;
  signature?: string;
  sessionVersion?: string;
  timestamp?: number;
  mode?: 'localstorage';
};

const AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function getAuthSignaturePayload(authInfo: {
  mode?: 'localstorage';
  role?: 'owner' | 'admin' | 'user';
  timestamp?: number;
  sessionVersion?: string;
  username?: string;
}): string {
  const role = authInfo.role || 'user';
  if (authInfo.mode === 'localstorage') {
    return `localstorage:${role}:${authInfo.timestamp}`;
  }
  const base = `user:${authInfo.username}:${role}:${authInfo.timestamp}`;
  return authInfo.sessionVersion
    ? `${base}:session:${authInfo.sessionVersion}`
    : base;
}

export async function getVerifiedAuthCookie(
  request: NextRequest
): Promise<AuthCookieData | null> {
  const authInfo = getAuthInfoFromCookie(request) as AuthCookieData | null;
  if (!authInfo) return null;

  const secret = process.env.PASSWORD || '';
  if (!secret) return null;

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const timestamp =
    typeof authInfo.timestamp === 'number'
      ? authInfo.timestamp
      : Number(authInfo.timestamp);
  const role = authInfo.role;

  if (
    !Number.isFinite(timestamp) ||
    !isAuthRole(role) ||
    Date.now() - timestamp > AUTH_COOKIE_MAX_AGE_MS ||
    timestamp > Date.now() + 60_000
  ) {
    return null;
  }

  if (storageType === 'localstorage') {
    if (authInfo.mode !== 'localstorage') {
      return null;
    }
    const expected = await generateSignature(
      getAuthSignaturePayload({ mode: 'localstorage', role, timestamp }),
      secret
    );
    return isSignatureMatch(authInfo.signature, expected) ? authInfo : null;
  }

  if (!authInfo.username) return null;
  if (
    authInfo.sessionVersion !== undefined &&
    (typeof authInfo.sessionVersion !== 'string' ||
      !/^[a-f0-9]{64}$/.test(authInfo.sessionVersion))
  )
    return null;

  const expected = await generateSignature(
    getAuthSignaturePayload({
      role,
      timestamp,
      username: authInfo.username,
      sessionVersion: authInfo.sessionVersion,
    }),
    secret
  );

  return isSignatureMatch(authInfo.signature, expected) ? authInfo : null;
}

function isSignatureMatch(
  actual: string | undefined,
  expected: string
): boolean {
  if (!actual) return false;
  return safeEqual(actual, expected);
}

function isAuthRole(value: unknown): value is 'owner' | 'admin' | 'user' {
  return value === 'owner' || value === 'admin' || value === 'user';
}
