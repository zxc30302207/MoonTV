export type AuthInfo = {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
  mode?: 'localstorage';
};

const AUTH_CACHE_KEY = 'moontv_auth_cache';
let cachedAuthInfo: AuthInfo | null = null;
let inflight: Promise<AuthInfo | null> | null = null;

function readCachedAuthInfo(): AuthInfo | null {
  if (typeof window === 'undefined') return null;
  if (cachedAuthInfo) return cachedAuthInfo;
  try {
    const raw = sessionStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    cachedAuthInfo = JSON.parse(raw) as AuthInfo;
    return cachedAuthInfo;
  } catch {
    return null;
  }
}

function writeCachedAuthInfo(authInfo: AuthInfo | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (authInfo) {
      sessionStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(authInfo));
    } else {
      sessionStorage.removeItem(AUTH_CACHE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function getCachedAuthInfo(): AuthInfo | null {
  return readCachedAuthInfo();
}

export async function refreshAuthInfo(): Promise<AuthInfo | null> {
  if (typeof window === 'undefined') return null;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!response.ok) {
        cachedAuthInfo = null;
        writeCachedAuthInfo(null);
        return null;
      }
      const data = (await response.json()) as { user?: AuthInfo | null };
      cachedAuthInfo = data?.user || null;
      writeCachedAuthInfo(cachedAuthInfo);
      return cachedAuthInfo;
    } catch {
      return readCachedAuthInfo();
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function clearAuthInfoCache(): void {
  cachedAuthInfo = null;
  writeCachedAuthInfo(null);
}
