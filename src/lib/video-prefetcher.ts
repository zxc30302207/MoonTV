/**
 * 前向片段預取器。
 *
 * 設計要點（這是"視頻暫停也繼續緩存"的全部秘密）：
 *   預取循環體內**不讀取任何播放狀態**——不判斷 `paused`、不判斷
 *   `document.hidden`、不聽播放器事件。循環體只有 `await fetch` 與
 *   `cache.put`，因此視頻暫停、頁面切到後台標簽頁時，隊列仍會繼續推進。
 *
 *   `setThrottled()` 是"臨時讓出帶寬"（播放卡頓時調用），與"暫停視頻就停緩存"
 *   是兩件事，不要混用。
 */

import { parseM3U8 } from './m3u8-downloader';
import {
  getPrefetchLimit,
  observePrefetchSegment,
  prefetchDownloadLimiter,
  prefetchWriteLimiter,
} from './prefetch-scheduler';
import { byteRangeHeader, readByteRangeResponse } from './video-byte-range';
import {
  type CacheSettings,
  buildSegmentCacheKey,
  enforceQuota,
  ensurePersistentStorage,
  getCachedSegmentRecords,
  getCacheKeyVariants,
  hasCachedSegment,
  loadCacheSettings,
  metaStore,
  putCachedSegmentResilient,
} from './video-cache';

export type PrefetchState =
  | 'idle'
  | 'parsing'
  | 'running'
  | 'done'
  | 'error'
  | 'disabled';

export interface PrefetchStats {
  state: PrefetchState;
  /** 已就緒的片段數 */
  cached: number;
  /** 完整播放列表的片段總數，不隨跳轉改變 */
  total: number;
  /** 當前播放列表實際緩存字節數 */
  bytes: number;
  /** 實際已緩存片段的總時長（秒），不包含緩存間隙 */
  coverTo: number;
  message?: string;
}

export interface PrefetchOptions {
  m3u8Url: string;
  /** Keep the cached timeline consistent with the player ad-filter toggle. */
  blockAd?: boolean;
  /** 當前播放位置（秒） */
  currentTime: number;
  /** 開啟跳過時的片頭、片尾時長（秒，均為非負數） */
  skipIntroSeconds?: number;
  skipOutroSeconds?: number;
  /** 當前影片名稱，用於緩存面板展示 */
  title?: string;
  /** 影視源名稱，用於緩存面板展示 */
  source?: string;
  /** 劇集標識，用於分集統計與淘汰 */

  episodeKey: string;
  /** 覆蓋 settings.horizonSeconds */
  horizonSeconds?: number;
  /** 回看保護時長（秒），默認 30 */
  lookBehindSeconds?: number;
  /** 覆蓋緩存模式的並發數（上限 32）：並發太高會搶播放的帶寬 */
  concurrency?: number;
  /** 覆蓋 settings.useProxy：直連失敗時是否允許代理兜底 */

  useProxy?: boolean;
  /**
   * 期望緩存的畫面高度（如 1080）。
   *
   * 主播放列表有多個碼率檔位時，預取器默認取最高帶寬；用戶手動把畫質切到
   * 480p 後，hls.js 請求的是 480p 的分片，與已緩存的 1080p 分片 URL 不同，
   * 命中率會掉到 0。把用戶選擇的檔位透傳下來即可保持一致。
   */
  preferredHeight?: number | null;
  onProgress?: (stats: PrefetchStats) => void;
}

const IDLE_STATS: PrefetchStats = {
  state: 'idle',
  cached: 0,
  total: 0,
  bytes: 0,
  coverTo: 0,
};

/** 時長信息缺失且設置了時間上限時，最多預取多少個片段；無限模式不受此限 */
const FALLBACK_MAX_SEGMENTS = 200;

/** 進度回調最小間隔，避免高頻寫 React state */
const EMIT_INTERVAL_MS = 250;
const STATS_REFRESH_INTERVAL_MS = 15_000;

/** 淘汰檢查間隔 */
const EVICT_INTERVAL_MS = 15_000;

