/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

/**
 * 播放頁純函數工具集合。
 *
 * 將不依賴 React 狀態/生命周期、可獨立測試的純邏輯從巨型播放頁中剝離，
 * 便於後續單元測試與復用。
 */

import { filterAdsFromM3U8WithStats } from '@/lib/m3u8-ad-filter';
import {
  type SegmentByteRange,
  normalizeByteRange,
} from '@/lib/video-byte-range';
import {
  buildSegmentCacheKey,
  DEFAULT_CACHE_SETTINGS,
  loadCacheSettings,
  readCachedSegment,
  recordSegmentProbe,
  touchMeta,
} from '@/lib/video-cache';

/** 切集後延遲恢復彈幕可見性的毫秒數 */
export const DANMAKU_VISIBLE_RESTORE_DELAY_MS = 1500;

/** 跳過片頭片尾配置結構 */
export interface SkipConfig {
  enable: boolean;
  intro_time: number;
  outro_time: number;
}

/**
 * 將秒數格式化為 00:00 或 00:00:00。
 */
export function formatTime(seconds: number): string {
  if (seconds === 0) return '00:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.round(seconds % 60);

  if (hours === 0) {
    // 不到一小時，格式為 00:00
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  } else {
    // 超過一小時，格式為 00:00:00
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }
}

/**
 * 去廣告：僅移除已確認的廣告，保留普通轉場及加密狀態。
 */
export function filterAdsFromM3U8(m3u8Content: string): string {
  return filterAdsFromM3U8WithStats(m3u8Content).content;
}

/**
 * 彈幕密度限制參數。
 *
 * 用時間補償的方式平滑削峰，避免硬窗口把某個時間段直接掏空。
 */
const DANMAKU_REFILL_RATE = 14 / 5;
const DANMAKU_BUCKET_CAPACITY = 28;
const DANMAKU_MAX_TOTAL = 8000;

function createDanmakuFilter() {
  let credits = DANMAKU_BUCKET_CAPACITY;
  let lastTime = -Infinity;
  let acceptedCount = 0;

  return (danmu: any) => {
    if (!danmu || typeof danmu !== 'object') return false;

    if (typeof danmu.text === 'string' && danmu.text.length > 100) {
      return false;
    }

    const rawTime =
      typeof danmu.time === 'number'
        ? danmu.time
        : typeof danmu.time === 'string'
        ? Number(danmu.time)
        : NaN;

    if (!Number.isFinite(rawTime)) {
      return true;
    }

    if (rawTime + 0.5 < lastTime) {
      credits = DANMAKU_BUCKET_CAPACITY;
      acceptedCount = 0;
      lastTime = rawTime;
    } else {
      const elapsed = Math.max(0, rawTime - lastTime);
      credits = Math.min(
        DANMAKU_BUCKET_CAPACITY,
        credits + elapsed * DANMAKU_REFILL_RATE
      );
      lastTime = rawTime;
    }

    if (acceptedCount >= DANMAKU_MAX_TOTAL) {
      return false;
    }

    if (credits < 1) {
      return false;
    }

    credits -= 1;
    acceptedCount += 1;
    return true;
  };
}

/**
 * 計算播放源綜合評分。
 *
 * 權重：分辨率 60% + 下載速度 30% + 網絡延遲 10%。
 *
 * 原則：**畫質優先，但慢源降權**——高分辨率源優先；速度作為同檔位內的
 * 打破平局（同樣 1080p 時選更快的），並把慢到會卡的源明顯壓低，避免
 * 選到"分辨率高但卡成 PPT"的源。
 */
