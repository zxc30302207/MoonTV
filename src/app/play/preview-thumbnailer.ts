/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

/**
 * 進度條懸停預覽的抽幀器。
 *
 * 用一個獨立的隱藏 <video>（復用自己的 hls.js 實例，loader 與主播放器保持一致，
 * 因此分片請求同樣優先命中 Cache Storage / 同源代理）在懸停時 seek 到目標時間，
 * 再用 canvas 截取當前幀返回 dataURL。不依賴任何後端預生成雪碧圖。
 */
export class PreviewThumbnailer {
  private video: HTMLVideoElement | null = null;
  private hls: any = null;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private disposed = false;
  private manifestReady = false;
  private sourceUrl = '';
  private events: any = null;
  private cancelCapture: (() => void) | null = null;
  private thumbnails = new Map<string, string>();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * 綁定新的視頻源（切集 / 換源後調用）。
   *
   * - `Hls`：hls.js 構造器（與主播放器同一個動態加載模塊）。
   * - `loader`：與主播放器相同的「去廣告 + 緩存優先」Loader，保證預覽分片同樣命中緩存。
   */
  load(url: string, Hls: any, loader: any): void {
    this.destroy();
    // destroy() 會把 disposed 置為 true，這裡要復原，否則 capture() 會在首行被 disposed 攔截直接返回 null
    this.disposed = false;

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.cssText =
      'position:absolute;width:2px;height:2px;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
    video.setAttribute('aria-hidden', 'true');
    document.body.appendChild(video);
    this.video = video;

    const hls = new Hls({
      enableWorker: true, // 後台處理預覽分片，緩存 loader 仍在主線程運行
      lowLatencyMode: false,
      autoStartLoad: false,
      maxBufferLength: 1,
      maxMaxBufferLength: 2,
      maxBufferSize: 2 * 1000 * 1000,
      backBufferLength: 15,
      loader,
    });
    this.hls = hls;
    this.events = Hls.Events;
    this.sourceUrl = url;
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      this.manifestReady = true;
    });
    hls.attachMedia(video);
    // 播放列表也延遲到首次抽幀請求，取消後可重新加載。
  }

  /** 懸停到目標時間點，返回該處幀的 JPEG dataURL；失敗 / 超時返回 null。 */
  async capture(time: number): Promise<string | null> {
    this.cancel();
    const video = this.video;
    const hls = this.hls;
    if (
      !video ||
      !hls ||
      !this.ctx ||
      this.disposed ||
      !Number.isFinite(time)
    ) {
      return null;
    }
    const target = Math.max(
      0,
      Number.isFinite(video.duration)
        ? Math.min(time, Math.max(0, video.duration - 0.05))
        : time
    );
    const key = target.toFixed(1);
    const cached = this.thumbnails.get(key);
    if (cached) return cached;

    return new Promise<string | null>((resolve) => {
      let settled = false;
      let loading = false;
      const mediaEvents = ['loadedmetadata', 'loadeddata', 'canplay', 'seeked'];
      const finish = (result: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        mediaEvents.forEach((event) =>
          video.removeEventListener(event, onReady)
        );
        video.removeEventListener('error', onError);
        hls.off(this.events.MANIFEST_PARSED, startLoading);
        hls.off(this.events.ERROR, onHlsError);
        this.cancelCapture = null;
        video.pause();
        hls.stopLoad();
        if (result) {
          // 僅保留少量已生成縮略圖，重復懸停無需再次下載或解碼。
          this.thumbnails.set(key, result);
          if (this.thumbnails.size > 64) {
            this.thumbnails.delete(
              this.thumbnails.keys().next().value as string
            );
          }
        }
        resolve(result);
      };
      const onError = () => finish(null);
      const onHlsError = (_event: any, data: any) => {
        if (data.fatal) finish(null);
      };
      const onReady = () => {
        if (settled) return;
        if (this.disposed || this.video !== video) {
          finish(null);
          return;
        }
        if (
          video.readyState >= 1 &&
          Math.abs(video.currentTime - target) > 0.3
        ) {
          try {
            video.currentTime = target;
          } catch {
            finish(null);
          }
          return;
        }
        if (!video.seeking && video.readyState >= 2) {
          const image = this.extract();
          if (image) finish(image);
        }
      };
      const startLoading = () => {
        if (settled || loading) return;
        loading = true;
        try {
          // 未有元數據時也直接從目標分片啟動，不再先下載片頭。
          hls.config.startPosition = target;
          if (video.readyState >= 1) video.currentTime = target;
          hls.startLoad(target);
          // 激活隱藏視頻的解碼管線；拿到目標幀後立即暫停。
          video.play().catch(() => undefined);
        } catch {
          finish(null);
        }
      };
      // 超時覆蓋播放列表、分片下載和解碼，而非僅覆蓋 seek。
      const timer = setTimeout(() => finish(null), 10000);
      const poll = setInterval(onReady, 50);
      this.cancelCapture = () => finish(null);
      mediaEvents.forEach((event) => video.addEventListener(event, onReady));
      video.addEventListener('error', onError);
      hls.on(this.events.MANIFEST_PARSED, startLoading);
      hls.on(this.events.ERROR, onHlsError);
      onReady();
      if (settled) return;
      if (this.manifestReady) {
        startLoading();
      } else {
        try {
          hls.loadSource(this.sourceUrl);
        } catch {
          finish(null);
        }
      }
    });
  }

  /** 取消過時的抽幀並中止下載，不影響主播放器或緩存預取器。 */
  cancel(): void {
    this.cancelCapture?.();
    this.video?.pause();
    this.hls?.stopLoad();
  }

  destroy(): void {
    this.cancel();
    this.disposed = true;
    if (this.hls) {
      try {
        this.hls.destroy();
      } catch {
        // 忽略：實例可能已處於銷毀中
      }
      this.hls = null;
    }
    if (this.video) {
      try {
        this.video.remove();
      } catch {
        // 忽略
      }
      this.video = null;
    }
    this.manifestReady = false;
    this.sourceUrl = '';
    this.thumbnails.clear();
  }

  private extract(): string | null {
    const video = this.video;
    const ctx = this.ctx;
    if (!video || !ctx) return null;
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;
      const targetWidth = 160;
      const targetHeight = Math.max(1, Math.round((vh / vw) * targetWidth));
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
      ctx.drawImage(video, 0, 0, vw, vh, 0, 0, targetWidth, targetHeight);
      return this.canvas.toDataURL('image/jpeg', 0.7);
    } catch {
      return null;
    }
  }
}
