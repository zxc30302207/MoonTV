/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * M3U8 視頻下載工具
 * 基於 get-m3u8 項目的核心功能改編
 */

import CryptoJS from 'crypto-js';

import { inferHeightFromBitrate } from './hls-quality';
import { MediaRequestDeadline } from './media-request-deadline';
import { StreamingTransmuxer, transmuxTSToMP4 } from './mp4-transmuxer';
import { fetchMediaUrl } from './url-guard';
import {
  type SegmentByteRange,
  byteRangeHeader,
  parseByteRange,
  readByteRangeResponse,
} from './video-byte-range';

export type StreamSaverMode = 'disabled' | 'service-worker' | 'file-system';

/**
 * 暫停/恢復控制器
 * 用於控制下載任務的暫停和恢復，而不是直接銷毀下載線程
 */
export class PauseResumeController {
  private isPaused = false;
  private resumeResolve: (() => void) | null = null;
  private pausePromise: Promise<void> | null = null;

  pause() {
    if (!this.isPaused) {
      this.isPaused = true;
      this.pausePromise = new Promise<void>((resolve) => {
        this.resumeResolve = resolve;
      });
    }
  }

  resume() {
    if (this.isPaused && this.resumeResolve) {
      this.isPaused = false;
      this.resumeResolve();
      this.resumeResolve = null;
      this.pausePromise = null;
    }
  }

  async waitIfPaused(): Promise<void> {
    if (this.isPaused && this.pausePromise) {
      await this.pausePromise;
    }
  }

  getPaused(): boolean {
    return this.isPaused;
  }

  destroy() {
    this.isPaused = false;
    if (this.resumeResolve) {
      this.resumeResolve();
      this.resumeResolve = null;
    }
    this.pausePromise = null;
  }
}

export interface M3U8Task {
  url: string;
  title: string;
  type: 'TS' | 'MP4';
  tsUrlList: string[];
  /** 未結束的播放列表可能繼續更新，不應長期復用解析結果。 */
  isLive?: boolean;
  segmentByteRanges?: Array<SegmentByteRange | undefined>;
  /** Per-segment encryption state; null explicitly means METHOD=NONE. */
  segmentEncryption?: Array<M3U8Task['aesConf'] | null>;
  downloadUnsupportedReason?: string;

  finishList: Array<{
    title: string;
    status: '' | 'downloading' | 'success' | 'error';
    retryCount?: number;
  }>;
  downloadIndex: number;
  finishNum: number;
  errorNum: number;
  aesConf: {
    method: string;
    uri: string;
    iv: string;
    key: string;
  };
  durationSecond: number;
  segmentDurations: number[]; // 新增：每個片段的實際時長
  rangeDownload: {
    startSegment: number;
    endSegment: number;
    targetSegment: number;
  };
  totalSize?: number;
  downloadedSegments?: Map<number, ArrayBuffer>;
}

export type M3U8ParseOptions = {
  signal?: AbortSignal;
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  validateUrl?: (url: string) => void;
  transformPlaylist?: (content: string) => string;
  resolveResponseUrl?: (response: Response, requestedUrl: string) => string;
};

/**
 * 應用URL - 處理相對路徑和絕對路徑
 *
 * 必須使用標准 URL 解析：手寫字符串拼接不會歸一化 `../`，也不會剝離 base 的
 * query，導致解析結果與 hls.js（內部用 `new URL(target, base)`）不一致。
 * 一旦不一致，播放器請求的片段 URL 與預取寫入緩存的 key 就對不上，緩存永遠 0 命中。
 */
export function applyURL(targetURL: string, baseURL: string): string {
  try {
    return new URL(targetURL, baseURL).href;
  } catch {
    return targetURL;
  }
}

/**
 * 檢查是否為主播放列表（Master Playlist）
 */
function isMasterPlaylist(m3u8Content: string): boolean {
  // 主播放列表包含 #EXT-X-STREAM-INF 標簽
  return m3u8Content.includes('#EXT-X-STREAM-INF');
}

/**
 * 主播放列表的選檔偏好。
 *
 * 不傳時沿用歷史行為（取最高帶寬）；傳入 `height` 後優先匹配該畫面高度，
 * 使預取器緩存的分片與用戶當前選擇的畫質一致——否則用戶手動切到 480p 後，
 * 預取器仍在緩存 1080p 的分片，命中率會直接掉到 0。
 */
export interface PreferredVariant {
  /** 期望的畫面高度（如 1080）。null / undefined 表示"最高帶寬" */
  height?: number | null;
  signal?: AbortSignal;
  /** Server-side parsing must also validate nested playlists and AES keys. */
  validateUrls?: boolean;
  /**
   * 瀏覽器直連播放列表失敗（CORS / 403 / DNS）時，允許改走同源代理。
   * 僅適用於預設瀏覽器 fetch；自訂 fetcher 及 validateUrls 的安全抓取
   * 不受此開關影響，避免繞過驗證或讓伺服器遞迴呼叫自身。
   */
  allowProxyFallback?: boolean;
}

/** 從 `RESOLUTION=1920x1080` 中取出高度 */
function parseResolutionHeight(resolution?: string): number {
  if (!resolution) return 0;
  const matched = resolution.match(/^\d+x(\d+)$/);
  if (!matched) return 0;
  const height = Number.parseInt(matched[1], 10);
  return Number.isFinite(height) && height > 0 ? height : 0;
}

