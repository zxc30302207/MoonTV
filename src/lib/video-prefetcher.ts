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
  type CacheSettings,
  buildSegmentCacheKey,
  enforceQuota,
  ensurePersistentStorage,
  hasCachedSegment,
  loadCacheSettings,
  metaStore,
  putCachedSegmentResilient,
  touchMeta,
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
  /** 本輪計劃片段數 */
  total: number;
  /** 本輪寫入字節數 */
  bytes: number;
  /** 緩存已覆蓋到的播放時間（秒），可直接 formatTime 展示 */
  coverTo: number;
  message?: string;
}

export interface PrefetchOptions {
  m3u8Url: string;
  /** Keep the cached timeline consistent with the player ad-filter toggle. */
  blockAd?: boolean;
  /** 當前播放位置（秒） */
  currentTime: number;
  /** 劇集標識，用於分集統計與淘汰 */
  episodeKey: string;
  /** 覆蓋 settings.horizonSeconds */
  horizonSeconds?: number;
  /** 回看保護時長（秒），默認 30 */
  lookBehindSeconds?: number;
  /** 並發數，默認 3（上限 4）：並發太高會搶播放的帶寬 */
  concurrency?: number;
  /** 覆蓋 settings.useProxy */
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

/** 淘汰檢查間隔 */
const EVICT_INTERVAL_MS = 15_000;

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
  private episodeKey: string | null = null;
  private playlistUrl: string | null = null;
  private blockAd = true;
  private useProxy = true;
  /** 本輪隊列使用的碼率檔位（畫面高度），null 表示"最高帶寬" */
  private preferredHeight: number | null = null;
  /** 當前已排入隊列的覆蓋區間 [windowFrom, windowTo]（秒） */
  private windowFrom = 0;
  private windowTo = 0;
  /** 隊列已覆蓋到播放列表末尾：此時無論請求多大視野都無事可做 */
  private reachedEnd = false;
  private throttled = false;
  private resumeWaiters: Array<() => void> = [];
  private stats: PrefetchStats = { ...IDLE_STATS };
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

    // 隊列已經覆蓋到播放列表末尾，且當前播放位置落在已覆蓋區間內：
    // 再叫也不會多出可緩存的片段。
    // 必須先短路，否則下面"窗口夠不夠大"的判斷在短播放列表上永不成立，
    // 會導致每次 ensure 都重啟一輪隊列。
    // 注意要帶上"位置在覆蓋區間內"這一條：末尾覆蓋 + 向後拖進度條 仍然需要重建隊列。
    if (
      sameEpisode &&
      sameVariant &&
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
      this.controller !== null &&
      !this.controller.signal.aborted &&
      options.currentTime + 60 < this.windowTo &&
      this.windowTo + 60 >= requestedTo &&
      options.currentTime >= this.windowFrom;

    if (windowStillUseful) {
      this.emit(options, this.stats);
      return;
    }

    this.stop();
    const controller = new AbortController();
    this.controller = controller;
    this.episodeKey = options.episodeKey;
    this.playlistUrl = options.m3u8Url;
    this.blockAd = blockAd;
    this.useProxy = useProxy;
    this.preferredHeight = preferredHeight;

    // 先寫入近似窗口邊界，讓窗口判斷在 run() 完成解析前就生效。
    // 否則解析期間（await parseM3U8）連續的 ensure 調用會反復重啟隊列。
    // run() 拿到真實片段時長後會覆蓋為精確值。
    this.windowFrom = Math.max(
      0,
      options.currentTime - (options.lookBehindSeconds ?? 30)
    );
    this.windowTo = requestedTo;

    void this.run(options, settings, controller.signal);
  }

  /** 完整停止並重置（切集、換源、卸載時調用） */
  stop(): void {
    this.controller?.abort();
    this.controller = null;
    this.episodeKey = null;
    this.playlistUrl = null;
    this.windowFrom = 0;
    this.windowTo = 0;
    this.reachedEnd = false;
    this.throttled = false;

    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    waiters.forEach((resolve) => resolve());

    this.stats = { ...IDLE_STATS };
  }

