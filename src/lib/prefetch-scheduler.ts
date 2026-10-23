import { CACHE_CONCURRENCY_PRESETS } from './video-cache';

/** Abortable slots shared by current-episode prefetch and next-episode warmup. */
export class PrefetchLimiter {
  private active = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly limit: () => number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (this.active < this.limit()) {
        this.active += 1;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          this.active -= 1;
          this.wake();
        };
      }
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          signal.removeEventListener('abort', onAbort);
          this.waiters = this.waiters.filter((waiter) => waiter !== onReady);
        };
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onAbort = () => {
          cleanup();
          reject(new DOMException('Aborted', 'AbortError'));
        };
        this.waiters.push(onReady);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    }
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((resolve) => resolve());
  }

  /**
   * 額度被調大後主動喚醒排隊任務。
   *
   * 否則只有在"某個在途任務釋放"時才會重新檢查上限，新開的高並發設置
   * 要等下一批下載結束才生效。`wake()` 喚醒後每個任務都會重新校驗，
   * 仍然超限的會重新排隊，所以多喚醒是安全的。
   */
  notifyLimitChanged(): void {
    if (this.waiters.length > 0 && this.active < this.limit()) this.wake();
  }
}

/**
 * 並發上限：直接取緩存設置裡的最高檔。
 *
 * 設置界面只提供低/中/高三檔，調度器不再有獨立的"自定義並發"概念；
 * 預熱這類低優先級隊列可以傳更小的值（1），但不會超過最高檔。
 */
export const MAX_PREFETCH_CONCURRENCY = CACHE_CONCURRENCY_PRESETS.high;

/**
 * 在途分片的總內存預算（下載中的 Buffer + 待寫入隊列）。
 *
 * 依據采集站的真實分布（分片 0.5–5 MB，高碼 1080p/4K 到 8–12 MB）反推：
 *
 * - 桌面 96 MiB = 最高檔 8 路 × 12 MiB，保證正常分片永遠跑滿檔位；
 * - 弱設備減半 48 MiB = 8 路 × 6 MiB，覆蓋移動端 1080p 的典型分片。
 *
 * 只有單分片超過 12 MiB（桌面）/ 6 MiB（弱設備）時，才會按內存收斂並發。
 */
const IN_FLIGHT_BYTES = 96 * 1024 * 1024;
const CONSTRAINED_IN_FLIGHT_BYTES = 48 * 1024 * 1024;

/** 把任意輸入收斂成 [1, 最高檔] 的整數；非法輸入回落到低檔（默認設置） */
export function clampPrefetchConcurrency(value: unknown): number {
  const rounded =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.round(value)
      : CACHE_CONCURRENCY_PRESETS.low;
  return Math.max(1, Math.min(MAX_PREFETCH_CONCURRENCY, rounded));
}

/**
 * 二等消費者（下一集預熱）的並發：取用戶檔位的一半，至少 1 路。
 *
 * 預熱只在當前集視野鋪滿後啟動，但播放器仍在跑——seek、ABR 換檔、hls.js
 * 重取分片都要搶帶寬，所以不直接用整檔。共享下載額度
 * （`prefetchDownloadLimiter`）仍按檔位封頂，因此這裡的值只決定預熱
 * 自己派發幾個 worker，兩輪之和不會超過檔位。
 *
 * 采集站單連接通常被限速在 1–5 MB/s，`tier / 2` 讓預熱在 7 分鐘（約 87 個
 * 分片 / 262 MB）內能在 30 s 量級鋪完，同時給播放留出至少一半帶寬。
 */
export function getWarmupConcurrency(tier: number): number {
  return Math.max(1, Math.floor(clampPrefetchConcurrency(tier) / 2));
}

function isConstrainedDevice(): boolean {
  const nav =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & {
          deviceMemory?: number;
          connection?: { effectiveType?: string };
        });
  return (
    (nav?.deviceMemory !== undefined && nav.deviceMemory <= 4) ||
    (nav?.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 4) ||
    nav?.connection?.effectiveType === '3g'
  );
}

/**
 * 並發額度 = `min(檔位, 內存預算 ÷ 單分片估算)`。
 *
 * 內存只是兜底，不是日常參數：分片按采集站中位數 5 MB 算，
 * `96 MiB ÷ 5 MiB = 19`，遠高於最高檔 8，所以**檔位就是實際並發**。
 * 只有 4K 長 GOP（>12 MB/片）或 byte-range 大區間才會被壓低。
 *
 * 不傳 `requested`（沒有活躍預取輪次）時按低檔計算。
 */