export function calculateSourceScore(
  testResult: {
    quality: string;
    loadSpeed: string;
    pingTime: number;
  },
  maxSpeed: number,
  minPing: number,
  maxPing: number
): number {
  let score = 0;

  // 分辨率評分 (60% 權重) —— 畫質優先
  const qualityScore = (() => {
    switch (testResult.quality) {
      case '4K':
        return 100;
      case '2K':
        return 85;
      case '1080p':
        return 75;
      case '720p':
        return 60;
      case '480p':
        return 40;
      case 'SD':
        return 20;
      default:
        return 0;
    }
  })();
  score += qualityScore * 0.6;

  // 下載速度評分 (30% 權重) —— 達標加分 + 同檔打破平局
  const speedScore = (() => {
    const speedStr = testResult.loadSpeed;
    if (speedStr === '未知' || speedStr === '測量中...') return 30;

    // 解析速度值
    const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
    if (!match) return 30;

    const value = parseFloat(match[1]);
    const unit = match[2];
    const speedKBps = unit === 'MB/s' ? value * 1024 : value;

    // 基於最大速度線性映射，最高100分
    const speedRatio = speedKBps / maxSpeed;
    return Math.min(100, Math.max(0, speedRatio * 100));
  })();
  score += speedScore * 0.3;

  // 網絡延遲評分 (10% 權重) - 基於延遲范圍線性映射
  const pingScore = (() => {
    const ping = testResult.pingTime;
    if (ping <= 0) return 0; // 無效延遲給默認分

    // 如果所有延遲都相同，給滿分
    if (maxPing === minPing) return 100;

    // 線性映射：最低延遲=100分，最高延遲=0分
    const pingRatio = (maxPing - ping) / (maxPing - minPing);
    return Math.min(100, Math.max(0, pingRatio * 100));
  })();
  score += pingScore * 0.1;

  return Math.round(score * 100) / 100; // 保留兩位小數
}

/**
 * 創建彈幕插件的默認配置對象。
 *
 * 每次調用返回全新對象，避免多處共享同一引用導致狀態污染。
 */
export function createDanmakuDefaultConfig(): any {
  return {
    danmuku: '',
    speed: 5,
    margin: [10, '25%'],
    opacity: 1,
    color: '#FFFFFF',
    mode: 0,
    modes: [0, 1, 2],
    fontSize: 25,
    antiOverlap: true,
    synchronousPlayback: false,
    mount: undefined,
    heatmap: false,
    width: 512,
    points: [],
    filter: createDanmakuFilter(),
    beforeVisible: () => true,
    visible: true,
    emitter: false,
    maxLength: 200,
    lockTime: 5,
    theme: 'dark',
    OPACITY: {},
    FONT_SIZE: {},
    MARGIN: {},
    SPEED: {},
    COLOR: [],
    beforeEmit(_danmu: any) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(true);
        }, 1000);
      });
    },
  };
}

/** 彈幕設置本地存儲鍵 */
export const DANMAKU_SETTINGS_STORAGE_KEY = 'danmaku_settings';

/**
 * 可持久化到本地的彈幕設置字段。
 *
 * 僅包含用戶可調的展示類設置，不包含 danmuku 地址、mount 等運行時字段。
 */
export interface DanmakuSettings {
  /** 彈幕是否可見 */
  visible: boolean;
  /** 不透明度，范圍 [0, 1] */
  opacity: number;
  /** 字號（像素） */
  fontSize: number;
  /** 彈幕速度，范圍 [1, 10] */
  speed: number;
  /** 顯示區域 [上邊距, 下邊距] */
  margin: [number | string, number | string];
  /** 發送彈幕的模式：0-滾動，1-頂部，2-底部 */
  mode: number;
  /** 可見的彈幕模式列表 */
  modes: number[];
  /** 是否防止彈幕重疊 */
  antiOverlap: boolean;
  /** 是否同步視頻速度 */
  synchronousPlayback: boolean;
  /** 默認彈幕顏色 */
  color: string;
}

/** 將數值限制在 [min, max] 區間內，非法值返回 undefined */
function clampNumber(
  value: unknown,
  min: number,
  max: number
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

/** 校驗彈幕上下邊距（支持像素數字與百分比字符串） */
function normalizeMargin(
  value: unknown
): [number | string, number | string] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;

  const normalizeEdge = (edge: unknown): number | string | undefined => {
    if (typeof edge === 'number' && Number.isFinite(edge)) return edge;
    if (typeof edge === 'string' && /^\d+(\.\d+)?%$/.test(edge)) return edge;
    return undefined;
  };

  const top = normalizeEdge(value[0]);
  const bottom = normalizeEdge(value[1]);
  if (top === undefined || bottom === undefined) return undefined;

  return [top, bottom];
}

/**
 * 從（可能不完整或不可信的）彈幕配置對象中提取可持久化的設置字段。
 *
 * 同時用於寫入前的字段提取與讀取後的數據校驗，避免髒數據注入播放器配置。
 */
