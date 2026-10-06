/**
 * 視頻片段本地緩存層。
 *
 * 職責邊界：Cache Storage 讀寫 + IndexedDB 元數據 + LRU 淘汰 + 設置持久化。
 * 不做任何與播放器狀態相關的判斷，因此可以在視頻暫停、頁面切到後台時繼續工作。
 *
 * 關於「為什麼不用 Service Worker」：
 *   1. 代碼裡本來就在替換 hls.js 的 loader（做去廣告），疊加 cache-first 零注冊成本；
 *   2. next-pwa 的 dest 是 public，會在生產構建時覆蓋手寫的 public/sw.js，scope 會沖突；
 *   3. 跨域片段經 SW 攔截拿到的是 opaque response，cache.put 存不了內容。
 */

/** 片段響應體的 Cache Storage 桶名 */
export const VIDEO_CACHE_NAME = 'moontv-video-v1';

const META_DB = 'moontv-video-meta';
const META_VERSION = 1;
const META_STORE = 'segments';

// Clearing private media invalidates reads/writes already in flight.
let cacheGeneration = 0;

export const CACHE_SETTINGS_KEY = 'video_cache_settings';

export interface SegmentMeta {
  /** Cache Storage 中的 key（同源代理 URL 或源站絕對 URL） */
  key: string;
  /** 劇集標識 `${source}:${id}:${episodeIndex}`，用於按集淘汰 */
  episodeKey: string;
  /** 片段序號（1 基，便於排查） */
  index: number;
  /** 字節數 */
  bytes: number;
  /** 預取時的實際耗時(ms)，用於給 hls.js 合成 LoaderStats，避免 ABR 高估帶寬 */
  costMs: number;
  /** 最後訪問時間戳，LRU 依據 */
  lastAccess: number;
}

/**
 * 前向緩存"不設上限"的哨兵值。
 *
 * 傳 0 表示一直往後鋪，直到播放列表最後一個分片；播放推進時只做增量續跑，
 * 暫停、頁面切到後台都不會讓隊列停下來。真正的兜底交給字節上限
 * （`maxBytesPerEpisode` / `maxTotalBytes`）與 LRU 淘汰，而不是時間。
 */
export const UNLIMITED_HORIZON_SECONDS = 0;

export interface CacheSettings {
  /** 總開關 */
  enabled: boolean;
  /**
   * 前向緩存目標時長（秒）。
   *
   * `UNLIMITED_HORIZON_SECONDS`（0）= 不設時間上限，緩存到片尾。
   */
  horizonSeconds: number;
  /** 單集最大佔用（字節） */
  maxBytesPerEpisode: number;
  /** 全部緩存最大佔用（字節） */
  maxTotalBytes: number;
  /** 是否走 /api/m3u8 同源代理（false 時直接緩存源站絕對 URL） */
  useProxy: boolean;
}

export const DEFAULT_CACHE_SETTINGS: CacheSettings = {
  enabled: true,
  // 默認不設時間上限：暫停後一直往後緩存，直到片尾或觸發字節上限淘汰
  horizonSeconds: UNLIMITED_HORIZON_SECONDS,
  maxBytesPerEpisode: 800 * 1024 * 1024,
  maxTotalBytes: 3 * 1024 * 1024 * 1024,
  useProxy: true,
};

function clampNumber(
  value: unknown,
  min: number,
  max: number
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------------ */
/* 設置讀寫                                                            */
/* ------------------------------------------------------------------ */

export function loadCacheSettings(): CacheSettings {
  if (typeof window === 'undefined') return DEFAULT_CACHE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(CACHE_SETTINGS_KEY);
    if (!raw) return DEFAULT_CACHE_SETTINGS;
    return normalizeCacheSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_CACHE_SETTINGS;
  }
}

