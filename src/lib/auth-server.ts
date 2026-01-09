import { NextRequest } from 'next/server';

import { generateSignature, safeEqual } from './auth-crypto';
import { getAuthInfoFromCookie } from './auth';

export type AuthCookieData = {
  role?: 'owner' | 'admin' | 'user';
  username?: string;
  signature?: string;
  timestamp?: number;
  mode?: 'localstorage';
};

function isSignatureMatch(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  return safeEqual(actual, expected);
}

export async function getVerifiedAuthInfo(
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
  const hasValidTimestamp = Number.isFinite(timestamp);

  if (storageType === 'localstorage') {
    if (authInfo.mode !== 'localstorage' || !hasValidTimestamp) {
      return null;
    }
    const expected = await generateSignature(
      `localstorage:${timestamp}`,
      secret
    );
    return isSignatureMatch(authInfo.signature, expected) ? authInfo : null;
  }

  if (!authInfo.username) return null;

  if (hasValidTimestamp) {
    const expectedWithTimestamp = await generateSignature(
      `${authInfo.username}:${timestamp}`,
      secret
    );
    if (isSignatureMatch(authInfo.signature, expectedWithTimestamp)) {
      return authInfo;
    }
  }

  const expectedLegacy = await generateSignature(authInfo.username, secret);
  return isSignatureMatch(authInfo.signature, expectedLegacy) ? authInfo : null;
}
