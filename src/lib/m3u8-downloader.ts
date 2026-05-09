/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * M3U8 視頻下載工具
 * 基於 get-m3u8 項目的核心功能改編
 */

import CryptoJS from 'crypto-js';

import { StreamingTransmuxer, transmuxTSToMP4 } from './mp4-transmuxer';

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
  finishList: Array<{ title: string; status: '' | 'downloading' | 'success' | 'error'; retryCount?: number }>;
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
  validateUrl?: (url: string) => void;
};

/**
 * 應用URL - 處理相對路徑和絕對路徑
 */
export function applyURL(targetURL: string, baseURL: string): string {
  if (/^http/.test(targetURL)) {
    return targetURL;
  }
  const urlObj = new URL(baseURL);
  const protocol = urlObj.protocol;
  const host = urlObj.host;

  if (targetURL.startsWith('/')) {
    return `${protocol}//${host}${targetURL}`;
  }

  const pathArr = baseURL.split('/');
  pathArr.pop();
  return `${pathArr.join('/')}/${targetURL}`;
}

/**
 * 檢查是否為主播放列表（Master Playlist）
 */
function isMasterPlaylist(m3u8Content: string): boolean {
  // 主播放列表包含 #EXT-X-STREAM-INF 標簽
  return m3u8Content.includes('#EXT-X-STREAM-INF');
}

/**
 * 從主播放列表中提取子播放列表URL
 */
function extractSubPlaylistUrl(m3u8Content: string, baseUrl: string): string | null {
  const lines = m3u8Content.split('\n');

  // 查找所有子播放列表
  const playlists: Array<{ url: string; bandwidth?: number; resolution?: string }> = [];

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

  // 優先選擇最高帶寬的播放列表
  playlists.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));

  return playlists[0].url;
}

/**
 * 解析M3U8文件（支持主播放列表自動解析）
 */