/**
 * 從主播放列表中提取子播放列表URL。
 *
 * `preferred.height` 存在且列表裡帶得出分辨率時：同高度優先，其次取更高的
 * 最低檔，再其次取更低的最高檔——保證不會因為"沒有完全一致的高度"而回退到
 * 最高帶寬（那等於忽略用戶選擇）。
 */
function extractSubPlaylistUrl(
  m3u8Content: string,
  baseUrl: string,
  preferred?: PreferredVariant
): string | null {
  const lines = m3u8Content.split('\n');

  // 查找所有子播放列表
  const playlists: Array<{
    url: string;
    bandwidth?: number;
    resolution?: string;
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('#EXT-X-STREAM-INF')) {
      // 提取帶寬信息
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
      const resolutionMatch = line.match(/RESOLUTION=([\dx]+)/);

      // 下一行應該是播放列表URL
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine && !nextLine.startsWith('#')) {
          playlists.push({
            url: applyURL(nextLine, baseUrl),
            bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1]) : undefined,
            resolution: resolutionMatch ? resolutionMatch[1] : undefined,
          });
        }
      }
    }
  }

  if (playlists.length === 0) {
    return null;
  }

  const targetHeight = preferred?.height ?? null;
  if (targetHeight && targetHeight > 0) {
    // 沒有 `RESOLUTION` 的源站只能按帶寬推斷高度。這裡與播放側
    // （`hls-quality.resolveLevelHeight`）共用同一套推斷規則：兩邊不一致
    // 會讓預取到的檔位和用戶選中的檔位錯開，緩存命中率直接歸零。
    const withHeight = playlists
      .map((item) => ({
        ...item,
        height:
          parseResolutionHeight(item.resolution) ||
          inferHeightFromBitrate(item.bandwidth),
      }))
      .filter((item) => item.height > 0);

    if (withHeight.length > 0) {
      const exact = withHeight.filter((item) => item.height === targetHeight);
      let pool = exact;
      if (pool.length === 0) {
        const higher = withHeight
          .filter((item) => item.height > targetHeight)
          .sort((a, b) => a.height - b.height);
        pool =
          higher.length > 0
            ? higher.filter((item) => item.height === higher[0].height)
            : withHeight
                .filter((item) => item.height < targetHeight)
                .sort((a, b) => b.height - a.height)
                .slice(0, 1);
      }
      if (pool.length > 0) {
        pool.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
        return pool[0].url;
      }
    }
  }

  // 未指定偏好，或列表裡沒有任何分辨率信息：取最高帶寬
  playlists.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));

  return playlists[0].url;
}

/** 僅對跨來源 HTTP(S) 資源啟用瀏覽器端代理，避免代理自身遞迴。 */
function playlistProxyUrl(target: string): string | null {
  if (typeof window === 'undefined') return null;
  const origin = window.location?.origin;
  if (!origin) return null;
  try {
    const parsed = new URL(target);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.origin === origin
    ) {
      return null;
    }
    return `/api/m3u8?url=${encodeURIComponent(parsed.href)}`;
  } catch {
    return null;
  }
}

/**
 * 播放列表與 AES key 共用的傳輸流程。
 * 自訂 fetcher / 伺服器安全抓取不得被瀏覽器代理繞過；只有明確允許時
 * 才為預設瀏覽器 fetch 提供代理兜底。代理回應以可信的上游轉址標頭解析
 * 相對 URI，而不是以 MoonTV 自己的網址或轉址前網址解析。
 */
async function fetchPlaylistResponse(
  target: string,
  options?: M3U8ParseOptions,
  preferred?: PreferredVariant,
  deadline?: MediaRequestDeadline
): Promise<{ response: Response; baseUrl: string }> {
  options?.validateUrl?.(target);
  const signal = options?.signal ?? preferred?.signal;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const fetcher =
    options?.fetcher || (preferred?.validateUrls ? fetchMediaUrl : fetch);
  let response: Response;
  let usedProxy = false;
  try {
    const pending = fetcher(target, { signal });
    response = await (deadline ? deadline.wait(pending) : pending);
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`M3U8 request failed: ${response.status}`);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    const proxy =
      preferred?.allowProxyFallback &&
      !preferred.validateUrls &&
      !options?.fetcher
        ? playlistProxyUrl(target)
        : null;
    if (!proxy) throw error;
    const pending = fetch(proxy, {
      signal,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    response = await (deadline ? deadline.wait(pending) : pending);
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`M3U8 proxy request failed: ${response.status}`);
    }
    usedProxy = true;
  }
  const baseUrl =
    options?.resolveResponseUrl?.(response, target) ||
    (usedProxy
      ? response.headers.get('X-MoonTV-Upstream-URL') || target
      : response.url || target);
  options?.validateUrl?.(baseUrl);
  return { response, baseUrl };
}

/**
 * 解析 M3U8，保留伺服器安全抓取選項及上游畫質偏好呼叫方式。
 */
export async function parseM3U8(
  url: string,
  optionsOrDepth?: M3U8ParseOptions | number,
  depthOrPreferred: number | PreferredVariant = 0,
  preferredVariant?: PreferredVariant
): Promise<M3U8Task> {
  const options =
    typeof optionsOrDepth === 'object' ? optionsOrDepth : undefined;
  const depth =
    typeof optionsOrDepth === 'number'
      ? optionsOrDepth
      : typeof depthOrPreferred === 'number'
      ? depthOrPreferred
      : 0;
  const preferred =
    typeof depthOrPreferred === 'object' ? depthOrPreferred : preferredVariant;
  const controller = new AbortController();
  const parentSignal = options?.signal ?? preferred?.signal;
  const abort = () => controller.abort();
  parentSignal?.addEventListener('abort', abort, { once: true });
  if (parentSignal?.aborted) controller.abort();
  const deadline = new MediaRequestDeadline(controller);
  try {
    return await parseM3U8Internal(
      url,
      { ...options, signal: controller.signal },
      depth,
      preferred,
      deadline
    );
  } finally {
    parentSignal?.removeEventListener('abort', abort);
  }
}