export function pickDanmakuSettings(config: any): Partial<DanmakuSettings> {
  const result: Partial<DanmakuSettings> = {};
  if (!config || typeof config !== 'object') return result;

  if (typeof config.visible === 'boolean') result.visible = config.visible;

  const opacity = clampNumber(config.opacity, 0, 1);
  if (opacity !== undefined) result.opacity = opacity;

  const fontSize = clampNumber(config.fontSize, 12, 120);
  if (fontSize !== undefined) result.fontSize = fontSize;

  const speed = clampNumber(config.speed, 1, 10);
  if (speed !== undefined) result.speed = speed;

  const margin = normalizeMargin(config.margin);
  if (margin) result.margin = margin;

  const mode = clampNumber(config.mode, 0, 2);
  if (mode !== undefined) result.mode = Math.round(mode);

  if (Array.isArray(config.modes)) {
    const modes = config.modes.filter(
      (m: unknown): m is number =>
        typeof m === 'number' && Number.isFinite(m) && m >= 0 && m <= 2
    );
    result.modes = Array.from(new Set(modes));
  }

  if (typeof config.antiOverlap === 'boolean') {
    result.antiOverlap = config.antiOverlap;
  }

  if (typeof config.synchronousPlayback === 'boolean') {
    result.synchronousPlayback = config.synchronousPlayback;
  }

  if (typeof config.color === 'string' && config.color) {
    result.color = config.color;
  }

  return result;
}

/**
 * 讀取本地保存的彈幕設置（含校驗），無有效數據時返回空對象。
 */
export function loadDanmakuSettings(): Partial<DanmakuSettings> {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(DANMAKU_SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    return pickDanmakuSettings(JSON.parse(raw));
  } catch {
    return {};
  }
}

/**
 * 將彈幕設置寫入本地存儲。
 *
 * 默認與已有設置合並，便於只更新部分字段；replace 為 true 時整體覆蓋。
 */
export function saveDanmakuSettings(
  settings: Partial<DanmakuSettings>,
  options: { replace?: boolean } = {}
): void {
  if (typeof window === 'undefined') return;

  try {
    const merged = options.replace
      ? settings
      : { ...loadDanmakuSettings(), ...settings };
    window.localStorage.setItem(
      DANMAKU_SETTINGS_STORAGE_KEY,
      JSON.stringify(merged)
    );
  } catch {
    // localStorage 不可用（如隱私模式）時靜默失敗，不影響播放
  }
}

/**
 * 創建彈幕插件初始配置：默認配置疊加本地已保存的設置，刷新後可自動恢復。
 */
export function createDanmakuInitialConfig(): any {
  return {
    ...createDanmakuDefaultConfig(),
    ...loadDanmakuSettings(),
  };
}

export interface AdFilterReport {
  removedSegments: number;
  removedSeconds: number;
  preservedReason?: 'multiple-renditions';
}

export function readAdFilterReport(content: string): AdFilterReport | null {
  const raw = content.match(/^#MOONTV-AD-FILTER:(.+)$/m)?.[1];
  if (!raw) return null;
  try {
    const report = JSON.parse(raw);
    if (
      !Number.isSafeInteger(report.removedSegments) ||
      report.removedSegments < 0 ||
      !Number.isFinite(report.removedSeconds) ||
      report.removedSeconds < 0
    )
      return null;
    return {
      removedSegments: report.removedSegments,
      removedSeconds: report.removedSeconds,
      ...(report.preservedReason === 'multiple-renditions'
        ? { preservedReason: 'multiple-renditions' as const }
        : {}),
    };
  } catch {
    return null;
  }
}

function isFilteredProxyUrl(url: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const target = new URL(url, window.location.origin);
    return (
      target.origin === window.location.origin &&
      target.pathname === '/api/m3u8/filter'
    );
  } catch {
    return false;
  }
}

export interface HlsLoaderOptions {
  onAdFilter?: (report: AdFilterReport) => void;
  /** 僅移除經可靠標記或已核實素材確認的廣告，保留一般轉場。 */
  blockAd?: boolean;
  /** 片段緩存鍵是否走同源代理，必須與 VideoPrefetcher 保持一致 */
  useProxy?: boolean;
  /** 緩存診斷回調（命中/未命中），用於觀測緩存鍵是否與預取器一致 */
  onProbe?: (hit: boolean) => void;
}

