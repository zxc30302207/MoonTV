'use client';

/**
 * 播放源詳情簡介獲取（瀏覽器端）。
 * 用於播放記錄 / 收藏 / 搜索等沒有豆瓣條目 ID 的卡片。
 */

const CACHE_LIMIT = 200;
let cacheGeneration = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('moontv:logout', () => {
    cacheGeneration += 1;
    descCache.clear();
    descRequests.clear();
  });
}
const descCache = new Map<string, string>();
// 並發去重：同一 source+id 在請求返回前只發起一次網絡請求
const descRequests = new Map<string, Promise<string>>();

function getCacheKey(source: string, id: string, title: string): string {
  return `${source}::${id}::${title}`;
}

function cacheDesc(key: string, desc: string): void {
  if (descCache.size >= CACHE_LIMIT) {
    // 簡單 FIFO 淘汰，避免長時間瀏覽後緩存無限增長
    const oldestKey = descCache.keys().next().value;
    if (oldestKey !== undefined) {
      descCache.delete(oldestKey);
    }
  }
  descCache.set(key, desc);
}

async function requestDesc(
  source: string,
  id: string,
  title: string
): Promise<string> {
  const generation = cacheGeneration;
  const controller = new AbortController();
  // 搜索單源可能較慢，留出比詳情接口更長的等待時間
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const params = new URLSearchParams({ source, id, fields: 'desc' });
    if (title) {
      params.set('title', title);
    }

    const response = await fetch(`/api/detail?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as { desc?: unknown };
    const desc = typeof data.desc === 'string' ? data.desc : '';
    if (generation !== cacheGeneration) return '';
    cacheDesc(getCacheKey(source, id, title), desc);
    return desc;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 獲取播放源條目的劇情簡介。
 * 命中緩存直接返回；同一內容的並發請求會復用同一個 Promise。
 */
export function getVideoDesc(
  source: string,
  id: string,
  title = ''
): Promise<string> {
  const key = getCacheKey(source, id, title);

  const cached = descCache.get(key);
  if (cached !== undefined) {
    // 命中後刷新順序，實現近似 LRU 的淘汰順序
    descCache.delete(key);
    descCache.set(key, cached);
    return Promise.resolve(cached);
  }

  const inflight = descRequests.get(key);
  if (inflight) {
    return inflight;
  }

  const request = requestDesc(source, id, title);
  descRequests.set(key, request);

  void request
    .catch(() => {
      // 失敗結果由調用方處理，此處僅避免未處理的 Promise 拒絕
    })
    .finally(() => {
      if (descRequests.get(key) === request) descRequests.delete(key);
    });

  return request;
}