async function parseM3U8Internal(
  url: string,
  options: M3U8ParseOptions,
  depth: number,
  preferred: PreferredVariant | undefined,
  deadline: MediaRequestDeadline
): Promise<M3U8Task> {
  // 防止無限遞迴
  if (depth > 5) {
    throw new Error('M3U8 解析層級過深，可能存在循環引用');
  }

  const { response, baseUrl: resolvedUrl } = await fetchPlaylistResponse(
    url,
    options,
    preferred,
    deadline
  );
  const content = response.body?.getReader
    ? new TextDecoder().decode(await deadline.readBody(response))
    : await deadline.wait(response.text());
  const m3u8Str = options?.transformPlaylist?.(content) ?? content;

  if (m3u8Str.substring(0, 7).toUpperCase() !== '#EXTM3U') {
    throw new Error('無效的 m3u8 鏈接');
  }

  // 檢查是否為主播放列表
  if (isMasterPlaylist(m3u8Str)) {
    const subPlaylistUrl = extractSubPlaylistUrl(
      m3u8Str,
      resolvedUrl,
      preferred
    );

    if (!subPlaylistUrl) {
      throw new Error('無法從主播放列表中提取子播放列表');
    }

    options?.validateUrl?.(subPlaylistUrl);
    return parseM3U8Internal(
      subPlaylistUrl,
      options,
      depth + 1,
      preferred,
      deadline
    );
  }

  const task: M3U8Task = {
    url: resolvedUrl,
    title: extractTitleFromUrl(resolvedUrl),
    type: 'TS',
    tsUrlList: [],
    isLive: !/^#EXT-X-ENDLIST\s*$/m.test(m3u8Str),
    segmentByteRanges: [],
    segmentEncryption: [],
    finishList: [],
    downloadIndex: 0,
    finishNum: 0,
    errorNum: 0,
    aesConf: {
      method: '',
      uri: '',
      iv: '',
      key: '',
    },
    durationSecond: 0,
    segmentDurations: [],
    rangeDownload: {
      startSegment: 1,
      endSegment: 0,
      targetSegment: 0,
    },
    totalSize: 0,
  };

  // 提取 ts 視頻片段地址和每個片段的時長
  const lines = m3u8Str.split('\n');
  let lastDuration: number | null = null;
  let pendingByteRange: string | undefined;
  let previousUrl: string | undefined;
  let previousRange: SegmentByteRange | undefined;
  let sequence = 0;
  let encryption: M3U8Task['aesConf'] | null = null;
  const keys = new Map<string, any>();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      sequence = Number(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length));
      if (!Number.isSafeInteger(sequence) || sequence < 0) {
        throw new Error('無效的媒體序號');
      }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      // Raw segment prefetch remains supported. TS concatenation/transmuxing is
      // not an fMP4 muxer: refuse download rather than silently omit init data.
      task.downloadUnsupportedReason =
        '此下載器尚不支援含初始化段的 fMP4 播放列表';
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = Object.fromEntries(
        [...line.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,\s]+)/g)].map((m) => [
          m[1],
          m[2].replace(/^"|"$/g, ''),
        ])
      );
      encryption = null;
      if (attrs.METHOD !== 'NONE') {
        if (
          attrs.METHOD !== 'AES-128' ||
          (attrs.KEYFORMAT && attrs.KEYFORMAT !== 'identity')
        ) {
          task.downloadUnsupportedReason = '此下載器尚不支援此加密格式';
        } else {
          if (!attrs.URI) throw new Error('AES-128 缺少金鑰 URI');
          if (attrs.IV && !/^0x[0-9a-f]{1,32}$/i.test(attrs.IV))
            throw new Error('無效的 AES IV');
          const uri = applyURL(attrs.URI, resolvedUrl);
          options?.validateUrl?.(uri);
          if (!keys.has(uri)) {
            const { response: keyResponse } = await fetchPlaylistResponse(
              uri,
              options,
              preferred,
              deadline
            );
            const bytes = await deadline.readBody(keyResponse);
            if (bytes.byteLength !== 16)
              throw new Error('AES-128 金鑰長度必須為 16 bytes');
            keys.set(uri, arrayBufferToWordArray(bytes));
          }
          encryption = {
            method: 'AES-128',
            uri,
            iv: attrs.IV ? '0x' + attrs.IV.slice(2).padStart(32, '0') : '',
            key: keys.get(uri),
          };
        }
      }
    }
    if (line.startsWith('#EXTINF:')) {
      lastDuration = parseFloat(line.split('#EXTINF:')[1]);
      task.durationSecond += lastDuration;
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingByteRange = line.slice('#EXT-X-BYTERANGE:'.length);
    } else if (/^[^#]/.test(line) && line.trim()) {
      const tsUrl = applyURL(line.trim(), resolvedUrl);
      options?.validateUrl?.(tsUrl);
      const range =
        pendingByteRange === undefined
          ? undefined
          : parseByteRange(
              pendingByteRange,
              previousUrl === tsUrl ? previousRange?.end : undefined
            );

      task.tsUrlList.push(tsUrl);
      const segmentEncryption = encryption
        ? {
            ...encryption,
            iv: encryption.iv || '0x' + sequence.toString(16).padStart(32, '0'),
          }
        : null;
      task.segmentEncryption?.push(segmentEncryption);
      if (segmentEncryption && !task.aesConf.key)
        task.aesConf = segmentEncryption;
      sequence++;
      task.segmentByteRanges?.push(range);
      previousUrl = tsUrl;
      previousRange = range;
      pendingByteRange = undefined;
      task.finishList.push({ title: line.trim(), status: '' });
      // 記錄每個片段的時長
      task.segmentDurations.push(lastDuration ?? 0);
      lastDuration = null;
    }
  }

  task.rangeDownload.endSegment = task.tsUrlList.length;
  task.rangeDownload.targetSegment = task.tsUrlList.length;

  // 估算總文件大小（基於時長和比特率）
  // 假設平均比特率為 2Mbps (TS 流媒體的常見值)
  const estimatedBitrate = (2 * 1024 * 1024) / 8; // 2Mbps 轉為字節/秒

  task.totalSize = Math.round(task.durationSecond * estimatedBitrate);

  return task;
}

