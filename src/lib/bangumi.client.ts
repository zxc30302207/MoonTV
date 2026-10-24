'use client';

import { memoizeAsync } from './async-cache';
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
  return detail;
}

/**
 * 獲取 Bangumi 條目詳情（劇情簡介）。
 * 通過服務端 /api/detail?provider=bangumi 獲取，復用站點配置的 Bangumi 代理。
 * 失敗時向調用方拋出異常，由調用方決定降級方式。
 */
export const GetBangumiSubjectDetail = memoizeAsync(
  (id: string) => id,
  requestSubjectDetail
);

export async function getBangumiSubjectIntro(id: string): Promise<string> {
  return (await GetBangumiSubjectDetail(id)).summary;
}
