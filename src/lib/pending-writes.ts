/** Account-scoped protection for writes whose server acknowledgement is still pending.
 * This is not an offline replay queue: a failed intent is never sent automatically.
 */
type Intent = {
  revision: number;
  pending: boolean;
  method: string;
  key: string;
  value: unknown;
};
const stores = new Map<string, Record<string, Intent>>();
let revision = Date.now();
const paths = new Set([
  '/api/playrecords',
  '/api/favorites',
  '/api/searchhistory',
  '/api/followings',
]);
const storageKey = (username: string) =>
  `moontv_pending_writes_v1_${encodeURIComponent(username)}`;
function intents(username: string) {
  let value = stores.get(username);
  if (!value) {
    value = {};
    try {
      const parsed: unknown = JSON.parse(
        localStorage.getItem(storageKey(username)) || '{}'
      );
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [entry, raw] of Object.entries(parsed)) {
          if (!raw || typeof raw !== 'object') continue;
          const candidate = raw as Intent;
          const path = entry.slice(0, entry.indexOf(':'));
          if (
            !paths.has(path) ||
            typeof candidate.key !== 'string' ||
            entry !== `${path}:${candidate.key}` ||
            !['POST', 'DELETE'].includes(candidate.method) ||
            typeof candidate.pending !== 'boolean' ||
            !Number.isSafeInteger(candidate.revision) ||
            candidate.revision < 0
          )
            continue;
          value[entry] = candidate;
        }
      }
    } catch {
      /* Ignore malformed private cache, never turn it into a request. */
    }
    stores.set(username, value);
    for (const intent of Object.values(value))
      revision = Math.max(revision, intent.revision || 0);
  }
  return value;
}
function followsPendingClear(
  store: Record<string, Intent>,
  entry: string,
  intent: Intent
): boolean {
  const path = entry.slice(0, entry.indexOf(':'));
  const clear = store[`${path}:`];
  return Boolean(
    clear?.pending &&
      clear.method === 'DELETE' &&
      clear.revision < intent.revision
  );
}
function persist(username: string) {
  const store = intents(username);
  const pending = Object.fromEntries(
    Object.entries(store).filter(
      ([entry, value]) =>
        value.pending || followsPendingClear(store, entry, value)
    )
  );
  try {
    localStorage.setItem(storageKey(username), JSON.stringify(pending));
  } catch {
    /* In-memory protection remains available. */
  }
  window.dispatchEvent(
    new CustomEvent('databaseSyncStatus', {
      detail: {
        username,
        pending: Object.values(pending).filter((intent) => intent.pending)
          .length,
      },
    })
  );
}
function acknowledgeIntent(username: string, entry: string, intent: Intent) {
  const store = intents(username);
  const path = entry.slice(0, entry.indexOf(':'));
  let affectedClear = false;
  for (const [otherEntry, other] of Object.entries(store)) {
    if (
      otherEntry.startsWith(`${path}:`) &&
      other.revision > intent.revision &&
      (intent.key === '' || other.key === '')
    ) {
      other.pending = true;
      affectedClear = true;
    }
  }
  const current = store[entry];
  if (!current) {
    if (affectedClear) persist(username);
    return;
  }
  if (current !== intent) {
    // An older acknowledgement arriving after a newer one makes remote order uncertain.
    current.pending = true;
    persist(username);
    return;
  }
  intent.pending = false;
  persist(username);
}
export function pendingWriteCount(username: string): number {
  return Object.values(intents(username)).filter((value) => value.pending)
    .length;
}
export function currentWriteRevision(): number {
  return revision;
}
export function beginWrite(
  username: string,
  url: string,
  options?: RequestInit
): (() => void) | undefined {
  const parsed = new URL(url, window.location.origin);
  const path = parsed.pathname;
  const method = options?.method || 'GET';
  if (!paths.has(path) || !['POST', 'DELETE'].includes(method)) return;
  let body: Record<string, unknown> = {};
  if (typeof options?.body === 'string') {
    try {
      body = JSON.parse(options.body);
    } catch {
      return;
    }
  }
  const key = String(
    body.key ||
      body.keyword ||
      parsed.searchParams.get('key') ||
      parsed.searchParams.get('keyword') ||
      ''
  );
  const store = intents(username);
  if (method === 'DELETE' && key === '') {
    Object.keys(store)
      .filter((entry) => entry.startsWith(`${path}:`))
      .forEach((entry) => delete store[entry]);
  }
  const intent: Intent = {
    revision: ++revision,
    pending: true,
    method,
    key,
    value:
      body.record || body.favorite || body.following || body.keyword || null,
  };
  store[`${path}:${key}`] = intent;
  persist(username);
  return () => acknowledgeIntent(username, `${path}:${key}`, intent);
}
export function mergePendingWrites<T>(
  username: string,
  path: string,
  data: T,
  since: number
): T {
  const relevant = Object.entries(intents(username))
    .filter(
      ([key, value]) =>
        key.startsWith(`${path}:`) &&
        (value.pending ||
          value.revision > since ||
          followsPendingClear(intents(username), key, value))
    )
    .map(([, value]) => value)
    .sort((a, b) => a.revision - b.revision);
  if (!relevant.length) return data;
  if (relevant.some((intent) => intent.pending))
    window.dispatchEvent(
      new CustomEvent('globalError', {
        detail: {
          message: '部分變更尚未確認同步，已保留在此裝置。請重試原操作。',
        },
      })
    );
  if (path === '/api/searchhistory') {
    let merged = [...(data as string[])];
    for (const intent of relevant) {
      if (intent.method === 'POST')
        merged = [
          intent.key,
          ...merged.filter((value) => value !== intent.key),
        ].slice(0, 20);
      else
        merged =
          intent.key === ''
            ? []
            : merged.filter((value) => value !== intent.key);
    }
    return merged as T;
  }
  const merged = { ...(data as Record<string, unknown>) };
  for (const intent of relevant) {
    if (intent.method === 'POST') merged[intent.key] = intent.value;
    else if (intent.key === '')
      Object.keys(merged).forEach((key) => delete merged[key]);
    else delete merged[intent.key];
  }
  return merged as T;
}

export function pendingWriteRequests(username: string) {
  return Object.entries(intents(username))
    .filter(([, intent]) => intent.pending && intent.key !== '')
    .sort(([, a], [, b]) => a.revision - b.revision)
    .map(([entry, intent]) => {
      const path = entry.slice(0, entry.indexOf(':'));
      const keyParam = path === '/api/searchhistory' ? 'keyword' : 'key';
      const field =
        path === '/api/playrecords'
          ? 'record'
          : path === '/api/favorites'
          ? 'favorite'
          : path === '/api/followings'
          ? 'following'
          : 'keyword';
      return {
        acknowledge: () => acknowledgeIntent(username, entry, intent),
        isCurrent: () => intents(username)[entry] === intent && intent.pending,
        url:
          intent.method === 'DELETE' && intent.key
            ? `${path}?${keyParam}=${encodeURIComponent(intent.key)}`
            : path,
        options:
          intent.method === 'DELETE'
            ? { method: 'DELETE' }
            : {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                  path === '/api/searchhistory'
                    ? { keyword: intent.key }
                    : { key: intent.key, [field]: intent.value }
                ),
              },
      };
    });
}

if (typeof window !== 'undefined') {
  window.addEventListener('moontv:logout', () => {
    stores.clear();
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith('moontv_pending_writes_'))
        .forEach((key) => localStorage.removeItem(key));
    } catch {
      /* Storage can be unavailable. */
    }
  });
}