const SEGMENT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

async function retrySegmentDownload<T>(
  download: () => Promise<T>,
  signal: AbortSignal
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await download();
    } catch (error) {
      if (signal.aborted || attempt >= SEGMENT_RETRY_DELAYS_MS.length) {
        throw error;
      }
      // 重試等待與分片請求使用同一信號，切集時不會留下延遲下載。
      await waitForRetry(SEGMENT_RETRY_DELAYS_MS[attempt], signal);
    }
  }
}

/**
 * 把 `horizonSeconds` 換算成"目標緩存到的時間點"。
 *
 * `<= 0`（`UNLIMITED_HORIZON_SECONDS`）表示不設上限，返回 `+Infinity`：
 * 隊列會一直鋪到播放列表最後一個分片，之後播放推進只做增量續跑。
 */
function horizonEndTime(currentTime: number, horizonSeconds: number): number {
  return horizonSeconds > 0
    ? currentTime + horizonSeconds
    : Number.POSITIVE_INFINITY;
}

/** 供回歸測試使用（純函數，無副作用） */
export const __testing__ = { horizonEndTime };

/**
 * 網絡環境守衛：省流量模式 / 弱網 / 離線時不做任何預取。
 * 這些條件下預取只會白白消耗用戶流量。
 */
export function shouldPrefetch(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof caches === 'undefined') return false;

  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  if (nav.onLine === false) return false;

  const connection = nav.connection;
  if (connection?.saveData) return false;
  if (
    typeof connection?.effectiveType === 'string' &&
    /(^|-)(2g|slow-2g)$/.test(connection.effectiveType)
  ) {
    return false;
  }

  return true;
}

function toCumulative(durations: number[]): number[] {
  const out = new Array<number>(durations.length);
  let acc = 0;
  for (let i = 0; i < durations.length; i += 1) {
    acc += durations[i] || 0;
    out[i] = acc;
  }
  return out;
}

function indexAtTime(cumulative: number[], time: number): number {
  for (let i = 0; i < cumulative.length; i += 1) {
    if (cumulative[i] > time) return i;
  }
  return Math.max(0, cumulative.length - 1);
}

export class VideoPrefetcher {
  private controller: AbortController | null = null;
  private pendingRuns = new Set<Promise<void>>();
  private parsedPlaylist: {
    task: Awaited<ReturnType<typeof parseM3U8>>;
    cumulative: number[];
  } | null = null;
  private episodeKey: string | null = null;
  private playlistUrl: string | null = null;
  private blockAd = true;
  private useProxy = true;
  /** 本輪隊列使用的碼率檔位（畫面高度），null 表示"最高帶寬" */
  private preferredHeight: number | null = null;
  private skipWindowKey = '';
  /** 當前已排入隊列的覆蓋區間 [windowFrom, windowTo]（秒） */

  private windowFrom = 0;
  private windowTo = 0;
  /** 隊列已覆蓋到播放列表末尾：此時無論請求多大視野都無事可做 */
  private reachedEnd = false;
  private accessDenied = false;
  private throttled = false;
  private activeRequests = new Set<AbortController>();
  private resumeWaiters: Array<() => void> = [];
  private stats: PrefetchStats = { ...IDLE_STATS };
  private lastEmittedStats: PrefetchStats | null = null;
  private lastEmitAt = 0;

