export type AuthInfo = {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
  mode?: 'localstorage';
};

const USER_CACHE_PREFIX = 'moontv_cache_';

const AUTH_CACHE_KEY = 'moontv_auth_cache';
let cachedAuthInfo: AuthInfo | null = null;
let inflight: Promise<AuthInfo | null> | null = null;
let authGeneration = 0;

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

  const generation = authGeneration;
  inflight = (async () => {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      if (generation !== authGeneration) return null;
      if (!response.ok) {
        cachedAuthInfo = null;
        writeCachedAuthInfo(null);
        return null;
      }
      const data = (await response.json()) as { user?: AuthInfo | null };
      if (generation !== authGeneration) return null;
      cachedAuthInfo = data?.user || null;
      writeCachedAuthInfo(cachedAuthInfo);
      return cachedAuthInfo;
    } catch {
      return generation === authGeneration ? readCachedAuthInfo() : null;
    } finally {
      if (generation === authGeneration) inflight = null;
    }
  })();

  return inflight;
}

export function clearAuthInfoCache(): void {
  authGeneration += 1;
  inflight = null;
  cachedAuthInfo = null;
  writeCachedAuthInfo(null);
}

export async function clearPrivateClientState(): Promise<void> {
  clearAuthInfoCache();
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new Event('moontv:logout'));

  try {
    Object.keys(localStorage).forEach((key) => {
      if (
        key.startsWith(USER_CACHE_PREFIX) ||
        key.startsWith('danmakuSource:') ||
        key === 'downloadTasks' ||
        key === 'downloadTaskStates'
      ) {
        localStorage.removeItem(key);
      }
    });
    sessionStorage.removeItem(AUTH_CACHE_KEY);
    sessionStorage.removeItem('userOnlineUpdatedAt');
  } catch {
    // Storage may be unavailable in private browsing modes.
  }

  try {
    const { getVideoPrefetcher, getNextEpisodePrefetcher } = await import(
      './video-prefetcher'
    );
    getVideoPrefetcher().stop();
    getNextEpisodePrefetcher().stop();
    const { clearVideoCache } = await import('./video-cache');
    await clearVideoCache();
    if (typeof caches !== 'undefined')
      await caches.delete('moontv-download-segments');
  } catch {
    // 不支援離線快取的瀏覽器仍應正常登出。
  }
}