/**
 * 從URL中提取標題
 */
function extractTitleFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const title = urlObj.searchParams.get('title');
    if (title) return title;
  } catch (e) {
    // ignore
  }

  const now = new Date();
  return `video_${now.getFullYear()}${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(
    2,
    '0'
  )}${String(now.getMinutes()).padStart(2, '0')}${String(
    now.getSeconds()
  ).padStart(2, '0')}`;
}

/**
 * ArrayBuffer 轉 WordArray (CryptoJS格式)
 */
function arrayBufferToWordArray(arrayBuffer: ArrayBuffer): any {
  const u8 = new Uint8Array(arrayBuffer);
  const len = u8.length;
  const words: number[] = [];
  for (let i = 0; i < len; i += 1) {
    words[i >>> 2] |= (u8[i] & 0xff) << (24 - (i % 4) * 8);
  }
  return CryptoJS.lib.WordArray.create(words, len);
}

/**
 * AES 解密
 */
export function aesDecrypt(
  data: ArrayBuffer,
  key: any,
  iv: string
): ArrayBuffer {
  if (!key) return data;

  const wordArray = arrayBufferToWordArray(data);
  const ivWordArray = iv
    ? CryptoJS.enc.Hex.parse(iv.replace('0x', ''))
    : CryptoJS.lib.WordArray.create();

  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: wordArray } as any,
    key,
    {
      iv: ivWordArray,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    }
  );

  // 將 WordArray 轉回 ArrayBuffer
  const typedArray = new Uint8Array(decrypted.sigBytes);
  const words = decrypted.words;
  for (let i = 0; i < decrypted.sigBytes; i++) {
    typedArray[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return typedArray.buffer;
}

/**
 * 下載單個 TS 片段
 */
export async function downloadTsSegment(
  url: string,
  signal?: AbortSignal,
  options?: { validateUrl?: (url: string) => void }
): Promise<ArrayBuffer> {
  options?.validateUrl?.(url);

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`下載失敗: ${response.status}`);
  }
  return response.arrayBuffer();
}

/** 大於此大小的片段才啟用 Range 分塊下載（字節） */
const RANGE_CHUNK_THRESHOLD = 512 * 1024;
/** 單個片段分塊數 */
const RANGE_CHUNK_COUNT = 4;

/** 按 Range 並發分塊下載一個片段，合並後返回 */
async function downloadByRanges(
  url: string,
  totalSize: number,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const chunkSize = Math.ceil(totalSize / RANGE_CHUNK_COUNT);
  const tasks: Promise<{ index: number; data: ArrayBuffer }>[] = [];
  for (let i = 0; i < RANGE_CHUNK_COUNT; i++) {
    const start = i * chunkSize;
    if (start >= totalSize) break;
    const end = Math.min(start + chunkSize - 1, totalSize - 1);
    tasks.push(
      (async () => {
        const resp = await fetch(url, {
          signal,
          headers: { Range: `bytes=${start}-${end}` },
        });
        // 必須是 206，否則說明源站忽略了 Range（會返回完整文件，導致拼接錯誤）
        return {
          index: i,
          data: await readByteRangeResponse(resp, { start, end: end + 1 }),
        };
      })()
    );
  }
  const results = await Promise.all(tasks);
  const merged = new Uint8Array(totalSize);
  let offset = 0;
  results.sort((a, b) => a.index - b.index);
  for (const r of results) {
    merged.set(new Uint8Array(r.data), offset);
    offset += r.data.byteLength;
  }
  return merged.buffer;
}

/**
 * 帶 Range 分塊的片段下載（下載核心用）。
 *
 * 對較大片段先用 `Range: bytes=0-0` 探測大小，再分 4 塊並發下載，突破
 * 單連接限速。小片段 / 不支持 Range 的源自動回退整段下載。
 */
