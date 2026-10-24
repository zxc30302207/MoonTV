'use client';

import { memoizeAsync } from './async-cache';

async function requestDesc(
  source: string,
  id: string,
  title = ''
): Promise<string> {
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
    return desc;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 登出使快取與進行中請求失效，不能回傳前一個帳號的資料。 */
export const getVideoDesc = memoizeAsync(
  (source: string, id: string, title = '') =>
    JSON.stringify([source, id, title]),
  requestDesc,
  200,
  () => ''
);