/** 對可能不可信的配置做字段級校驗，避免髒數據導致配額失控 */
export function normalizeCacheSettings(input: unknown): CacheSettings {
  if (!input || typeof input !== 'object') return DEFAULT_CACHE_SETTINGS;
  const raw = input as Record<string, unknown>;

  const settings: CacheSettings = { ...DEFAULT_CACHE_SETTINGS };

  if (typeof raw.enabled === 'boolean') settings.enabled = raw.enabled;
  if (typeof raw.useProxy === 'boolean') settings.useProxy = raw.useProxy;

  const horizon = clampNumber(raw.horizonSeconds, 0, 7200);
  if (horizon !== undefined) {
    // 0 是「無限」哨兵，必須原樣保留；其余值低於 1 分鐘沒有意義，抬到 60s
    settings.horizonSeconds =
      horizon === 0
        ? UNLIMITED_HORIZON_SECONDS
        : Math.max(60, Math.round(horizon));
  }

  const perEpisode = clampNumber(
    raw.maxBytesPerEpisode,
    50 * 1024 * 1024,
    8 * 1024 ** 3
  );
  if (perEpisode !== undefined)
    settings.maxBytesPerEpisode = Math.round(perEpisode);

  const total = clampNumber(
    raw.maxTotalBytes,
    100 * 1024 * 1024,
    20 * 1024 ** 3
  );
  if (total !== undefined) settings.maxTotalBytes = Math.round(total);

  if (settings.maxBytesPerEpisode > settings.maxTotalBytes) {
    settings.maxBytesPerEpisode = settings.maxTotalBytes;
  }

  return settings;
}

export function saveCacheSettings(next: Partial<CacheSettings>): CacheSettings {
  const merged = normalizeCacheSettings({ ...loadCacheSettings(), ...next });
  try {
    window.localStorage.setItem(CACHE_SETTINGS_KEY, JSON.stringify(merged));
  } catch {
    // 隱私模式 / 存儲配額滿時靜默失敗，不影響播放
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* IndexedDB 元數據                                                    */
/* ------------------------------------------------------------------ */

let dbPromise: Promise<IDBDatabase> | null = null;

function indexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openMetaDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(META_DB, META_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        const store = db.createObjectStore(META_STORE, { keyPath: 'key' });
        store.createIndex('by_episode', 'episodeKey');
        store.createIndex('by_access', 'lastAccess');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  // 打開失敗時清空緩存句柄，允許下次重試
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

function runTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  return openMetaDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(META_STORE, mode);
        const request = fn(transaction.objectStore(META_STORE));
        transaction.oncomplete = () => resolve(request.result as T);
        transaction.onabort = () =>
          reject(transaction.error || new Error('Cache transaction aborted'));
        transaction.onerror = () => reject(transaction.error);
        request.onerror = () => reject(request.error);
      })
  );
}

export const metaStore = {
  put(record: SegmentMeta): Promise<void> {
    return runTx<void>('readwrite', (store) => store.put(record));
  },
  get(key: string): Promise<SegmentMeta | undefined> {
    return runTx<SegmentMeta | undefined>('readonly', (store) =>
      store.get(key)
    );
  },
  del(key: string): Promise<void> {
    return runTx<void>('readwrite', (store) => store.delete(key));
  },
  all(): Promise<SegmentMeta[]> {
    return runTx<SegmentMeta[]>('readonly', (store) => store.getAll());
  },
  clear(): Promise<void> {
    return runTx<void>('readwrite', (store) => store.clear());
  },
};

/** 30 秒內同一 key 只寫一次 lastAccess，避免命中緩存時頻繁寫盤 */
const lastTouchAt = new Map<string, number>();
const TOUCH_INTERVAL_MS = 30_000;

export async function touchMeta(key: string): Promise<void> {
  const generation = cacheGeneration;
  const now = Date.now();
  const previous = lastTouchAt.get(key);
  if (previous !== undefined && now - previous < TOUCH_INTERVAL_MS) return;
  lastTouchAt.set(key, now);

  try {
    const record = await metaStore.get(key);
    if (!record || generation !== cacheGeneration) return;
    record.lastAccess = now;
    await metaStore.put(record);
  } catch {
    // 元數據寫入失敗不影響播放
  }
}

