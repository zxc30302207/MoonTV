import { NextRequest } from 'next/server';

import {
  type AuthCookieData,
  getAuthSignaturePayload,
  getVerifiedAuthCookie,
} from './auth-cookie';
import { getConfig } from './config';

export type { AuthCookieData };
export { getAuthSignaturePayload };

export async function getVerifiedAuthInfo(
  request: NextRequest
): Promise<AuthCookieData | null> {
  const authInfo = await getVerifiedAuthCookie(request);
  if (!authInfo) return null;

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return authInfo;
  }

  if (!authInfo.username || !authInfo.role) return null;
  return (await isActiveUser(authInfo.username, authInfo.role))
    ? authInfo
    : null;
}

async function isActiveUser(
  username: string,
  role: 'owner' | 'admin' | 'user'
): Promise<boolean> {
  if (username === process.env.USERNAME) {
    return role === 'owner';
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return false;
  }

  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (entry) => entry.username === username
  );
  return Boolean(user && !user.banned && user.role === role);
}