/**
 * 合成 hls.js 的 LoaderStats。
 *
 * 關鍵點：命中緩存時不能上報"耗時 0"。hls.js 的 ABR 用 EWMA 估算帶寬，
 * 0 延遲會被當成無限帶寬，導致下一批片段直接判到最高碼率而卡頓。
 * 這裡復用預取時記錄的真實耗時，讓帶寬估算保持連續。
 */
function buildCachedStats(
  costMs: number,
  bytes: number
): Record<string, unknown> {
  const end = performance.now();
  const span = Math.max(1, costMs);
  const start = end - span;
  const zero = { start: 0, first: 0, end: 0 };
  return {
    aborted: false,
    loaded: bytes,
    retry: 0,
    total: bytes,
    chunkCount: 1,
    bwEstimate: (bytes / span) * 8000,
    loading: { start, first: start + span * 0.6, end },
    parsing: { ...zero },
    buffering: { ...zero },
  };
}

/**
 * 創建「去廣告 + 緩存優先」的 HLS Loader。
 *
 * - manifest / level：按需套用保守廣告過濾，保留加密與片段狀態
 * - fragment：先查 Cache Storage（由 VideoPrefetcher 預取填充），命中直接返回，
 *   未命中再走原 loader 回源。因此緩存未命中時行為與默認 loader 完全一致。
 */