/* ------------------------------------------------------------------ */
/* Cache Storage                                                       */
/* ------------------------------------------------------------------ */

export function isCacheStorageAvailable(): boolean {
  return typeof caches !== 'undefined';
}

export async function openVideoCache(): Promise<Cache | null> {
  if (!isCacheStorageAvailable()) return null;
  try {
    return await caches.open(VIDEO_CACHE_NAME);
  } catch {
    return null;
  }
}

export async function hasCachedSegment(key: string): Promise<boolean> {
  const cache = await openVideoCache();
  if (!cache) return false;
  try {
    return (await cache.match(key)) !== undefined;
  } catch {
    return false;
  }
}

/** 申請持久化存儲，降低磁盤緊張時被瀏覽器整塊清理的概率 */
export async function ensurePersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist)
    return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export interface CacheStorageEstimate {
  usage: number;
  quota: number;
  ratio: number;
}

export async function estimateStorage(): Promise<CacheStorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate)
    return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, ratio: quota > 0 ? usage / quota : 0 };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 命中率探針                                                          */
/* ------------------------------------------------------------------ */

/**
 * 片段緩存命中/未命中計數。
 *
 * 用途：預取器與 loader 的緩存鍵必須字節一致，一旦 `applyURL` 之類的
 * URL 解析出現分歧，緩存會靜默 0 命中（表現為"預取白跑、播放依舊走網絡"）。
 * 命中率是最直接的觀測手段，設置面板裡會展示。
 */
const segmentProbe = { hits: 0, misses: 0 };

export function recordSegmentProbe(hit: boolean): void {
  if (hit) segmentProbe.hits += 1;
  else segmentProbe.misses += 1;
}

export function getSegmentProbe(): {
  hits: number;
  misses: number;
  hitRate: number;
} {
  const total = segmentProbe.hits + segmentProbe.misses;
  return {
    hits: segmentProbe.hits,
    misses: segmentProbe.misses,
    hitRate: total > 0 ? segmentProbe.hits / total : 0,
  };
}

export function resetSegmentProbe(): void {
  segmentProbe.hits = 0;
  segmentProbe.misses = 0;
}

/**
 * LRU 淘汰。
 *
 * 兩輪：先按 episodeKey 內淘汰最久未訪問的片段滿足單集上限，
 * 再按全局最久未訪問淘汰滿足總上限。
 *
 * @returns 實際刪除的片段數量
 */
export async function enforceQuota(
  settings: CacheSettings = loadCacheSettings()
): Promise<number> {
  const cache = await openVideoCache();
  if (!cache) return 0;

  let records: SegmentMeta[];
  try {
    records = await metaStore.all();
  } catch {
    return 0;
  }
  if (records.length === 0) return 0;

  const victims = new Set<string>();
  let total = records.reduce((sum, record) => sum + (record.bytes || 0), 0);

  // ① 單集超限
  const grouped = new Map<string, SegmentMeta[]>();
  for (const record of records) {
    const list = grouped.get(record.episodeKey);
    if (list) list.push(record);
    else grouped.set(record.episodeKey, [record]);
  }

  for (const list of Array.from(grouped.values())) {
    list.sort((a, b) => a.lastAccess - b.lastAccess);
    let size = list.reduce((sum, record) => sum + (record.bytes || 0), 0);
    for (const record of list) {
      if (size <= settings.maxBytesPerEpisode) break;
      victims.add(record.key);
      size -= record.bytes || 0;
      total -= record.bytes || 0;
    }
  }

  // ② 全局超限
  if (total > settings.maxTotalBytes) {
    const rest = records
      .filter((record) => !victims.has(record.key))
      .sort((a, b) => a.lastAccess - b.lastAccess);
    for (const record of rest) {
      if (total <= settings.maxTotalBytes) break;
      victims.add(record.key);
      total -= record.bytes || 0;
    }
  }

  if (victims.size === 0) return 0;

  let removed = 0;
  await Promise.all(
    Array.from(victims).map(async (key) => {
      try {
        if (await cache.delete(key)) removed += 1;
      } catch {
        // ignore
      }
      try {
        await metaStore.del(key);
      } catch {
        // ignore
      }
      lastTouchAt.delete(key);
    })
  );

  return removed;
}

