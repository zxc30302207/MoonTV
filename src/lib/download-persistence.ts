/**
 * 下載任務的片段完成狀態持久化。
 *
 * 背景：`DownloadManager` 保存任務到 localStorage 時排除了 `parsedTask`
 * （finishList 各片段的 success/error/pending 狀態），導致頁面刷新後
 * finishList 丟失、斷點續傳實際從頭再來。這裡把 finishList 狀態和
 * 普通模式下已下載的片段數據單獨持久化，使刷新後能真正續傳。
 */

import type { M3U8Task } from './m3u8-downloader';

const DOWNLOAD_STATE_KEY = 'downloadTaskStates';
/** 普通模式下已下載片段的 Cache Storage 桶名 */
const DOWNLOAD_SEGMENT_CACHE = 'moontv-download-segments';

/** 單個任務持久化的最小狀態：只存各片段完成狀態，不存 ArrayBuffer 數據 */
export interface DownloadTaskPersistState {
  /** 每個片段的完成狀態（與 M3U8Task.finishList 對齊，只留 status 與 retryCount） */
  finishList: Array<{
    status: '' | 'downloading' | 'success' | 'error';
    retryCount?: number;
  }>;
  /** 片段總數（用於校驗 m3u8 是否變更） */
  totalSegments: number;
  segmentUrls?: string[];
  /** 最後更新時間戳 */
  updatedAt: number;
}

type StateMap = Record<string, DownloadTaskPersistState>;

function readAll(): StateMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(DOWNLOAD_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as StateMap)
      : {};
  } catch {
    return {};
  }
}

function writeAll(map: StateMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DOWNLOAD_STATE_KEY, JSON.stringify(map));
  } catch {
    // 隱私模式 / 配額滿時靜默失敗，不影響下載本身
  }
}

/** 從任務裡抽取可持久化的完成狀態 */
export function persistDownloadState(taskId: string, task: M3U8Task): void {
  const map = readAll();
  map[taskId] = {
    finishList: task.finishList.map((item) => ({
      status: item.status,
      ...(item.retryCount !== undefined ? { retryCount: item.retryCount } : {}),
    })),
    totalSegments: task.finishList.length,
    segmentUrls: [...task.tsUrlList],
    updatedAt: Date.now(),
  };
  writeAll(map);
}

/** 讀取任務的持久化狀態（不存在或片段數不匹配時返回 null） */
export function loadDownloadState(
  taskId: string
): DownloadTaskPersistState | null {
  const state = readAll()[taskId];
  return state &&
    Number.isInteger(state.totalSegments) &&
    state.totalSegments > 0 &&
    Array.isArray(state.finishList) &&
    state.finishList.length === state.totalSegments
    ? state
    : null;
}

/** 任務完成/刪除後清理持久化狀態 */
export function clearDownloadState(taskId: string): void {
  const map = readAll();
  if (map[taskId]) {
    delete map[taskId];
    writeAll(map);
  }
  // 清理該任務的已下片段緩存
  void clearDownloadSegments(taskId);
}

/* ------------------------------------------------------------------ */
/* 普通模式下已下載片段的 Cache Storage 持久化（用於刷新後續傳復用）  */
/* ------------------------------------------------------------------ */

function segmentCacheKey(taskId: string, index: number): string {
  return new URL(
    `/__moontv_downloads__/${encodeURIComponent(taskId)}/${index}`,
    window.location.origin
  ).href;
}

export async function saveDownloadSegment(
  taskId: string,
  index: number,
  data: ArrayBuffer,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return;
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(DOWNLOAD_SEGMENT_CACHE);
    if (signal?.aborted) return;
    const key = segmentCacheKey(taskId, index);
    await cache.put(
      key,
      new Response(data, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    );
    if (signal?.aborted) await cache.delete(key);
  } catch {
    // 寫緩存失敗不影響下載，只是無法跨刷新復用
  }
}

export async function loadDownloadSegment(
  taskId: string,
  index: number
): Promise<ArrayBuffer | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(DOWNLOAD_SEGMENT_CACHE);
    const resp = await cache.match(segmentCacheKey(taskId, index));
    if (!resp) return null;
    return await resp.arrayBuffer();
  } catch {
    return null;
  }
}

export async function clearDownloadSegments(taskId: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(DOWNLOAD_SEGMENT_CACHE);
    const keys = await cache.keys();
    const prefix = new URL(
      `/__moontv_downloads__/${encodeURIComponent(taskId)}/`,
      window.location.origin
    ).href;
    await Promise.all(
      keys
        .filter((req) => req.url.startsWith(prefix))
        .map((req) => cache.delete(req))
    );
  } catch {
    // ignore
  }
}

/** 只有仍可取得完整位元組的片段才能略過，避免快取被清除後產出損毀檔案。 */
export async function restoreDownloadProgress(
  taskId: string,
  task: M3U8Task
): Promise<number> {
  if (!(task.downloadedSegments instanceof Map))
    task.downloadedSegments = new Map();
  const state = loadDownloadState(taskId);
  if (!state || state.totalSegments !== task.tsUrlList.length) return 0;
  if (
    state.segmentUrls &&
    state.segmentUrls.some((url, index) => url !== task.tsUrlList[index])
  )
    return 0;
  const segments =
    task.downloadedSegments instanceof Map
      ? task.downloadedSegments
      : new Map<number, ArrayBuffer>();
  let restored = 0;
  for (let index = 0; index < task.finishList.length; index += 1) {
    if (state.finishList[index]?.status !== 'success') continue;
    const data =
      segments.get(index) ?? (await loadDownloadSegment(taskId, index));
    if (data) {
      segments.set(index, data);
      task.finishList[index].status = 'success';
      restored += 1;
    } else {
      task.finishList[index].status = '';
    }
  }
  task.downloadedSegments = segments;
  return restored;
}