export function createCustomHlsLoader(
  Hls: any,
  options: HlsLoaderOptions = {}
): any {
  const BaseLoader = Hls.DefaultConfig.loader;
  const useAdFilter = options.blockAd !== false;
  const onProbe = options.onProbe ?? recordSegmentProbe;

  /**
   * 構建候選緩存鍵列表（按可能性先後排序）。
   *  - 不再信任創建時快照的 useProxy：設置面板裡切開關後，loader 和預取器
   *    用的 format 可能不統一，因此兩種 format 都生成，逐個試。
   *  - 再疊加 readCachedSegment 內部的「相對路徑/絕對 URL」雙重兜底，
   *    基本能覆蓋所有 key 不一致的情況。
   */
  function candidateCacheKeys(
    contextUrl: string,
    range?: SegmentByteRange
  ): string[] {
    const liveSettings =
      typeof window !== 'undefined'
        ? loadCacheSettings()
        : DEFAULT_CACHE_SETTINGS;
    const preferredUseProxy =
      options.useProxy !== undefined ? options.useProxy : liveSettings.useProxy;
    const urls = new Set<string>();
    // 優先按當前偏好的 useProxy 生成，其次反過來兜底
    urls.add(buildSegmentCacheKey(contextUrl, preferredUseProxy, range));
    urls.add(buildSegmentCacheKey(contextUrl, !preferredUseProxy, range));
    return Array.from(urls);
  }

  return class MoontvHlsLoader extends BaseLoader {
    constructor(config: any) {
      super(config);
      const baseLoad = this.load.bind(this);
      const baseAbort =
        typeof this.abort === 'function' ? this.abort.bind(this) : null;
      const baseDestroy =
        typeof this.destroy === 'function' ? this.destroy.bind(this) : null;

      // 基類是 any，成員無法直接推斷，這裡做一次顯式斷言。
      // `stats` 是 hls.js 內部讀取帶寬估算的來源，必須就地更新。
      const self = this as unknown as {
        stats: Record<string, unknown>;
        context?: unknown;
      };

      // 緩存查詢是異步的：若期間 hls.js 取消了這次加載（seek / 切碼率 /
      // 組件卸載），必須讓後續的 onSuccess 與回源請求同時失效，
      // 否則會發出一個沒人接收的網絡請求。
      let generation = 0;

      this.abort = function () {
        generation += 1;
        baseAbort?.();
      };

      this.destroy = function () {
        generation += 1;
        baseDestroy?.();
      };

      this.load = function (context: any, cfg: any, callbacks: any) {
        const loadGeneration = ++generation;
        self.context = context;
        // hls.js 不同版本 loader 調用約定不一致，type/url 可能在 context 或 cfg 上：
        //   - type: manifest / level / fragment
        //   - url / uri: 實際請求地址
        // 這裡做一次健壯的字段探測。
        const rawType =
          (context && typeof context.type === 'string'
            ? context.type
            : undefined) ??
          (cfg && typeof cfg.type === 'string' ? cfg.type : undefined);
        const rawUrl =
          (context &&
          (typeof context.url === 'string' || typeof context.uri === 'string')
            ? context.url || context.uri
            : undefined) ??
          (cfg && (typeof cfg.url === 'string' || typeof cfg.uri === 'string')
            ? cfg.url || cfg.uri
            : undefined);
        const rangeStart = context?.rangeStart ?? cfg?.rangeStart;
        const rangeEnd = context?.rangeEnd ?? cfg?.rangeEnd;
        const type: string | undefined = rawType as any;
        const url = typeof rawUrl === 'string' ? rawUrl : '';

        // ① 文本播放列表：去廣告
        if (type === 'manifest' || type === 'level') {
          if (useAdFilter) {
            const onSuccess = callbacks.onSuccess;
            callbacks.onSuccess = function (
              response: any,
              stats: any,
              ctx: any
            ) {
              if (response.data && typeof response.data === 'string') {
                const isMedia = /^#EXTINF:/m.test(response.data);
                if (isFilteredProxyUrl(ctx.url)) {
                  // The server already transformed the playlist. Do not run heuristics twice.
                  const report = readAdFilterReport(response.data);
                  if (isMedia && report) options.onAdFilter?.(report);
                } else {
                  const filtered = filterAdsFromM3U8WithStats(response.data);
                  response.data = filtered.content;
                  if (isMedia)
                    options.onAdFilter?.({
                      removedSegments: filtered.droppedSegments,
                      removedSeconds: filtered.droppedDuration || 0,
                    });
                }
              }
              return onSuccess(response, stats, ctx, null);
            };
          }
          baseLoad(context, cfg, callbacks);
          return;
        }

        // ② 片段：緩存優先
        //    - 有效的 [rangeStart, rangeEnd) 使用獨立緩存鍵，包含從 0 開始的區間。
        //      rangeEnd=0 / undefined 是 hls.js 的整文件哨兵，不應誤判。
        //    - 沒有明確 type 時：用 URL 後綴/關鍵詞啟發式判斷是不是視頻/音頻分片。
        const looksLikeFragment =
          /\.(ts|m4s|m4v|mp4|webm|aac|mp3)(\?|$)/i.test(url) ||
          /segment|fragment|clip|part|chunk|frag|plist/i.test(url);
        const treatAsFragment =
          type === 'fragment' ||
          (context?.frag && context.responseType === 'arraybuffer') ||
          (!type && looksLikeFragment);
        const range = normalizeByteRange(rangeStart, rangeEnd);
        const invalidRange = !range && (rangeStart > 0 || rangeEnd > 0);

        if (!treatAsFragment || invalidRange || typeof caches === 'undefined') {
          baseLoad(context, cfg, callbacks);
          return;
        }

        // 候選緩存鍵按 (useProxy=true/false) × (相對路徑/絕對URL) 生成，
        // 任何一個命中就算命中，解決設置切換 / 瀏覽器自動補全 origin 導致的不匹配。
        const keys = candidateCacheKeys(url, range);

        (async () => {
          for (const cacheKey of keys) {
            const res = await readCachedSegment(cacheKey);
            if (loadGeneration !== generation) return;
            if (!res) continue;

            const { fragment, matchedKey } = res;

            onProbe(true);
            void touchMeta(matchedKey);

            // 就地更新基礎類的 stats，避免 hls.js 帶寬估算失真
            const stats = buildCachedStats(
              fragment.costMs,
              fragment.data.byteLength
            );
            Object.assign(self.stats, stats);

            callbacks.onSuccess(
              { url: context.url, data: fragment.data },
              self.stats,
              context
            );
            return;
          }

          // 所有候選鍵都沒命中 → 走網絡
          if (loadGeneration !== generation) return;
          onProbe(false);
          baseLoad(context, cfg, callbacks);
        })().catch(() => {
          if (loadGeneration === generation) baseLoad(context, cfg, callbacks);
        });
      };
    }
  };
}