export async function clearVideoCache(): Promise<void> {
  cacheGeneration += 1;
  resetSegmentProbe();
  try {
    await caches.delete(VIDEO_CACHE_NAME);
  } catch {
    // ignore
  }
  try {
    await metaStore.clear();
  } catch {
    // ignore
  }
  lastTouchAt.clear();
}

/** 統計已緩存字節數與片段數（設置面板展示用） */
export async function getCacheSummary(): Promise<{
  bytes: number;
  segments: number;
  episodes: number;
}> {
  try {
    const records = await metaStore.all();
    return {
      bytes: records.reduce((sum, record) => sum + (record.bytes || 0), 0),
      segments: records.length,
      episodes: new Set(records.map((record) => record.episodeKey)).size,
    };
  } catch {
    return { bytes: 0, segments: 0, episodes: 0 };
  }
}

/** 單集緩存的聚合統計 */
export interface EpisodeCacheStat {
  /** 劇集標識 `${source}:${id}:${episodeIndex}` */
  episodeKey: string;
  /** 片段數 */
  segments: number;
  /** 佔用字節數 */
  bytes: number;
  /** 最近訪問時間（用於排序） */
  lastAccess: number;
}

/** 按劇集聚合已緩存內容的統計（緩存管理面板用），按最近訪問倒序 */
export async function getEpisodeCacheStats(): Promise<EpisodeCacheStat[]> {
  try {
    const records = await metaStore.all();
    const grouped = new Map<string, EpisodeCacheStat>();
    for (const record of records) {
      const stat = grouped.get(record.episodeKey);
      if (stat) {
        stat.segments += 1;
        stat.bytes += record.bytes || 0;
        if (record.lastAccess > stat.lastAccess)
          stat.lastAccess = record.lastAccess;
      } else {
        grouped.set(record.episodeKey, {
          episodeKey: record.episodeKey,
          segments: 1,
          bytes: record.bytes || 0,
          lastAccess: record.lastAccess,
        });
      }
    }
    return Array.from(grouped.values()).sort(
      (a, b) => b.lastAccess - a.lastAccess
    );
  } catch {
    return [];
  }
}

/** 刪除指定劇集的全部緩存（片段 + 元數據） */
export async function deleteEpisodeCache(episodeKey: string): Promise<number> {
  const cache = await openVideoCache();
  if (!cache) return 0;

  let records: SegmentMeta[];
  try {
    records = await metaStore.all();
  } catch {
    return 0;
  }

  const victims = records.filter((record) => record.episodeKey === episodeKey);
  if (victims.length === 0) return 0;

  let removed = 0;
  await Promise.all(
    victims.map(async (record) => {
      try {
        if (await cache.delete(record.key)) removed += 1;
      } catch {
        // ignore
      }
      try {
        await metaStore.del(record.key);
      } catch {
        // ignore
      }
      lastTouchAt.delete(record.key);
    })
  );
  return removed;
}

/* ------------------------------------------------------------------ */
/* 緩存鍵                                                              */
/* ------------------------------------------------------------------ */

/**
 * 歸一化片段 URL。
 *
 * 預取器（從 m3u8 文本解析）與讀取側（hls.js 的 context.url）必須得到
 * **字節完全一致**的 key，否則緩存永遠 0 命中。統一走 URL 構造器，
 * 讓默認端口、百分號編碼、路徑 `..` 的差異都被抹平。
 */
export function normalizeSegmentUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

/**
 * 生成片段緩存鍵。
 *
 * - `useProxy = true`：轉成同源的 `/api/m3u8?url=...`，鍵穩定，且天然規避源站
 *   的 Referer / CORS 校驗；
 * - `useProxy = false`：直接用源站絕對 URL 作為鍵，省掉服務端帶寬。
 */