export function getPrefetchLimit(
  segmentBytes: number,
  requested?: number
): number {
  const ceiling = clampPrefetchConcurrency(
    requested ?? CACHE_CONCURRENCY_PRESETS.low
  );
  const workingSet = isConstrainedDevice()
    ? CONSTRAINED_IN_FLIGHT_BYTES
    : IN_FLIGHT_BYTES;
  return Math.max(
    1,
    Math.min(ceiling, Math.floor(workingSet / Math.max(1, segmentBytes)))
  );
}

/** 估算的上下限，避免異常緩存條目或首片把並發算歪 */
const MIN_SEGMENT_BYTES = 1.5 * 1024 * 1024;
const MAX_SEGMENT_BYTES = 64 * 1024 * 1024;
/** 新樣本權重：能跟隨當前劇集，又不被單片抖動帶偏 */
const SEGMENT_SAMPLE_WEIGHT = 0.4;

/** 初值取 1080p 的常見分片大小 */
let estimatedSegmentBytes = 4 * 1024 * 1024;

/**
 * 用 EWMA 跟蹤當前播放列表的分片大小。
 *
 * 舊實現是 `max(4MB, bytes, prev * 0.9)`——只漲不跌：遇到一次 4K 大分片後，
 * 即使切回 1080p 源，估算仍停在十幾 MB，後續劇集的並發被白白壓低。
 * EWMA 會在幾個分片內回到當前源的真實水平。
 */
export function observePrefetchSegment(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  const sample = Math.min(
    MAX_SEGMENT_BYTES,
    Math.max(MIN_SEGMENT_BYTES, bytes)
  );
  estimatedSegmentBytes =
    estimatedSegmentBytes * (1 - SEGMENT_SAMPLE_WEIGHT) +
    sample * SEGMENT_SAMPLE_WEIGHT;
}

/**
 * 當前活躍預取輪次裡最大的並發需求。
 *
 * 「當前集」與「下一集預熱」共用一個下載額度，取最大值而不是各自的值：
 * 每輪自己的 worker 數量已經限制了自己的並發，額度只要不低於其中最大的
 * 一輪即可，否則用戶設的高檔會被預熱那一輪的默認值壓回去。
 */
const concurrencyDemands = new Map<number, number>();

function demandedPrefetchConcurrency(): number {
  let max = 0;
  concurrencyDemands.forEach((_count, demand) => {
    if (demand > max) max = demand;
  });
  return max;
}

export const prefetchDownloadLimiter = new PrefetchLimiter(() => {
  const demand = demandedPrefetchConcurrency();
  return demand > 0
    ? getPrefetchLimit(estimatedSegmentBytes, demand)
    : getPrefetchLimit(estimatedSegmentBytes);
});
export const prefetchWriteLimiter = new PrefetchLimiter(() => 1);

/** 登記一輪預取的並發數，返回注銷函數（同步額度並喚醒排隊任務） */
export function registerPrefetchConcurrency(value: unknown): () => void {
  const demand = clampPrefetchConcurrency(value);
  concurrencyDemands.set(demand, (concurrencyDemands.get(demand) ?? 0) + 1);
  prefetchDownloadLimiter.notifyLimitChanged();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (concurrencyDemands.get(demand) ?? 0) - 1;
    if (remaining > 0) concurrencyDemands.set(demand, remaining);
    else concurrencyDemands.delete(demand);
  };
}

/** Hysteresis avoids repeatedly stopping/restarting requests near the threshold. */
export function shouldThrottlePrefetch(
  video: Pick<
    HTMLVideoElement,
    | 'paused'
    | 'seeking'
    | 'currentTime'
    | 'duration'
    | 'playbackRate'
    | 'buffered'
  >,
  wasThrottled: boolean
): boolean {
  if (video.seeking) return true;
  if (video.paused) return false;
  let ahead = 0;
  for (let i = 0; i < video.buffered.length; i += 1) {
    if (
      video.buffered.start(i) <= video.currentTime &&
      video.buffered.end(i) > video.currentTime
    ) {
      ahead = video.buffered.end(i) - video.currentTime;
      break;
    }
  }
  if (
    Number.isFinite(video.duration) &&
    video.duration > 0 &&
    ahead > 0 &&
    video.currentTime + ahead >= video.duration - 0.25
  ) {
    return false;
  }
  const playbackSeconds = ahead / Math.max(0.1, video.playbackRate);
  return playbackSeconds < (wasThrottled ? 15 : 5);
}