export async function downloadTsSegmentConcurrent(
  url: string,
  signal?: AbortSignal,
  range?: SegmentByteRange
): Promise<ArrayBuffer> {
  if (range) {
    const response = await fetch(url, {
      signal,
      headers: { Range: byteRangeHeader(range) },
    });
    return readByteRangeResponse(response, range);
  }
  // 1) 探測文件大小。注意：不支持 Range 的源會忽略請求頭、返回 200 + 完整文件，
  //    此時 probe 本身就是完整片段，必須直接返回——否則會白白下載一遍再整段重下，
  //    等於每個片段下載兩遍（曾導致下載速度直接減半）。
  let totalSize = 0;
  try {
    const probe = await fetch(url, { signal, headers: { Range: 'bytes=0-0' } });
    if (probe.status === 206) {
      const cr = probe.headers.get('Content-Range');
      const m = cr?.match(/\/(\d+)$/);
      if (m) totalSize = parseInt(m[1], 10);
      // 消費探測響應 body（1 字節），避免連接洩漏
      await probe.arrayBuffer().catch(() => undefined);
    } else if (probe.ok) {
      // 源站不支持 Range：這個響應就是完整片段，直接用，不再重復下載
      return await probe.arrayBuffer();
    }
  } catch {
    // 探測失敗（含 abort），走整段下載兜底
  }

  // 2) 大片段分塊下載；失敗回退整段
  if (totalSize > RANGE_CHUNK_THRESHOLD) {
    try {
      return await downloadByRanges(url, totalSize, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      // 分塊失敗（如 Range 未生效），回退整段下載
    }
  }

  // 3) 整段下載
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`下載失敗: ${response.status}`);
  }
  return response.arrayBuffer();
}

/**
 * 合並所有片段為 Blob
 */
export function mergeSegments(
  segments: ArrayBuffer[],
  type: 'TS' | 'MP4'
): Blob {
  const mimeType = type === 'MP4' ? 'video/mp4' : 'video/MP2T';
  return new Blob(segments, { type: mimeType });
}

/**
 * 觸發瀏覽器下載
 */
export function triggerDownload(
  blob: Blob,
  filename: string,
  type: 'TS' | 'MP4'
): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // 移除文件名中已有的視頻擴展名，避免重復
  const cleanFilename = filename.replace(/\.(mp4|ts|m3u8)$/i, '');
  a.download = `${cleanFilename}.${type.toLowerCase()}`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // 延遲清理，確保下載已開始
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * 下載進度回調類型
 */
export interface DownloadProgress {
  current: number;
  total: number;
  percentage: number;
  status: 'downloading' | 'processing' | 'done' | 'partial' | 'error';
  message?: string;
}

/**
 * 下載M3U8視頻（支持多線程並發）
 */
export async function downloadM3U8Video(
  task: M3U8Task,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
  pauseResumeController?: PauseResumeController, // 暫停/恢復控制器
  concurrency = 16, // 默認16個並發（下載提速）
  streamMode: StreamSaverMode = 'disabled', // 邊下邊存模式
  maxRetries = 3, // 最大重試次數
  completeStreamRef?: { current: (() => Promise<void>) | null }, // 完成流函數引用（用於邊下邊存模式立即保存）
  persistTaskId?: string // 任務ID：傳入時啟用斷點續傳持久化
): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    await downloadM3U8VideoInternal(
      task,
      onProgress,
      controller.signal,
      pauseResumeController,
      concurrency,
      streamMode,
      maxRetries,
      completeStreamRef,
      persistTaskId,
      controller
    );
  } finally {
    signal?.removeEventListener('abort', abort);
    if (completeStreamRef) completeStreamRef.current = null;
  }
}

