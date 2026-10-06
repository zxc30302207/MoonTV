/**
 * HLS 播放錯誤恢復策略（P1-5）。
 *
 * 解決的問題：原實現遇到致命錯誤就無條件 `hls.startLoad()`，
 * 源站掛掉時會形成無限重試風暴，而且永遠不會換源。
 *
 * 本模塊**只做決策，不碰 hls 實例**。調用方拿到 {@link RecoveryDecision}
 * 後自行執行（含延時），這樣策略可以獨立單測，也便於在 UI 上給出提示。
 *
 * 計數語義："連續失敗次數"——收到 `FRAG_LOADED`（無論來自網絡還是本項目
 * 的片段緩存）即視為播放鏈路已恢復，計數歸零。因此偶發抖動不會被誤判為
 * "源已死"，而源站徹底掛掉時計數會持續累積並最終觸發換源。
 */

/** hls.js 的 ErrorTypes 常量值，這裡用字面量避免靜態引入 hls.js */
export const HLS_ERROR_NETWORK = 'networkError';
export const HLS_ERROR_MEDIA = 'mediaError';

/**
 * 這些致命錯誤重試沒有意義（格式/編碼層面的硬失敗），直接換源。
 * `manifestLoadError` / `manifestLoadTimeOut` 不在其中——網絡抖動值得退避重試。
 */
const HARD_FAIL_DETAILS = new Set([
  'manifestParsingError',
  'manifestIncompatibleCodecsError',
  'levelEmptyError',
]);

export interface RecoveryPolicy {
  /** 連續網絡錯誤的最大退避重試次數，超出後換源 */
  maxNetworkRetries: number;
  /** 連續媒體錯誤的最大恢復次數，超出後換源 */
  maxMediaRecoveries: number;
  /** 首次退避時長（毫秒），之後按 2 的冪增長 */
  baseDelayMs: number;
  /** 單次退避時長上限（毫秒） */
  maxDelayMs: number;
}

export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = {
  maxNetworkRetries: 3,
  maxMediaRecoveries: 2,
  baseDelayMs: 800,
  maxDelayMs: 8000,
};

export type RecoveryDecision =
  | { action: 'retry'; delayMs: number; attempt: number; reason: string }
  | {
      action: 'recover-media';
      swapAudio: boolean;
      attempt: number;
      reason: string;
    }
  | { action: 'switch-source'; reason: string }
  | { action: 'ignore'; reason: string };

/**
 * "恢復確認"靜默窗口（毫秒）。
 *
 * 觸發退避重試後，管道裡可能還有上一輪在途的分片成功返回。若立刻把成功
 * 計入"鏈路已恢復"，計數會被噪聲清零，源站徹底掛掉時永遠累計不到上限。
 * 因此只在最後一次動作之後過了這個窗口、才把成功分片當作真正的恢復信號。
 */
const HEALTHY_QUIET_MS = 3000;

/**
 * 單實例的恢復狀態機。每個 HLS 實例持有一個；換源後由外部銷毀重建。
 */
export class PlaybackRecovery {
  private readonly policy: RecoveryPolicy;
  private networkAttempts = 0;
  private mediaAttempts = 0;
  private disposed = false;
  private lastActionAt = 0;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(policy: Partial<RecoveryPolicy> = {}) {
    this.policy = { ...DEFAULT_RECOVERY_POLICY, ...policy };
  }

  /**
   * 播放鏈路恢復的信號（`FRAG_LOADED` 時調用），清空連續失敗計數。
   * 動作靜默窗口內的成功會被忽略，見 {@link HEALTHY_QUIET_MS}。
   */
  markHealthy(): void {
    if (this.disposed) return;
    if (Date.now() - this.lastActionAt < HEALTHY_QUIET_MS) return;
    this.networkAttempts = 0;
    this.mediaAttempts = 0;
  }

  get accepted(): boolean {
    return !this.disposed;
  }