export function buildSegmentCacheKey(
  segmentUrl: string,
  useProxy = true
): string {
  const normalized = normalizeSegmentUrl(segmentUrl);
  return useProxy
    ? `/api/m3u8?url=${encodeURIComponent(normalized)}`
    : normalized;
}

/* ------------------------------------------------------------------ */
/* 片段讀寫                                                            */
/* ------------------------------------------------------------------ */

/**
 * 緩存一個片段響應。僅保留渲染/解碼必需的頭，避免把源站的
 * CSP、鑑權相關頭一起帶進緩存。
 */
export async function putCachedSegment(
  key: string,
  buffer: ArrayBuffer,
  contentType?: string | null,
  signal?: AbortSignal
): Promise<void> {
  const generation = cacheGeneration;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const cache = await openVideoCache();
  if (signal?.aborted || generation !== cacheGeneration)
    throw new DOMException('Aborted', 'AbortError');
  if (!cache) throw new Error('Video cache is unavailable');

  await cache.put(
    key,
    new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': String(buffer.byteLength),
      },
    })
  );
}

/** 判斷是否為 Cache Storage 配額耗盡（各瀏覽器報錯類型不一，按 name + message 雙判） */
export function isQuotaExceededError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === 'QuotaExceededError')
    return true;
  const name = (err as { name?: unknown }).name;
  if (name === 'QuotaExceededError') return true;
  const message = err instanceof Error ? err.message : String(err);
  return /quota/i.test(message);
}

export type PutSegmentResult = 'ok' | 'quota' | 'failed';

/**
 * 帶配額自救的分片寫入。
 *
 * 前向緩存在"無限模式"下會把整集都鋪下來，必然更容易撞到存儲配額。
 * 直接 `cache.put` 拋 QuotaExceededError 的話，worker 的 try/catch 會
 * 把每個後續分片都吞掉——表現為"緩存悄悄停在某個位置不動了"，
 * 很難排查。這裡先按 LRU 淘汰一批再重試一次，真騰不出空間才上報。
 */
export async function putCachedSegmentResilient(
  key: string,
  buffer: ArrayBuffer,
  contentType?: string | null,
  settings: CacheSettings = loadCacheSettings(),
  signal?: AbortSignal
): Promise<PutSegmentResult> {
  const generation = cacheGeneration;
  const cancelled = () => signal?.aborted || generation !== cacheGeneration;
  if (cancelled()) return 'failed';
  try {
    await putCachedSegment(key, buffer, contentType, signal);
    if (cancelled()) return 'failed';
    return 'ok';
  } catch (err) {
    if (cancelled() || !isQuotaExceededError(err)) return 'failed';

    const removed = await enforceQuota(settings);
    if (cancelled()) return 'failed';
    if (removed === 0) return 'quota';

    try {
      await putCachedSegment(key, buffer, contentType, signal);
      return cancelled() ? 'failed' : 'ok';
    } catch {
      return 'quota';
    }
  }
}

export interface CachedFragment {
  data: ArrayBuffer;
  costMs: number;
}

/** 讀取緩存片段，同時取回預取時記錄的真實耗時（供合成 LoaderStats 用） */
export async function readCachedSegment(
  key: string
): Promise<CachedFragment | null> {
  const generation = cacheGeneration;
  const cache = await openVideoCache();
  if (!cache || generation !== cacheGeneration) return null;

  let hit: Response | undefined;
  try {
    hit = await cache.match(key);
  } catch {
    return null;
  }
  if (!hit) return null;

  try {
    const [data, record] = await Promise.all([
      hit.arrayBuffer(),
      metaStore.get(key).catch(() => undefined),
    ]);
    if (generation !== cacheGeneration) return null;
    return { data, costMs: record?.costMs ?? 150 };
  } catch {
    return null;
  }
}

/** 供調試：indexedDB 是否可用 */
export function isMetaStoreAvailable(): boolean {
  return indexedDbAvailable();
}
