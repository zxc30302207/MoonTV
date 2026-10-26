import { NextRequest } from 'next/server';

import {
  type AuthCookieData,
  getAuthSignaturePayload,
  getVerifiedAuthCookie,
} from './auth-cookie';
import { safeEqual } from './auth-crypto';
import { getConfig } from './config';
import { getStorage } from './db';

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
  if (!(await isActiveUser(authInfo.username, authInfo.role))) return null;
  return (await isUserSessionCurrent(
    authInfo.username,
    Number(authInfo.timestamp),
    authInfo.sessionVersion
  ))
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

// Environment-owned sessions are signed by the current PASSWORD. Database
// accounts carry a credential generation, so password changes and username
// reuse revoke old tokens even in the same millisecond. Legacy strings retain
// their existing timestamp contract until a password change upgrades them.
export async function isUserSessionCurrent(
  username: string,
  timestamp: number,
  sessionVersion?: string
): Promise<boolean> {
  if (!Number.isFinite(timestamp)) return false;
  if (username === process.env.USERNAME) return true;
  const storage = getStorage();
  if (!storage) return false;
  const state = await storage.getUserSessionState(username);
  if (!state.exists) return false;
  if (state.sessionVersion) {
    return (
      typeof sessionVersion === 'string' &&
      safeEqual(sessionVersion, state.sessionVersion)
    );
  }
  return (
    sessionVersion === undefined &&
    Number.isFinite(state.notBefore) &&
    timestamp > state.notBefore
  );
}