  /**
   * 冪等入口。同一集且窗口仍然夠用時直接返回，因此可以放心地在
   * seek / timeupdate / pause 裡高頻調用。
   */
  ensure(options: PrefetchOptions): void {
    if (!options.m3u8Url) return;

    const settings = loadCacheSettings();
    if (!settings.enabled) {
      this.stop();
      this.emit(
        options,
        { state: 'disabled', message: '已關閉視頻緩存' },

        true
      );
      return;
    }
    if (!shouldPrefetch()) {
      this.stop();
      this.emit(
        options,
        { state: 'disabled', message: '當前網絡環境已跳過緩存' },
        true
      );
      return;
    }

    const blockAd = options.blockAd !== false;
    const useProxy = options.useProxy ?? settings.useProxy;
    const sameEpisode =
      this.episodeKey === options.episodeKey &&
      this.playlistUrl === options.m3u8Url &&
      this.blockAd === blockAd &&
      this.useProxy === useProxy;
    // 檔位變了（用戶手動切畫質）就必須重建隊列：不同檔位的分片 URL 不同，
    // 舊隊列緩存的分片與新請求對不上，繼續跑只是白燒帶寬。
    const preferredHeight = options.preferredHeight ?? null;
    const sameVariant = this.preferredHeight === preferredHeight;
    const skipIntro = Math.max(0, options.skipIntroSeconds || 0);
    const skipOutro = Math.max(0, options.skipOutroSeconds || 0);
    options = {
      ...options,
      currentTime: Math.max(options.currentTime, skipIntro),
    };
    const skipWindowKey = `${skipIntro}:${skipOutro}`;
    const sameSkipWindow = this.skipWindowKey === skipWindowKey;

    if (sameEpisode && sameVariant && sameSkipWindow && this.accessDenied) {
      this.emit(options, this.stats);
      return;
    }

    // 隊列已經覆蓋到播放列表末尾，且當前播放位置落在已覆蓋區間內：
    // 再叫也不會多出可緩存的片段。
    // 必須先短路，否則下面"窗口夠不夠大"的判斷在短播放列表上永不成立，
    // 會導致每次 ensure 都重啟一輪隊列。
    // 注意要帶上"位置在覆蓋區間內"這一條：末尾覆蓋 + 向後拖進度條 仍然需要重建隊列。
    if (
      sameEpisode &&
      sameVariant &&
      sameSkipWindow &&
      this.reachedEnd &&
      options.currentTime >= this.windowFrom - 60 &&
      options.currentTime <= this.windowTo
    ) {
      this.emit(options, this.stats);
      return;
    }

    const requestedTo = horizonEndTime(
      options.currentTime,
      options.horizonSeconds ?? settings.horizonSeconds
    );

    // 窗口仍然夠用的條件：
    // 1) 前向還有 60s 以上余量（避免剛排完就重啟）
    // 2) 已覆蓋區間已經夠到本輪要求的視野（無限模式要求鋪到片尾）
    // 3) 當前播放位置沒有退到已覆蓋區間之前（否則會出現緩存盲區）
    // 4) 碼率檔位沒變
    const windowStillUseful =
      sameEpisode &&
      sameVariant &&
      sameSkipWindow &&
      this.controller !== null &&
      !this.controller.signal.aborted &&
      options.currentTime + 60 < this.windowTo &&
      this.windowTo + 60 >= requestedTo &&
      options.currentTime >= this.windowFrom;

    if (windowStillUseful) {
      this.emit(options, this.stats);
      return;
    }

    this.stop(sameEpisode && sameVariant);
    const controller = new AbortController();
    this.controller = controller;
    this.episodeKey = options.episodeKey;
    this.playlistUrl = options.m3u8Url;
    this.blockAd = blockAd;
    this.useProxy = useProxy;

    this.preferredHeight = preferredHeight;
    this.skipWindowKey = skipWindowKey;

    // 先寫入近似窗口邊界，讓窗口判斷在 run() 完成解析前就生效。
    // 否則解析期間（await parseM3U8）連續的 ensure 調用會反復重啟隊列。
    // run() 拿到真實片段時長後會覆蓋為精確值。
    this.windowFrom = Math.max(
      0,
      options.currentTime - (options.lookBehindSeconds ?? 30)
    );
    this.windowTo = requestedTo;

    const run = this.run(options, settings, controller.signal).catch(() => {
      if (controller.signal.aborted) return;
      this.controller = null;
      this.emit(options, { state: 'error', message: '緩存存儲讀取失敗' }, true);
    });
    this.pendingRuns.add(run);
    void run.finally(() => this.pendingRuns.delete(run));
  }