async function downloadM3U8VideoInternal(
  task: M3U8Task,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
  pauseResumeController?: PauseResumeController, // 暫停/恢復控制器
  concurrency = 16, // 默認16個並發（下載提速）
  streamMode: StreamSaverMode = 'disabled', // 邊下邊存模式
  maxRetries = 3, // 最大重試次數
  completeStreamRef?: { current: (() => Promise<void>) | null }, // 完成流函數引用（用於邊下邊存模式立即保存）
  persistTaskId?: string,
  downloadController?: AbortController
): Promise<void> {
  if (task.downloadUnsupportedReason)
    throw new Error(task.downloadUnsupportedReason);
  const { startSegment, endSegment } = task.rangeDownload;
  const totalSegments = endSegment - startSegment + 1;

  // 計算範圍下載的實際時長（用每個片段的真實時長相加）
  const rangeDuration = task.segmentDurations
    .slice(startSegment - 1, endSegment)
    .reduce((sum, d) => sum + d, 0);

  // 流式寫入器（邊下邊存模式）
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  // MP4 流式轉碼器
  let streamingTransmuxer: StreamingTransmuxer | null = null;
  // 邊下邊存模式：待寫入隊列（按順序寫入）
  const pendingWrites = new Map<number, ArrayBuffer | 'failed'>();
  let nextWriteIndex = startSegment - 1; // 下一個要寫入的片段索引
  // 寫入鎖：確保寫入操作的串行化，避免多線程並發寫入導致數據丟失
  let writeLock: Promise<void> = Promise.resolve();

  if (streamMode !== 'disabled') {
    try {
      // 移除標題中已有的視頻擴展名，避免重復
      const cleanTitle = task.title.replace(/\.(mp4|ts|m3u8)$/i, '');
      const ext = task.type === 'MP4' ? '.mp4' : '.ts';
      // 強制加正確後綴
      let filename = cleanTitle + ext;
      if (!filename.toLowerCase().endsWith(ext)) filename += ext;

      // 估算文件大小（如果可能）
      const estimatedSize = task.totalSize || undefined;

      let stream: WritableStream<Uint8Array> | null = null;

      // 根據用戶選擇的模式創建寫入流
      if (streamMode === 'service-worker') {
        // 使用 Service Worker 模式
        const { createWriteStream } = await import('./stream-saver');
        stream = createWriteStream(filename);
        // eslint-disable-next-line no-console
        console.log('✅ 使用 Service Worker 流式下載');
      } else if (streamMode === 'file-system') {
        // 使用 File System Access API
        const { createFileSystemWriteStream } = await import(
          './stream-saver-fallback'
        );
        stream = await createFileSystemWriteStream(filename, estimatedSize);
        if (stream) {
          // eslint-disable-next-line no-console
          console.log('✅ 使用文件系統直寫');
        } else {
          throw new Error('用戶取消了文件選擇');
        }
      }

      if (stream) {
        writer = stream.getWriter();

        // 如果是 MP4 格式，初始化流式轉碼器
        if (task.type === 'MP4') {
          streamingTransmuxer = new StreamingTransmuxer(writer, rangeDuration);
          // eslint-disable-next-line no-console
          console.log('✅ 啟用 MP4 流式轉碼');
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('創建流式寫入器失敗，降級為普通下載:', error);
      writer = null;
    }
  }

  // A newly opened stream contains no restored bytes. Re-download its range
  // rather than skipping persisted successes and committing an empty/truncated file.
  if (writer) {
    for (let i = startSegment - 1; i < endSegment; i++)
      task.finishList[i].status = '';
    task.finishNum = 0;
    task.errorNum = 0;
  }
  let completedCount = 0;
  let writtenCount = 0;
  let earlyRequested = false;
  let earlyFinishPromise: Promise<void> | null = null;
  const workers: Promise<void>[] = [];

  // 斷點續傳：初始化時統計范圍內已成功的片段，確保進度條顯示正確的恢復進度
  for (let i = startSegment - 1; i < endSegment; i++) {
    if (task.finishList[i]?.status === 'success') {
      completedCount++;
    }
  }
  // 同步更新 task.finishNum，確保內部統計一致
  if (completedCount > 0) {
    task.finishNum = completedCount;
    // 立即觸發一次進度回調，確保UI立刻顯示正確的恢復進度
    onProgress?.({
      current: completedCount,
      total: totalSegments,
      percentage: Math.floor((completedCount / totalSegments) * 100),
      status: 'downloading',
      message: `正在恢復下載 ${completedCount}/${totalSegments} 個片段已完成`,
    });
  }

  // 串行化寫入函數：確保寫入操作按順序執行，避免多線程並發寫入導致數據丟失
  const flushPendingWrites = async (): Promise<void> => {
    // 等待之前的寫入操作完成
    await writeLock;

    // 如果沒有 writer，直接返回
    if (!writer) {
      return;
    }

    // 將新的寫入操作添加到 Promise 鏈中，確保寫入操作的串行化
    writeLock = writeLock.then(async () => {
      // 按順序寫入所有待寫入的片段
      while (pendingWrites.has(nextWriteIndex)) {
        // 在寫入循環中檢查暫停狀態
        if (pauseResumeController) {
          await pauseResumeController.waitIfPaused();
        }
        if (signal?.aborted) {
          throw new Error('下載已取消');
        }

        const data = pendingWrites.get(nextWriteIndex);

        if (data === 'failed') {
          // 失敗的片段，跳過
          // eslint-disable-next-line no-console
          console.warn(`⚠️ 跳過失敗片段 ${nextWriteIndex + 1}`);
          pendingWrites.delete(nextWriteIndex);
          nextWriteIndex++;
          continue;
        }

        if (!data) {
          // 數據不存在，等待下載
          break;
        }

        // 寫入成功下載的片段
        try {
          if (streamingTransmuxer) {
            await streamingTransmuxer.pushAndTransmux(new Uint8Array(data));
          } else {
            if (writer) {
              await writer.write(new Uint8Array(data));
            } else {
              throw new Error('Writer is not initialized');
            }
          }
          writtenCount++;
          pendingWrites.delete(nextWriteIndex);
          nextWriteIndex++;
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`片段 ${nextWriteIndex + 1} 寫入流失敗:`, error);
          // 寫入失敗意味著用戶可能取消了下載，應該停止整個下載任務
          throw new Error(
            `寫入失敗: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    });

    // 等待當前寫入操作完成
    await writeLock;
  };

  // 如果提供了完成流函數引用，設置完成流的函數（需要在 completedCount 和 writer 初始化後設置）
  if (completeStreamRef && streamMode !== 'disabled' && writer) {
    completeStreamRef.current = () => {
      if (earlyFinishPromise) return earlyFinishPromise;
      earlyRequested = true;
      earlyFinishPromise = (async () => {
        // Explicit partial save is not cancellation: stop producers, settle their
        // writes, then commit only bytes already written. Never call writer.abort.
        downloadController?.abort();
        pauseResumeController?.resume();
        await Promise.allSettled(workers);
        await writeLock.catch(() => undefined);
        if (!writer) return;
        if (!writtenCount) {
          await writer.abort();
          throw new Error('尚未寫入完整片段，無法保存部分檔案');
        }
        if (streamingTransmuxer) await streamingTransmuxer.finish();
        else await writer.close();
        onProgress?.({
          current: writtenCount,
          total: totalSegments,
          percentage: Math.floor((writtenCount / totalSegments) * 100),
          status: 'partial',
          message: `已保存部分檔案：${writtenCount}/${totalSegments} 個片段（非完整影片）`,
        });
      })();
      return earlyFinishPromise;
    };
  }

  // 創建下載隊列
  const downloadQueue: number[] = [];
  for (let i = startSegment - 1; i < endSegment; i++) {
    downloadQueue.push(i);
  }

  // 並發下載函數（帶重試機制）
  const downloadSegment = async (
    index: number,
    retryCount = 0
  ): Promise<void> => {
    const retryDelay = 1000; // 重試延遲（毫秒）

    // 斷點續傳：已成功的片段直接跳過（finishList 可能從持久化狀態恢復）
    if (task.finishList[index]?.status === 'success') {
      return;
    }

    if (signal?.aborted) {
      throw new Error('下載已取消');
    }

    // 檢查是否暫停，如果暫停則等待恢復
    if (pauseResumeController) {
      await pauseResumeController.waitIfPaused();
    }

    // 標記為下載中
    task.finishList[index].status = 'downloading';
    task.finishList[index].retryCount = retryCount;

    try {
      // 在下載前再次檢查暫停狀態
      if (pauseResumeController) {
        await pauseResumeController.waitIfPaused();
      }
      if (signal?.aborted) {
        throw new Error('下載已取消');
      }

      let segmentData = await downloadTsSegmentConcurrent(
        task.tsUrlList[index],
        signal,
        task.segmentByteRanges?.[index]
      );

      // 下載完成後檢查暫停狀態，如果暫停則等待恢復
      if (pauseResumeController) {
        await pauseResumeController.waitIfPaused();
      }
      if (signal?.aborted) {
        throw new Error('下載已取消');
      }

      // AES 解密
      const encryption = task.segmentEncryption
        ? task.segmentEncryption[index]
        : task.aesConf;
      if (encryption?.key) {
        segmentData = aesDecrypt(segmentData, encryption.key, encryption.iv);
      }

      // 解密後再次檢查暫停狀態
      if (pauseResumeController) {
        await pauseResumeController.waitIfPaused();
      }
      if (signal?.aborted) {
        throw new Error('下載已取消');
      }

      // 如果使用邊下邊存，加入待寫入隊列
      if (writer) {
        // 將片段數據加入隊列
        pendingWrites.set(index, segmentData);

        // 使用串行化寫入函數，確保寫入操作按順序執行，避免多線程並發寫入
        await flushPendingWrites();
      } else {
        // 普通模式：保存到內存
        if (!task.downloadedSegments) {
          task.downloadedSegments = new Map();
        }
        task.downloadedSegments.set(index, segmentData);
      }

      // 在處理完數據後、更新狀態前再次檢查暫停狀態
      if (pauseResumeController) {
        await pauseResumeController.waitIfPaused();
      }
      if (signal?.aborted) {
        throw new Error('下載已取消');
      }

      // 更新片段狀態為成功
      task.finishList[index].status = 'success';

      completedCount++;
      task.finishNum++;

      if (persistTaskId) {
        const persistence = await import('./download-persistence');
        if (!writer)
          await persistence.saveDownloadSegment(
            persistTaskId,
            index,
            segmentData,
            signal
          );
        if (signal?.aborted) throw new Error('下載已取消');
        persistence.persistDownloadState(persistTaskId, task);
      }

      // 更新進度
      onProgress?.({
        current: completedCount,
        total: totalSegments,
        percentage: Math.floor((completedCount / totalSegments) * 100),
        status: 'downloading',
        message: `正在下載 ${completedCount}/${totalSegments} 個片段 (${concurrency} 線程)${
          retryCount > 0 ? ` [重試成功]` : ''
        }`,
      });
    } catch (error) {
      if (signal?.aborted) throw new Error('下載已取消');
      // 檢查是否是寫入失敗（用戶取消下載）
      const isWriteError =
        error instanceof Error && error.message.includes('寫入失敗');

      if (isWriteError) {
        // 寫入失敗意味著用戶可能取消了下載，不應該重試，直接拋出錯誤停止下載
        // eslint-disable-next-line no-console
        console.error('寫入流失敗，用戶可能取消了下載，停止下載任務');
        throw error;
      }

      // 如果還有重試機會，進行重試
      if (retryCount < maxRetries) {
        // eslint-disable-next-line no-console
        console.warn(
          `片段 ${index + 1} 下載失敗，${retryDelay}ms 後進行第 ${
            retryCount + 1
          } 次重試...`
        );

        onProgress?.({
          current: completedCount,
          total: totalSegments,
          percentage: Math.floor((completedCount / totalSegments) * 100),
          status: 'downloading',
          message: `片段 ${index + 1} 重試中 (${retryCount + 1}/${maxRetries})`,
        });

        // 等待一段時間後重試
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        return downloadSegment(index, retryCount + 1);
      }

      // 所有重試都失敗
      task.errorNum++;
      // 標記片段為失敗狀態
      task.finishList[index].status = 'error';
      task.finishList[index].retryCount = retryCount;

      // 斷點續傳：失敗狀態也要持久化，供刷新後跳過
      if (persistTaskId) {
        void import('./download-persistence').then(
          ({ persistDownloadState }) => {
            if (!signal?.aborted) persistDownloadState(persistTaskId, task);
          }
        );
      }

      // eslint-disable-next-line no-console
      console.error(
        `片段 ${index + 1} 下載失敗（已重試 ${maxRetries} 次）:`,
        error
      );

      // 邊下邊存模式下，失敗的片段標記為 'failed' 並加入隊列
      if (streamMode !== 'disabled' && writer) {
        // 標記為失敗，以便按順序跳過
        pendingWrites.set(index, 'failed');

        // 使用串行化寫入函數，確保寫入操作按順序執行，避免多線程並發寫入
        await flushPendingWrites();

        // eslint-disable-next-line no-console
        console.warn(`邊下邊存模式：已跳過失敗片段 ${index + 1}，繼續下載...`);
        onProgress?.({
          current: completedCount,
          total: totalSegments,
          percentage: Math.floor((completedCount / totalSegments) * 100),
          status: 'downloading',
          message: `片段 ${
            index + 1
          } 失敗已跳過 (已完成 ${completedCount}/${totalSegments})`,
        });
      } else {
        // 普通模式下，片段失敗不影響任務狀態，保持 downloading 等待手動重試
        onProgress?.({
          current: completedCount,
          total: totalSegments,
          percentage: Math.floor((completedCount / totalSegments) * 100),
          status: 'downloading',
          message: `片段 ${
            index + 1
          } 下載失敗，等待重試 (已完成 ${completedCount}/${totalSegments})`,
        });
      }
    }
  };

  // 並發控制：同時最多 concurrency 個下載任務

  const processQueue = async () => {
    while (downloadQueue.length > 0) {
      if (signal?.aborted) {
        throw new Error('下載已取消');
      }

      // 檢查是否暫停，如果暫停則等待恢復
      if (pauseResumeController) {
        await pauseResumeController.waitIfPaused();
      }

      const index = downloadQueue.shift();
      if (index !== undefined) {
        await downloadSegment(index);
      }
    }
  };

  // 啟動多個並發worker
  for (let i = 0; i < Math.min(concurrency, totalSegments); i++) {
    workers.push(processQueue());
  }

  try {
    // 等待所有worker完成
    await Promise.all(workers);
    if (signal?.aborted) throw new Error('下載已取消');

    // Never close/commit a truncated stream as a successful complete file.
    if (
      writer &&
      task.finishList
        .slice(startSegment - 1, endSegment)
        .some((item) => item.status !== 'success')
    ) {
      throw new Error('下載不完整：仍有失敗片段，已中止檔案寫入，請重新下載');
    }
    // 自然完成與明確部分保存互斥，避免 close 尚未完成時再次 close。
    if (completeStreamRef) completeStreamRef.current = null;
    // 邊下邊存模式：關閉流
    if (writer) {
      try {
        // 等待所有待寫入的數據完成
        await flushPendingWrites();

        // 如果使用了流式轉碼器，需要先完成轉碼
        if (streamingTransmuxer) {
          await streamingTransmuxer.finish();
        } else {
          await writer.close();
        }

        onProgress?.({
          current: completedCount,
          total: totalSegments,
          percentage: 100,
          status: 'done',
          message: '下載完成！',
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('關閉流失敗:', error);
        throw error;
      }
      return;
    }
  } catch (error) {
    if (earlyRequested && earlyFinishPromise) {
      await earlyFinishPromise;
      return;
    }
    // 如果是中止下載，需要關閉流以顯示瀏覽器取消狀態
    if (writer) {
      try {
        await writer.abort();
      } catch (abortError) {
        // eslint-disable-next-line no-console
        console.error('中止流失敗:', abortError);
      }
    }
    throw error;
  }

  // 普通模式：合並並下載
  if (!task.downloadedSegments || task.downloadedSegments.size === 0) {
    throw new Error('沒有成功下載的片段');
  }

  // 檢查是否有失敗的片段（在下載範圍內）
  const hasFailedSegments = task.finishList
    .slice(startSegment - 1, endSegment)
    .some((item) => item.status === 'error');

  if (hasFailedSegments) {
    // 有失敗片段，不執行保存，保持下載狀態等待手動重試
    const failedCount = task.finishList
      .slice(startSegment - 1, endSegment)
      .filter((item) => item.status === 'error').length;

    // eslint-disable-next-line no-console
    console.warn(`⚠️ 有 ${failedCount} 個片段下載失敗，等待手動重試...`);

    onProgress?.({
      current: completedCount,
      total: totalSegments,
      percentage: Math.round((completedCount / totalSegments) * 100),
      status: 'downloading',
      message: `${failedCount} 個片段失敗，等待重試...`,
    });

    // 不繼續執行合並，保持下載狀態
    return;
  }

  // 按順序合並片段
  const segments: ArrayBuffer[] = [];
  for (let i = startSegment - 1; i < endSegment; i++) {
    const segment = task.downloadedSegments.get(i);
    if (segment) {
      segments.push(segment);
    }
  }

  onProgress?.({
    current: segments.length,
    total: endSegment - startSegment + 1,
    percentage: 100,
    status: 'processing',
    message:
      task.type === 'MP4' ? '正在轉碼為 MP4 格式...' : '正在合並視頻文件...',
  });

  // 如果是 MP4 格式，進行轉碼
  let blob: Blob;
  if (task.type === 'MP4') {
    // 傳遞範圍內片段的實際時長累加值
    const actualDuration = task.segmentDurations
      .slice(startSegment - 1, endSegment)
      .reduce((a, b) => a + b, 0);
    blob = transmuxTSToMP4(segments, actualDuration);
  } else {
    blob = mergeSegments(segments, task.type);
  }

  triggerDownload(blob, task.title, task.type);

  onProgress?.({
    current: segments.length,
    total: endSegment - startSegment + 1,
    percentage: 100,
    status: 'done',
    message: '下載完成！',
  });
}

/**
 * 獲取視頻片段列表信息
 */
export interface SegmentInfo {
  index: number;
  url: string;
  duration: number;
  status: '' | 'downloading' | 'success' | 'error';
}

export function getSegmentList(task: M3U8Task): SegmentInfo[] {
  return task.tsUrlList.map((url, index) => ({
    index: index + 1,
    url,
    duration: 0,
    status: task.finishList[index]?.status || '',
  }));
}