export async function parseM3U8(
  url: string,
  options?: M3U8ParseOptions,
  depth = 0
): Promise<M3U8Task> {
  // 防止無限遞歸
  if (depth > 5) {
    throw new Error('M3U8 解析層級過深，可能存在循環引用');
  }

  options?.validateUrl?.(url);
  const response = await fetch(url);
  const m3u8Str = await response.text();

  if (m3u8Str.substring(0, 7).toUpperCase() !== '#EXTM3U') {
    throw new Error('無效的 m3u8 鏈接');
  }

  // 檢查是否為主播放列表
  if (isMasterPlaylist(m3u8Str)) {
    const subPlaylistUrl = extractSubPlaylistUrl(m3u8Str, url);

    if (!subPlaylistUrl) {
      throw new Error('無法從主播放列表中提取子播放列表');
    }

    // 遞歸解析子播放列表
    options?.validateUrl?.(subPlaylistUrl);
    return parseM3U8(subPlaylistUrl, options, depth + 1);
  }

  const task: M3U8Task = {
    url,
    title: extractTitleFromUrl(url),
    type: 'TS',
    tsUrlList: [],
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
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      lastDuration = parseFloat(line.split('#EXTINF:')[1]);
      task.durationSecond += lastDuration;
    } else if (/^[^#]/.test(line) && line.trim()) {
      const tsUrl = applyURL(line.trim(), url);
      options?.validateUrl?.(tsUrl);
      task.tsUrlList.push(tsUrl);
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
  const estimatedBitrate = 2 * 1024 * 1024 / 8; // 2Mbps 轉為字節/秒
  task.totalSize = Math.round(task.durationSecond * estimatedBitrate);

  // 檢測 AES 加密
  if (m3u8Str.includes('#EXT-X-KEY')) {
    const methodMatch = m3u8Str.match(/METHOD=([^,\s]+)/);
    const uriMatch = m3u8Str.match(/URI="([^"]+)"/);
    const ivMatch = m3u8Str.match(/IV=([^,\s]+)/);

    task.aesConf.method = methodMatch ? methodMatch[1] : '';
    task.aesConf.uri = uriMatch ? applyURL(uriMatch[1], url) : '';
    task.aesConf.iv = ivMatch ? ivMatch[1] : '';

    // 獲取 AES key
    if (task.aesConf.uri) {
      options?.validateUrl?.(task.aesConf.uri);
      const keyResponse = await fetch(task.aesConf.uri);
      const keyArrayBuffer = await keyResponse.arrayBuffer();
      task.aesConf.key = arrayBufferToWordArray(keyArrayBuffer);
    }
  }

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
  return `video_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
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
export function aesDecrypt(data: ArrayBuffer, key: any, iv: string): ArrayBuffer {
  if (!key) return data;

  const wordArray = arrayBufferToWordArray(data);
  const ivWordArray = iv ? CryptoJS.enc.Hex.parse(iv.replace('0x', '')) : CryptoJS.lib.WordArray.create();

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

/**
 * 合並所有片段為 Blob
 */
export function mergeSegments(segments: ArrayBuffer[], type: 'TS' | 'MP4'): Blob {
  const mimeType = type === 'MP4' ? 'video/mp4' : 'video/MP2T';
  return new Blob(segments, { type: mimeType });
}

/**
 * 觸發瀏覽器下載
 */
export function triggerDownload(blob: Blob, filename: string, type: 'TS' | 'MP4'): void {
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
  status: 'downloading' | 'processing' | 'done' | 'error';
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
  concurrency = 6, // 默認6個並發
  streamMode: StreamSaverMode = 'disabled', // 邊下邊存模式
  maxRetries = 3, // 最大重試次數
  completeStreamRef?: { current: (() => Promise<void>) | null } // 完成流函數引用（用於邊下邊存模式立即保存）
): Promise<void> {
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
        const { createFileSystemWriteStream } = await import('./stream-saver-fallback');
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

  let completedCount = 0;

  // 串行化寫入函數：確保寫入操作按順序執行，避免多線程並發寫入
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
          pendingWrites.delete(nextWriteIndex);
          nextWriteIndex++;
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`片段 ${nextWriteIndex + 1} 寫入流失敗:`, error);
          // 寫入失敗意味著用戶可能取消了下載，應該停止整個下載任務
          throw new Error(`寫入失敗: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });

    // 等待當前寫入操作完成
    await writeLock;
  };

  // 如果提供了完成流函數引用，設置完成流的函數（需要在 completedCount 和 writer 初始化後設置）
  if (completeStreamRef && streamMode !== 'disabled' && writer) {
    completeStreamRef.current = async () => {
      if (!writer) return;

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
        console.error('提前完成時關閉流失敗:', error);
        throw error;
      }
    };
  }

  // 創建下載隊列
  const downloadQueue: number[] = [];
  for (let i = startSegment - 1; i < endSegment; i++) {
    downloadQueue.push(i);
  }

  // 並發下載函數（帶重試機制）
  const downloadSegment = async (index: number, retryCount = 0): Promise<void> => {
    const retryDelay = 1000; // 重試延遲（毫秒）

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

      let segmentData = await downloadTsSegment(task.tsUrlList[index], signal);

      // 下載完成後檢查暫停狀態，如果暫停則等待恢復
      if (pauseResumeController) {
        await pauseResumeController.waitIfPaused();
      }
      if (signal?.aborted) {
        throw new Error('下載已取消');
      }

      // AES 解密
      if (task.aesConf.key) {
        segmentData = aesDecrypt(segmentData, task.aesConf.key, task.aesConf.iv);
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

      // 更新進度
      onProgress?.({
        current: completedCount,
        total: totalSegments,
        percentage: Math.floor((completedCount / totalSegments) * 100),
        status: 'downloading',
        message: `正在下載 ${completedCount}/${totalSegments} 個片段 (${concurrency} 線程)${retryCount > 0 ? ` [重試成功]` : ''}`,
      });
    } catch (error) {
      // 檢查是否是寫入失敗（用戶取消下載）
      const isWriteError = error instanceof Error && error.message.includes('寫入失敗');
      if (isWriteError) {
        // 寫入失敗意味著用戶可能取消了下載，不應該重試，直接拋出錯誤停止下載
        // eslint-disable-next-line no-console
        console.error('寫入流失敗，用戶可能取消了下載，停止下載任務');
        throw error;
      }

      // 如果還有重試機會，進行重試
      if (retryCount < maxRetries) {
        // eslint-disable-next-line no-console
        console.warn(`片段 ${index + 1} 下載失敗，${retryDelay}ms 後進行第 ${retryCount + 1} 次重試...`);

        onProgress?.({
          current: completedCount,
          total: totalSegments,
          percentage: Math.floor((completedCount / totalSegments) * 100),
          status: 'downloading',
          message: `片段 ${index + 1} 重試中 (${retryCount + 1}/${maxRetries})`,
        });

        // 等待一段時間後重試
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return downloadSegment(index, retryCount + 1);
      }

      // 所有重試都失敗
      task.errorNum++;
      // 標記片段為失敗狀態
      task.finishList[index].status = 'error';
      task.finishList[index].retryCount = retryCount;

      // eslint-disable-next-line no-console
      console.error(`片段 ${index + 1} 下載失敗（已重試 ${maxRetries} 次）:`, error);

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
          message: `片段 ${index + 1} 失敗已跳過 (已完成 ${completedCount}/${totalSegments})`,
        });
      } else {
        // 普通模式下，片段失敗不影響任務狀態，保持 downloading 等待手動重試
        onProgress?.({
          current: completedCount,
          total: totalSegments,
          percentage: Math.floor((completedCount / totalSegments) * 100),
          status: 'downloading',
          message: `片段 ${index + 1} 下載失敗，等待重試 (已完成 ${completedCount}/${totalSegments})`,
        });
      }
    }
  };

  // 並發控制：同時最多 concurrency 個下載任務
  const workers: Promise<void>[] = [];

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
    .some(item => item.status === 'error');

  if (hasFailedSegments) {
    // 有失敗片段，不執行保存，保持下載狀態等待手動重試
    const failedCount = task.finishList
      .slice(startSegment - 1, endSegment)
      .filter(item => item.status === 'error').length;

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
    message: task.type === 'MP4' ? '正在轉碼為 MP4 格式...' : '正在合並視頻文件...',
  });

  // 如果是 MP4 格式，進行轉碼
  let blob: Blob;
  if (task.type === 'MP4') {
    // 傳遞範圍內片段的實際時長累加值
    const actualDuration = task.segmentDurations.slice(startSegment - 1, endSegment).reduce((a, b) => a + b, 0);
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