  /** 中止並等待在途寫入完成，避免清空後舊任務重新寫回緩存。 */
  async stopAndWait(): Promise<void> {
    this.stop();
    await Promise.allSettled(Array.from(this.pendingRuns));
  }

  /** 完整停止並重置（切集、換源、卸載時調用） */
  stop(preserveStats = false): void {
    this.controller?.abort();
    this.controller = null;
    if (!preserveStats) {
      this.episodeKey = null;
      this.playlistUrl = null;
      this.parsedPlaylist = null;
    }

    this.windowFrom = 0;
    this.windowTo = 0;
    this.reachedEnd = false;
    this.accessDenied = false;
    this.throttled = false;

    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    waiters.forEach((resolve) => resolve());

    if (!preserveStats) this.stats = { ...IDLE_STATS };
  }

  /**
   * 播放出現 stall 時讓出帶寬，恢復後解除。
   * 這不是"暫停視頻就停緩存"。
   */
  setThrottled(value: boolean): void {
    if (value === this.throttled) return;
    this.throttled = value;
    if (value) {
      this.activeRequests.forEach((request) => request.abort());
    }
    if (!value) {
      const waiters = this.resumeWaiters;
      this.resumeWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }

  getStats(): PrefetchStats {
    return this.stats;
  }

  private waitWhileThrottled(signal: AbortSignal): Promise<void> {
    if (!this.throttled || signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const onReady = () => {
        signal.removeEventListener('abort', onReady);
        this.resumeWaiters = this.resumeWaiters.filter(
          (waiter) => waiter !== onReady
        );
        resolve();
      };
      this.resumeWaiters.push(onReady);
      signal.addEventListener('abort', onReady, { once: true });
      if (signal.aborted) onReady();
    });
  }

  private emit(
    options: PrefetchOptions,
    patch: Partial<PrefetchStats>,
    force = false
  ): void {
    this.stats = { ...this.stats, ...patch };
    const previous = this.lastEmittedStats;
    if (
      !force &&
      previous &&
      previous.state === this.stats.state &&
      previous.cached === this.stats.cached &&
      previous.total === this.stats.total &&
      previous.bytes === this.stats.bytes &&
      previous.coverTo === this.stats.coverTo &&
      previous.message === this.stats.message
    ) {
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastEmitAt < EMIT_INTERVAL_MS) return;
    this.lastEmitAt = now;
    this.lastEmittedStats = this.stats;
    options.onProgress?.(this.stats);
  }