  /**
   * 處理一次致命錯誤，返回應當執行的動作。
   *
   * @param type hls.js 的 `data.type`（networkError / mediaError）
   * @param details hls.js 的 `data.details`
   */
  onFatal(type: string, details: string): RecoveryDecision {
    if (this.disposed) {
      return { action: 'ignore', reason: '播放器已銷毀' };
    }

    const label = describeHlsError(type, details);

    if (HARD_FAIL_DETAILS.has(details)) {
      this.lastActionAt = Date.now();
      return { action: 'switch-source', reason: `${label}，無法在當前源恢復` };
    }

    if (type === HLS_ERROR_NETWORK) {
      if (this.networkAttempts >= this.policy.maxNetworkRetries) {
        this.lastActionAt = Date.now();
        return {
          action: 'switch-source',
          reason: `${label}，已重試 ${this.networkAttempts} 次仍未恢復`,
        };
      }
      this.networkAttempts += 1;
      this.lastActionAt = Date.now();
      // 指數退避：800ms / 1.6s / 3.2s，封頂 maxDelayMs
      const delayMs = Math.min(
        this.policy.baseDelayMs * 2 ** (this.networkAttempts - 1),
        this.policy.maxDelayMs
      );
      return {
        action: 'retry',
        delayMs,
        attempt: this.networkAttempts,
        reason: label,
      };
    }

    if (type === HLS_ERROR_MEDIA) {
      if (this.mediaAttempts >= this.policy.maxMediaRecoveries) {
        this.lastActionAt = Date.now();
        return {
          action: 'switch-source',
          reason: `${label}，已恢復 ${this.mediaAttempts} 次仍失敗`,
        };
      }
      this.mediaAttempts += 1;
      this.lastActionAt = Date.now();
      // 第一次只 recoverMediaError；第二次起同時交換音軌（hls.js 官方推薦鏈路）
      return {
        action: 'recover-media',
        swapAudio: this.mediaAttempts > 1,
        attempt: this.mediaAttempts,
        reason: label,
      };
    }

    this.lastActionAt = Date.now();
    return { action: 'switch-source', reason: `${label}，無法自動恢復` };
  }

  /**
   * 延時執行重試。使用內部的定時器集合，`dispose()` 會一並取消，
   * 避免播放器銷毀後仍向已釋放的 hls 實例發指令。
   */
  schedule(delayMs: number, task: () => void): void {
    if (this.disposed) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.disposed) return;
      task();
    }, delayMs);
    this.timers.add(timer);
  }

  dispose(): void {
    this.disposed = true;
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }
}

const ERROR_LABELS: Record<string, string> = {
  manifestLoadError: '播放列表加載失敗',
  manifestLoadTimeOut: '播放列表加載超時',
  manifestParsingError: '播放列表格式錯誤',
  manifestIncompatibleCodecsError: '編碼格式不兼容',
  levelLoadError: '碼率列表加載失敗',
  levelLoadTimeOut: '碼率列表加載超時',
  levelEmptyError: '碼率列表為空',
  fragLoadError: '視頻分片加載失敗',
  fragLoadTimeOut: '視頻分片加載超時',
  fragParsingError: '視頻分片解析失敗',
  fragGapTimeout: '視頻分片間隙超時',
  bufferAppendError: '解碼器寫入失敗',
  bufferAppendingError: '解碼器寫入失敗',
  bufferStalledError: '緩沖區卡頓',
  bufferSeekOverHole: '拖動位置無可用數據',
  mediaError: '媒體解碼錯誤',
};

/** 把 hls.js 的錯誤碼翻譯成可展示給用戶的中文文案 */
export function describeHlsError(type: string, details: string): string {
  const known = ERROR_LABELS[details];
  if (known) return known;
  if (type === HLS_ERROR_NETWORK) return '網絡錯誤';
  if (type === HLS_ERROR_MEDIA) return '媒體錯誤';
  return '播放錯誤';
}