  /**
   * 播放出現 stall 時讓出帶寬，恢復後解除。
   * 這不是"暫停視頻就停緩存"。
   */
  setThrottled(value: boolean): void {
    this.throttled = value;
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
      this.resumeWaiters.push(resolve);
    });
  }

  private emit(
    options: PrefetchOptions,
    patch: Partial<PrefetchStats>,
    force = false
  ): void {
    this.stats = { ...this.stats, ...patch };
    const now = Date.now();
    if (!force && now - this.lastEmitAt < EMIT_INTERVAL_MS) return;
    this.lastEmitAt = now;
    options.onProgress?.(this.stats);
  }

  private async run(
    options: PrefetchOptions,
    settings: CacheSettings,
    signal: AbortSignal
  ): Promise<void> {
    const emit = (patch: Partial<PrefetchStats>, force = false) => {
      if (!signal.aborted) this.emit(options, patch, force);
    };
    const useProxy = options.useProxy ?? settings.useProxy;
    const concurrency = Math.max(1, Math.min(4, options.concurrency ?? 3));
    const lookBehind = Math.max(0, options.lookBehindSeconds ?? 30);

    const horizonSeconds = options.horizonSeconds ?? settings.horizonSeconds;
    /** 時間上限關閉時隊列鋪到片尾，此時唯一的兜底是字節上限 + LRU 淘汰 */
    const unlimitedHorizon = !(horizonSeconds > 0);
    const horizonTime = horizonEndTime(options.currentTime, horizonSeconds);

    emit({ state: 'parsing', cached: 0, total: 0, bytes: 0, coverTo: 0 }, true);

    let task: Awaited<ReturnType<typeof parseM3U8>>;
    try {
      // 檔位透傳給解析器：主播放列表有多個碼率時只取與當前播放一致的那一檔
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
              isFilterEndpoint(url) ? url : buildSegmentCacheKey(url, useProxy),
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
      this.controller = null; // 置空後下一次 ensure() 會重建隊列重試
      emit({ state: 'error', message: '播放列表解析失敗' }, true);
      return;
    }
    if (signal.aborted) return;

    if (task.tsUrlList.length === 0) {
      this.controller = null;
      emit({ state: 'error', message: '播放列表為空' }, true);
      return;
    }

    // EXT-X-BYTERANGE 場景下多個片段共用同一 URL，URL 不能作為緩存鍵。
    // 支持它需要把 (url, rangeStart, rangeEnd) 一起編碼進 key，此處直接降級。
    if (new Set(task.tsUrlList).size !== task.tsUrlList.length) {
      this.controller = null;
      emit(
        {
          state: 'error',
          message: '該播放列表使用字節范圍分片，暫不支持預緩存',
        },
        true
      );
      return;
    }

    const cumulative = toCumulative(task.segmentDurations);
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

    if (queue.length === 0) {
      emit({ state: 'done', message: '沒有需要預取的片段' }, true);
      return;
    }

    void ensurePersistentStorage();

    emit(
      {
        state: 'running',
        total: queue.length,
        cached: 0,
        bytes: 0,
        coverTo: 0,
        message: undefined,
      },
      true
    );

    let cursor = 0;
    let cached = 0;
    let bytes = 0;
    let maxCachedIndex = -1;
    let lastEvictAt = Date.now();
    /** 存儲配額耗盡：淘汰也騰不出空間，繼續拉分片只會白燒流量 */
    let storageFull = false;

    const worker = async (): Promise<void> => {
      while (!signal.aborted && !storageFull) {
        await this.waitWhileThrottled(signal);
        if (signal.aborted) return;

        const slot = cursor;
        cursor += 1;
        if (slot >= queue.length) return;

        const segmentIndex = queue[slot];
        const cacheKey = buildSegmentCacheKey(
          task.tsUrlList[segmentIndex],
          useProxy
        );

        try {
          const cacheHit = await hasCachedSegment(cacheKey);
          if (signal.aborted) return;
          if (cacheHit) {
            cached += 1;
            if (segmentIndex > maxCachedIndex) maxCachedIndex = segmentIndex;
            void touchMeta(cacheKey);
            emit({
              cached,
              coverTo: durationsUsable ? cumulative[maxCachedIndex] ?? 0 : 0,
            });
            continue;
          }

          const startedAt = Date.now();
          const response = await fetch(cacheKey, {
            signal,
            credentials: 'same-origin',
            cache: 'no-store',
          });
          if (signal.aborted) return;
          if (!response.ok) {
            emit({
              message: `片段 ${segmentIndex + 1} 預取失敗 ${response.status}`,
            });
            continue;
          }

          const buffer = await response.arrayBuffer();
          if (signal.aborted) return;
          const costMs = Math.max(1, Date.now() - startedAt);

          const putResult = await putCachedSegmentResilient(
            cacheKey,
            buffer,
            response.headers.get('Content-Type'),
            settings,
            signal
          );
          if (signal.aborted) return;
          if (putResult === 'quota') {
            storageFull = true;
            return;
          }
          if (putResult !== 'ok') continue;

          await metaStore.put({
            key: cacheKey,
            episodeKey: options.episodeKey,
            index: segmentIndex + 1,
            bytes: buffer.byteLength,
            costMs,
            lastAccess: Date.now(),
          });

          if (signal.aborted) return;
          cached += 1;
          bytes += buffer.byteLength;
          if (segmentIndex > maxCachedIndex) maxCachedIndex = segmentIndex;

          emit({
            cached,
            bytes,
            coverTo: durationsUsable ? cumulative[maxCachedIndex] ?? 0 : 0,
          });
        } catch {
          // 單個片段失敗（含 abort）不影響整輪，繼續下一個
          if (signal.aborted) return;
        }

        if (Date.now() - lastEvictAt > EVICT_INTERVAL_MS) {
          lastEvictAt = Date.now();
          void enforceQuota(settings);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, queue.length) }, worker)
    );
    if (signal.aborted) return;

    void enforceQuota(settings);
    if (storageFull) {
      // 用 `error` 而不是 `done`：得讓 tooltip 原樣顯示這條 message，
      // 否則用戶只會看到計數器停在某一格，不知道是磁盤寫不進去了。
      emit(
        {
          state: 'error',
          message: `存儲空間已滿，緩存 ${cached} 個片段後停止`,
        },
        true
      );
      return;
    }
    emit({ state: 'done', message: `已緩存 ${cached} 個片段` }, true);
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
