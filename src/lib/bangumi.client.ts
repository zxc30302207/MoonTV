'use client';
export interface BangumiCalendarData {
  weekday: {
    en: string;
  };
  items: {
    id: number;
    name: string;
    name_cn: string;
    rating: {
      score: number;
    };
    air_date: string;
    images: {
      large: string;
      common: string;
      medium: string;
      small: string;
      grid: string;
    };
  }[];
}

/**
 * 校驗 /api/bangumi/calendar 返回的單條數據。
 * 上游（Bangumi 代理）返回結構不可信，髒數據會在渲染層觸發
 * `Cannot read properties of undefined` 之類的崩潰，因此在入口處過濾。
 */
function isBangumiCalendarEntry(value: unknown): value is BangumiCalendarData {
  if (!value || typeof value !== 'object') return false;
  const entry = value as { weekday?: unknown; items?: unknown };
  if (!entry.weekday || typeof entry.weekday !== 'object') return false;
  const weekday = entry.weekday as { en?: unknown };
  return typeof weekday.en === 'string' && Array.isArray(entry.items);
}

export async function GetBangumiCalendarData(): Promise<BangumiCalendarData[]> {
  try {
    const response = await fetch('/api/bangumi/calendar', {
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data: unknown = await response.json();
    if (!Array.isArray(data)) return [];
    return data.filter(isBangumiCalendarEntry);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Bangumi 日曆請求失敗:', error);
    return [];
  }
}

export interface BangumiSubjectDetail {
  id: string;
  title: string;
  year: string;
  rate: string;
  summary: string;
}

// 詳情內存緩存，避免同一卡片多次打開菜單時重復請求
const BANGUMI_SUBJECT_CACHE_LIMIT = 200;
const bangumiSubjectCache = new Map<string, BangumiSubjectDetail>();
// 並發去重：同一 id 在請求返回前只發起一次網絡請求
const bangumiSubjectRequests = new Map<string, Promise<BangumiSubjectDetail>>();

function cacheSubjectDetail(id: string, detail: BangumiSubjectDetail): void {
  if (bangumiSubjectCache.size >= BANGUMI_SUBJECT_CACHE_LIMIT) {
    // 簡單的 FIFO 淘汰，防止長時間瀏覽後緩存無限增長
    const oldestKey = bangumiSubjectCache.keys().next().value;
    if (oldestKey !== undefined) {
      bangumiSubjectCache.delete(oldestKey);
    }
  }
  bangumiSubjectCache.set(id, detail);
}

async function requestSubjectDetail(id: string): Promise<BangumiSubjectDetail> {
  const response = await fetch(
    `/api/detail?provider=bangumi&id=${encodeURIComponent(id)}&fields=desc`,
    {
      headers: {
        Accept: 'application/json',
      },
    }
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = (await response.json()) as { desc?: unknown };
  const detail: BangumiSubjectDetail = {
    id,
    title: '',
    year: '',
    rate: '',
    summary: typeof data.desc === 'string' ? data.desc : '',
  };
  cacheSubjectDetail(id, detail);
  return detail;
}

/**
 * 獲取 Bangumi 條目詳情（劇情簡介）。
 * 通過服務端 /api/detail?provider=bangumi 獲取，復用站點配置的 Bangumi 代理。
 * 失敗時向調用方拋出異常，由調用方決定降級方式。
 */
export function GetBangumiSubjectDetail(
  id: string
): Promise<BangumiSubjectDetail> {
  const cached = bangumiSubjectCache.get(id);
  if (cached) {
    // 命中緩存後刷新順序，實現近似 LRU 的淘汰順序
    bangumiSubjectCache.delete(id);
    bangumiSubjectCache.set(id, cached);
    return Promise.resolve(cached);
  }

  const inflight = bangumiSubjectRequests.get(id);
  if (inflight) {
    return inflight;
  }

  const request = requestSubjectDetail(id);
  bangumiSubjectRequests.set(id, request);

  void request
    .catch(() => {
      // 失敗結果由調用方處理，此處僅避免 promises 未被消費導致的未處理拒絕
    })
    .finally(() => {
      bangumiSubjectRequests.delete(id);
    });

  return request;
}