  private async run(
    options: PrefetchOptions,
    settings: CacheSettings,
    signal: AbortSignal
  ): Promise<void> {
    // 等待已中止隊列的在途寫入，避免舊任務與新隊列交叉更新統計。
    await Promise.allSettled(Array.from(this.pendingRuns));
    if (signal.aborted) return;

    const useProxy = options.useProxy ?? settings.useProxy;
    const concurrency = Math.max(
      1,
      Math.min(
        getPrefetchLimit(4 * 1024 * 1024),
        Math.round(options.concurrency ?? settings.concurrency ?? 3)
      )
    );
    const lookBehind = Math.max(0, options.lookBehindSeconds ?? 30);

    const horizonSeconds = options.horizonSeconds ?? settings.horizonSeconds;
    /** 時間上限關閉時隊列鋪到片尾，此時唯一的兜底是字節上限 + LRU 淘汰 */
    const unlimitedHorizon = !(horizonSeconds > 0);
    const horizonTime = horizonEndTime(options.currentTime, horizonSeconds);

    let playlist = this.parsedPlaylist;
    if (!playlist) {
      this.emit(options, { state: 'parsing', message: undefined }, true);
      let task: Awaited<ReturnType<typeof parseM3U8>>;
      try {
        const filteredPlayback = options.blockAd !== false;
        const isFilterEndpoint = (url: string) => {
          try {
            const target = new URL(url, window.location.origin);
            return (
              target.origin === window.location.origin &&
              target.pathname === '/api/m3u8/filter'
            );
          } catch {
            return false;
          }
        };
        const playlistUrl = filteredPlayback
          ? new URL(
              `/api/m3u8/filter?url=${encodeURIComponent(options.m3u8Url)}`,
              window.location.origin
            ).href
          : options.m3u8Url;
        task = await parseM3U8(
          playlistUrl,
          {
            fetcher: (url, init) =>
              fetch(
                isFilterEndpoint(url)
                  ? url
                  : buildSegmentCacheKey(url, useProxy),
                {
                  ...init,
                  signal,
                  credentials: 'same-origin',
                  cache: 'no-store',
                }
              ),
            resolveResponseUrl: (response, requestedUrl) =>
              isFilterEndpoint(requestedUrl)
                ? requestedUrl
                : useProxy
                ? response.headers.get('X-MoonTV-Upstream-URL') || requestedUrl
                : response.url || requestedUrl,
          },
          0,
          { height: options.preferredHeight ?? null }
        );
      } catch {
        if (signal.aborted) return;
        this.controller = null;
        this.emit(
          options,
          { state: 'error', message: '播放列表解析失敗' },
          true
        );
        return;
      }
      if (signal.aborted) return;
      if (task.tsUrlList.length === 0) {
        this.controller = null;
        this.emit(options, { state: 'error', message: '播放列表為空' }, true);
        return;
      }
      playlist = { task, cumulative: toCumulative(task.segmentDurations) };
      // 拖動只保留已完成的點播列表；切集、換源和換畫質會通過 stop() 清除。
      if (task.isLive === false) this.parsedPlaylist = playlist;
    } else {
      this.emit(options, { state: 'running', message: undefined }, true);
    }

    const { task, cumulative } = playlist;

    const durationsUsable =
      task.durationSecond > 0 && cumulative[cumulative.length - 1] > 0;

    let queue: number[];

    if (durationsUsable) {
      const startIndex = indexAtTime(cumulative, options.currentTime);
      const fromIndex = indexAtTime(
        cumulative,
        Math.max(0, options.currentTime - lookBehind)
      );

      let endIndex = task.tsUrlList.length - 1;
      for (let i = startIndex; i < cumulative.length; i += 1) {
        if (cumulative[i] > horizonTime) {
          endIndex = i;
          break;
        }
      }

      this.windowFrom = Math.max(0, options.currentTime - lookBehind);
      this.windowTo = cumulative[endIndex] ?? cumulative[cumulative.length - 1];
      // 已排到播放列表最後一個片段，說明不存在"更遠但還沒緩存"的內容了
      this.reachedEnd = endIndex >= task.tsUrlList.length - 1;

      // 隊列順序：先前向（急），再回看（緩）
      queue = [];
      for (let i = startIndex; i <= endIndex; i += 1) queue.push(i);
      for (let i = startIndex - 1; i >= fromIndex; i -= 1) queue.push(i);
    } else {
      // 時長信息缺失：退化為"從頭往後預取"。設了時間上限時截斷到固定數量，
      // 無限模式則鋪滿整個列表（沒有時長信息無法按時間判斷終點）。
      const limit = unlimitedHorizon
        ? task.tsUrlList.length
        : Math.min(task.tsUrlList.length, FALLBACK_MAX_SEGMENTS);
      queue = [];
      for (let i = 0; i < limit; i += 1) queue.push(i);
      this.windowFrom = 0;
      this.windowTo = Number.MAX_SAFE_INTEGER;
      this.reachedEnd = limit >= task.tsUrlList.length;
    }

    if (durationsUsable) {
      const playableStart = Math.max(0, options.skipIntroSeconds || 0);
      const playableEnd = Math.max(
        0,
        cumulative[cumulative.length - 1] -
          Math.max(0, options.skipOutroSeconds || 0)
      );
      // 保留跨越邊界的分片，以免正文開頭/結尾缺少解碼數據。
      queue = queue.filter((index) => {
        const start = index === 0 ? 0 : cumulative[index - 1];
        return (
          playableEnd > playableStart &&
          cumulative[index] > playableStart &&
          start < playableEnd
        );
      });
    }

    void ensurePersistentStorage();

    const segmentKeys = task.tsUrlList.map((url, index) =>
      buildSegmentCacheKey(url, useProxy, task.segmentByteRanges?.[index])
    );
    const keyVariants = segmentKeys.map(getCacheKeyVariants);
    const relevantKeys = new Set(keyVariants.flat());
    const cachedSizes: Array<number | undefined> = Array(segmentKeys.length);
    const versions = Array(segmentKeys.length).fill(0);
    let cached = 0;
    let bytes = 0;
    let coverTo = 0;
    const updateSegmentStats = (index: number, size: number | undefined) => {
      const previous = cachedSizes[index];
      if (previous === size) return;
      if (previous !== undefined) {
        cached -= 1;
        bytes -= previous;
        coverTo -= task.segmentDurations[index] || 0;
      }
      cachedSizes[index] = size;
      if (size !== undefined) {
        cached += 1;
        bytes += size;
        coverTo += task.segmentDurations[index] || 0;
      }
    };
    const emitSegmentStats = (force = false) =>
      this.emit(
        options,
        { cached, bytes, coverTo, total: task.tsUrlList.length },
        force
      );
    let lastStatsAt = 0;
    let statsRefresh: Promise<void> | null = null;
    const refreshStats = async (force = false): Promise<void> => {
      if (statsRefresh) {
        await statsRefresh;
        if (!force) return;
      }
      if (
        signal.aborted ||
        (!force && Date.now() - lastStatsAt < STATS_REFRESH_INTERVAL_MS)
      )
        return;
      lastStatsAt = Date.now();
      statsRefresh = (async () => {
        const snapshotVersions = versions.slice();
        const records = await getCachedSegmentRecords();
        if (signal.aborted) return;
        const byKey = new Map<string, (typeof records)[number]>();
        for (let i = 0; i < records.length; i += 1) {
          for (const key of getCacheKeyVariants(records[i].key)) {
            if (relevantKeys.has(key)) byKey.set(key, records[i]);
          }
          if (i > 0 && i % 256 === 0) {
            await waitForRetry(0, signal);
          }
        }
        for (let i = 0; i < segmentKeys.length; i += 1) {
          const record = keyVariants[i]
            .map((key) => byKey.get(key))
            .find(Boolean);
          // Do not overwrite a segment committed while the snapshot was loading.
          if (versions[i] === snapshotVersions[i]) {
            updateSegmentStats(i, record?.bytes);
          }
          if (i > 0 && i % 256 === 0) {
            await waitForRetry(0, signal);
          }
          if (!record) continue;
          // 用當前播放列表補齊舊緩存的時間信息，無需重新下載。
          const startTime = i === 0 ? 0 : cumulative[i - 1];
          const endTime = cumulative[i];
          if (
            durationsUsable &&
            (record.startTime !== startTime || record.endTime !== endTime)
          ) {
            await metaStore.put({ ...record, startTime, endTime });
            if (signal.aborted) return;
          }
        }
        emitSegmentStats(force);
      })();
      try {
        await statsRefresh;
      } finally {
        statsRefresh = null;
      }
    };

    await refreshStats(true);
    if (signal.aborted) return;
    this.emit(options, { state: 'running', message: undefined }, true);

    let cursor = 0;
    let lastEvictAt = Date.now();
    /** 存儲配額耗盡：淘汰也騰不出空間，繼續拉分片只會白燒流量 */
    let storageFull = false;
    let accessError: string | undefined;
    const proxyOrigins = new Set<string>();
    const requests = new AbortController();
    const cancelRequests = () => requests.abort();
    signal.addEventListener('abort', cancelRequests, { once: true });
    if (signal.aborted) requests.abort();
    const denyAccess = (message: string) => {
      if (accessError || signal.aborted) return;
      accessError = message;
      this.accessDenied = true;
      requests.abort();
      this.setThrottled(false);
    };

    const worker = async (): Promise<void> => {
      while (!signal.aborted && !storageFull && !accessError) {
        await this.waitWhileThrottled(requests.signal);
        if (signal.aborted || accessError) return;

        const slot = cursor;
        cursor += 1;
        if (slot >= queue.length) return;

        const segmentIndex = queue[slot];
        const range = task.segmentByteRanges?.[segmentIndex];
        const directUrl = buildSegmentCacheKey(
          task.tsUrlList[segmentIndex],
          false
        );
        const origin = new URL(directUrl).origin;
        const cacheKey = buildSegmentCacheKey(
          task.tsUrlList[segmentIndex],
          useProxy,
          range
        );

        let releaseDownload: (() => void) | undefined;
        try {
          const alreadyCached = await hasCachedSegment(cacheKey);
          if (signal.aborted || accessError) return;
          if (alreadyCached) {
            await refreshStats();

            continue;
          }

          releaseDownload = await prefetchDownloadLimiter.acquire(
            requests.signal
          );
          const startedAt = Date.now();
          const loadSegment = (url: string) =>
            retrySegmentDownload(async () => {
              for (;;) {
                await this.waitWhileThrottled(requests.signal);
                if (requests.signal.aborted) {
                  throw new DOMException('Aborted', 'AbortError');
                }
                if (this.throttled) continue;
                const request = new AbortController();
                const cancel = () => request.abort();
                requests.signal.addEventListener('abort', cancel, {
                  once: true,
                });
                this.activeRequests.add(request);
                try {
                  const response = await fetch(url, {
                    signal: request.signal,
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: range
                      ? { Range: byteRangeHeader(range) }
                      : undefined,
                  });
                  if (!response.ok) {
                    await response.body?.cancel();
                    throw new Error(`HTTP ${response.status}`);
                  }
                  const expectedBytes = range
                    ? range.end - range.start
                    : Number(response.headers.get('Content-Length'));
                  if (Number.isFinite(expectedBytes) && expectedBytes > 0) {
                    observePrefetchSegment(expectedBytes);
                  }
                  const buffer = await readByteRangeResponse(response, range);
                  observePrefetchSegment(buffer.byteLength);
                  return { response, buffer };
                } catch (error) {
                  const interrupted =
                    request.signal.aborted && !requests.signal.aborted;
                  if (!interrupted) throw error;
                } finally {
                  this.activeRequests.delete(request);
                  requests.signal.removeEventListener('abort', cancel);
                }
                // Bandwidth yielding is not a download failure or a retry attempt.
              }
            }, requests.signal);
          const proxyUrl = buildSegmentCacheKey(
            task.tsUrlList[segmentIndex],
            true
          );
          const proxyPreferred = useProxy && proxyOrigins.has(origin);
          let segment: Awaited<ReturnType<typeof loadSegment>>;
          try {
            segment = await loadSegment(proxyPreferred ? proxyUrl : directUrl);
          } catch (error) {
            if (requests.signal.aborted) return;
            const reason =
              error instanceof Error ? error.message : '網絡請求失敗';
            if (proxyPreferred || !useProxy) {
              denyAccess(
                `${
                  proxyPreferred ? '代理' : '直連'
                }緩存下載失敗（${reason}），已重試 3 次，請更換播放源`
              );
              return;
            }
            // Prefer the browser's network; remember a successful proxy fallback
            // for this origin, without changing cache keys or byte-range headers.
            try {
              segment = await loadSegment(proxyUrl);
              proxyOrigins.add(origin);
            } catch (proxyError) {
              if (requests.signal.aborted) return;
              const proxyReason =
                proxyError instanceof Error
                  ? proxyError.message
                  : '網絡請求失敗';
              denyAccess(
                `直連失敗（${reason}），代理也失敗（${proxyReason}），均已重試 3 次，請更換播放源`
              );
              return;
            }
          }

          const { response, buffer } = segment;
          const costMs = Math.max(1, Date.now() - startedAt);

          if (signal.aborted || accessError) return;
          const releaseWrite = await prefetchWriteLimiter.acquire(
            requests.signal
          );
          try {
            const putResult = await putCachedSegmentResilient(
              cacheKey,
              buffer,
              response.headers.get('Content-Type'),
              settings,
              requests.signal
            );
            // 登出或取消後不得重新寫回私人元數據；新隊列會等待本輪結束。
            if (signal.aborted || requests.signal.aborted) return;
            if (putResult === 'quota') {
              storageFull = true;
              requests.abort();
              this.setThrottled(false);
              return;
            }
            if (putResult !== 'ok') continue;

            await metaStore.put({
              key: cacheKey,
              episodeKey: options.episodeKey,
              title: options.title || '未知影片',
              source: options.source || '未知來源',
              index: segmentIndex + 1,
              startTime: durationsUsable
                ? segmentIndex === 0
                  ? 0
                  : cumulative[segmentIndex - 1]
                : undefined,
              endTime: durationsUsable ? cumulative[segmentIndex] : undefined,
              bytes: buffer.byteLength,
              costMs,
              lastAccess: Date.now(),
            });
          } finally {
            releaseWrite();
          }

          if (signal.aborted || accessError) return;
          versions[segmentIndex] += 1;
          updateSegmentStats(segmentIndex, buffer.byteLength);
          emitSegmentStats();
          await refreshStats();
        } catch {
          // 單個片段失敗（含 abort）不影響整輪，繼續下一個
          if (signal.aborted || accessError) return;
        } finally {
          releaseDownload?.();
        }

        if (Date.now() - lastEvictAt > EVICT_INTERVAL_MS) {
          lastEvictAt = Date.now();
          await enforceQuota(settings);
          if (signal.aborted) return;
          await refreshStats(true);
        }
        // Break up fast cache writes instead of chaining an entire playlist in microtasks.
        if (cursor % 16 === 0) await waitForRetry(0, signal);
      }
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(concurrency, queue.length) }, worker)
      );
    } finally {
      signal.removeEventListener('abort', cancelRequests);
    }
    if (signal.aborted) return;

    await enforceQuota(settings);
    if (signal.aborted) return;
    await refreshStats(true);
    if (signal.aborted) return;
    if (accessError) {
      this.emit(options, { state: 'error', message: accessError }, true);
      return;
    }
    if (storageFull) {
      // 用 `error` 而不是 `done`：得讓 tooltip 原樣顯示這條 message，
      // 否則用戶只會看到計數器停在某一格，不知道是磁盤寫不進去了。
      this.emit(
        options,
        {
          state: 'error',
          message: `存儲空間已滿，緩存 ${this.stats.cached} 個片段後停止`,
        },
        true
      );
      return;
    }
    this.emit(
      options,
      { state: 'done', message: `已緩存 ${this.stats.cached} 個片段` },
      true
    );
  }
}

/** 全站單例：跨組件 / 跨路由復用同一份隊列，避免重復預取同一片段 */
let singleton: VideoPrefetcher | null = null;

export function getVideoPrefetcher(): VideoPrefetcher {
  if (!singleton) singleton = new VideoPrefetcher();
  return singleton;
}

/**
 * 「下一集預熱」專用實例（落地路線第 3 步）。
 *
 * **必須**與 `getVideoPrefetcher()` 分開：一個實例只有一條隊列和一個
 * `AbortController`，復用會把當前正在播的那一集的隊列打斷。
 *
 * 兩個實例寫的是同一個 Cache Storage 與 IndexedDB——緩存鍵由分片 URL 決定，
 * 所以預熱好的分片在真正切到下一集時會被 hls.js 直接命中。
 */
let nextEpisodeSingleton: VideoPrefetcher | null = null;

export function getNextEpisodePrefetcher(): VideoPrefetcher {
  if (!nextEpisodeSingleton) nextEpisodeSingleton = new VideoPrefetcher();
  return nextEpisodeSingleton;
}
