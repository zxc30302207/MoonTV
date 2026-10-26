/** Browser-only optimistic concurrency transport. No automatic mutation replay. */
import type { NamespaceVersion } from './mutation-protocol';

const paths = new Set([
  '/api/playrecords',
  '/api/favorites',
  '/api/searchhistory',
  '/api/followings',
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function namespacePath(url: string): string | undefined {
  const path = new URL(url, window.location.origin).pathname;
  return paths.has(path) ? path : undefined;
}
export function responseVersion(
  response: Response
): NamespaceVersion | undefined {
  const epoch = response.headers?.get('X-MoonTV-Epoch');
  const revision = response.headers?.get('X-MoonTV-Revision');
  if (
    !epoch ||
    !UUID.test(epoch) ||
    !revision ||
    !/^(0|[1-9]\d*)$/.test(revision)
  )
    return;
  return { epoch, revision };
}
export class NamespaceSyncError extends Error {
  constructor(
    public readonly kind: 'snapshot' | 'unknown' | 'conflict' | 'upgrade',
    message: string
  ) {
    super(message);
    this.name = 'NamespaceSyncError';
  }
}
type Pending = {
  url: string;
  method: 'POST' | 'DELETE';
  body?: string;
  version: NamespaceVersion;
  operationId: string;
  intentRevision: number;
  status: 'unknown' | 'conflict';
  uncertain: boolean;
};
type State = {
  version?: NamespaceVersion;
  needsReview?: boolean;
  pending?: Pending;
  tail?: Promise<void>;
  queued: number;
  writeGeneration: number;
  readGeneration: number;
};
const states = new Map<string, State>();
let sessionGeneration = 0;
export function namespaceSessionGuard(): () => void {
  const generation = sessionGeneration;
  return () => {
    if (generation !== sessionGeneration) throw new Error('登入狀態已變更');
  };
}
const storageKey = (username: string, path: string) =>
  `moontv_namespace_v1_${encodeURIComponent(username)}_${encodeURIComponent(
    path
  )}`;
function savedPending(username: string, path: string): Pending[] {
  const prefix = `${storageKey(username, path)}_`;
  const pending: Pending[] = [];
  try {
    for (const key of Object.keys(localStorage).filter((key) =>
      key.startsWith(prefix)
    )) {
      try {
        const raw = JSON.parse(
          localStorage.getItem(key) || 'null'
        ) as Pending | null;
        if (
          raw &&
          namespacePath(raw.url) === path &&
          new URL(raw.url, window.location.origin).origin ===
            window.location.origin &&
          ['POST', 'DELETE'].includes(raw.method) &&
          (raw.body === undefined || typeof raw.body === 'string') &&
          UUID.test(raw.operationId) &&
          key === `${prefix}${raw.operationId}` &&
          UUID.test(raw.version?.epoch) &&
          /^(0|[1-9]\d*)$/.test(raw.version?.revision) &&
          Number.isSafeInteger(raw.intentRevision) &&
          raw.intentRevision >= 0 &&
          ['unknown', 'conflict'].includes(raw.status)
        ) {
          pending.push({ ...raw, uncertain: true });
        }
      } catch {
        /* Malformed private state is never a request. */
      }
    }
  } catch {
    /* In-memory state remains available. */
  }
  return pending.sort(
    (a, b) =>
      a.intentRevision - b.intentRevision ||
      a.operationId.localeCompare(b.operationId)
  );
}
function stateFor(username: string, path: string): State {
  const key = storageKey(username, path);
  let state = states.get(key);
  if (!state) {
    state = { queued: 0, writeGeneration: 0, readGeneration: 0 };
    states.set(key, state);
  }
  if (!state.queued && state.pending?.status === 'conflict') {
    try {
      if (!localStorage.getItem(`${key}_${state.pending.operationId}`))
        state.pending = undefined;
    } catch {
      /* Keep the conservative in-memory gate. */
    }
  }
  if (!state.pending) state.pending = savedPending(username, path)[0];
  try {
    state.needsReview ||= localStorage.getItem(`${key}_review`) === '1';
  } catch {
    /* Keep the in-memory review gate. */
  }
  return state;
}
function persist(username: string, path: string, state: State) {
  if (state.pending)
    localStorage.setItem(
      `${storageKey(username, path)}_${state.pending.operationId}`,
      JSON.stringify(state.pending)
    );
}
function removePending(username: string, path: string, state: State) {
  if (state.pending)
    localStorage.removeItem(
      `${storageKey(username, path)}_${state.pending.operationId}`
    );
  state.pending = undefined;
}
export function hasNamespaceSnapshot(username: string, path: string): boolean {
  return Boolean(stateFor(username, path).version);
}
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, '0')
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function namespaceReadTicket(username: string, path: string) {
  const state = stateFor(username, path);
  return {
    sessionGeneration,
    writeGeneration: state.writeGeneration,
    readGeneration: ++state.readGeneration,
  };
}
export function observeNamespaceRead(
  username: string,
  path: string,
  response: Response,
  ticket: ReturnType<typeof namespaceReadTicket>
) {
  const state = stateFor(username, path);
  if (
    ticket.sessionGeneration !== sessionGeneration ||
    ticket.readGeneration !== state.readGeneration
  )
    return false;
  const version = responseVersion(response);
  if (
    version &&
    ticket.sessionGeneration === sessionGeneration &&
    !state.pending &&
    !state.needsReview &&
    !state.queued &&
    state.writeGeneration === ticket.writeGeneration &&
    state.readGeneration === ticket.readGeneration
  )
    state.version = version;
  return true;
}
async function serial<T>(state: State, run: () => Promise<T>): Promise<T> {
  const previous = state.tail;
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.tail = current;
  state.queued++;
  state.writeGeneration++;
  try {
    if (previous) await previous;
    return await run();
  } finally {
    state.queued--;
    release();
    if (state.tail === current) state.tail = undefined;
  }
}
async function sendPending(
  username: string,
  path: string,
  state: State,
  checkSession: () => void,
  retry: boolean
): Promise<Response> {
  const generation = sessionGeneration;
  const pending = state.pending;
  if (!pending) throw new Error('Missing mutation');
  checkSession();
  // Persist before the network call. A storage failure must not send an untrackable write.
  persist(username, path, state);
  let response: Response;
  try {
    response = await fetch(pending.url, {
      method: pending.method,
      body: pending.body,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-MoonTV-Epoch': pending.version.epoch,
        'X-MoonTV-Revision': pending.version.revision,
        'X-MoonTV-Operation-Id': pending.operationId,
      },
    });
    if (generation !== sessionGeneration) throw new Error('登入狀態已變更');
    checkSession();
  } catch (error) {
    if (generation === sessionGeneration) {
      pending.uncertain = true;
      persist(username, path, state);
    }
    throw error;
  }
  if (response.ok) {
    const version = responseVersion(response);
    if (!version)
      throw new NamespaceSyncError(
        'unknown',
        '伺服器未回傳版本，變更結果尚未確認。請重試原操作。'
      );
    state.version = version;
    removePending(username, path, state);
  } else if (response.status === 409) {
    pending.status = 'conflict';
    pending.uncertain = retry || pending.uncertain;
    persist(username, path, state);
    throw new NamespaceSyncError(
      'conflict',
      '其他裝置已更新資料。此裝置的變更已保留，請在帳號選單重新載入並確認。'
    );
  } else if ([400, 401, 403, 404, 422, 428].includes(response.status)) {
    removePending(username, path, state);
    if (response.status === 428)
      throw new NamespaceSyncError(
        'upgrade',
        '頁面版本已過期，請重新整理後再確認操作。'
      );
  } else {
    pending.uncertain = true;
    persist(username, path, state);
  }
  return response;
}
export async function sendNamespaceWrite(
  username: string,
  url: string,
  options: RequestInit,
  intentRevision: number,
  checkSession: () => void
): Promise<Response> {
  const path = namespacePath(url);
  if (!path) throw new Error('Unsupported namespace');
  const state = stateFor(username, path);
  const generation = sessionGeneration;
  const observed = state.version;
  const readGeneration = state.readGeneration;
  return serial(state, async () => {
    checkSession();
    if (generation !== sessionGeneration) throw new Error('登入狀態已變更');
    if (!state.pending) state.pending = savedPending(username, path)[0];
    if (state.pending)
      throw new NamespaceSyncError(
        state.pending.status,
        '先前變更尚未確認，已暫停新的同步。請在帳號選單處理未同步變更。'
      );
    // Only our acknowledged predecessors may advance an already-observed version.
    const version =
      state.readGeneration === readGeneration ? state.version : observed;
    if (!version || state.needsReview) {
      state.needsReview = true;
      localStorage.setItem(`${storageKey(username, path)}_review`, '1');
      throw new NamespaceSyncError(
        'snapshot',
        '請先重新載入資料再確認操作。變更已保留在此裝置。'
      );
    }
    state.pending = {
      url,
      method: options.method as 'POST' | 'DELETE',
      body: typeof options.body === 'string' ? options.body : undefined,
      version,
      operationId: uuid(),
      intentRevision,
      status: 'unknown',
      uncertain: false,
    };
    return sendPending(username, path, state, checkSession, false);
  });
}
/** Exact operation retry only. No new id, expected version, or body. */
export async function retryNamespaceWrites(
  username: string,
  checkSession: () => void,
  acknowledge: (revision: number, url: string, options: RequestInit) => void
) {
  const guardSession = namespaceSessionGuard();
  for (const path of paths) {
    guardSession();
    const state = stateFor(username, path);
    const candidates = savedPending(username, path).filter(
      (item) => item.status === 'unknown'
    );
    if (
      state.pending?.status === 'unknown' &&
      !candidates.some(
        (item) => item.operationId === state.pending?.operationId
      )
    )
      candidates.push(state.pending);
    for (const candidate of candidates) {
      await serial(state, async () => {
        guardSession();
        checkSession();
        state.pending = candidate;
        const response = await sendPending(
          username,
          path,
          state,
          checkSession,
          true
        );
        if (response.ok)
          acknowledge(candidate.intentRevision, candidate.url, {
            method: candidate.method,
            body: candidate.body,
          });
      }).catch(() => undefined);
    }
    // Do not let a cached conflict hide another tab's still-unknown operation.
    state.pending = savedPending(username, path)[0];
  }
}
export function namespaceProblems(username: string) {
  return Array.from(paths).flatMap((path) => {
    const state = stateFor(username, path);
    const pending = savedPending(username, path);
    if (
      state.pending &&
      !pending.some((item) => item.operationId === state.pending?.operationId)
    )
      pending.push(state.pending);
    if (!pending.length && state.needsReview)
      return [{ path, status: 'conflict' as const, uncertain: false }];
    return pending.map((item) => ({
      path,
      status: item.status,
      uncertain: item.uncertain,
    }));
  });
}
/** Call only after an explicit warning and user confirmation. No mutation is sent. */
export function discardNamespaceConflict(username: string, path: string) {
  const state = stateFor(username, path);
  const pending = savedPending(username, path);
  if (
    state.queued ||
    state.pending?.status === 'unknown' ||
    pending.some((item) => item.status === 'unknown')
  )
    throw new NamespaceSyncError(
      'unknown',
      '仍有結果未明的請求，請先重試確認。'
    );
  for (const item of pending)
    localStorage.removeItem(
      `${storageKey(username, path)}_${item.operationId}`
    );
  state.pending = undefined;
  state.version = undefined;
  state.needsReview = false;
  localStorage.removeItem(`${storageKey(username, path)}_review`);
}
if (typeof window !== 'undefined')
  window.addEventListener('moontv:logout', () => {
    sessionGeneration++;
    states.clear();
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith('moontv_namespace_v1_'))
        .forEach((key) => localStorage.removeItem(key));
    } catch {
      /* Storage can be unavailable. */
    }
  });
