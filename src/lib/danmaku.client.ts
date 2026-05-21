/* eslint-disable @typescript-eslint/no-explicit-any */

import { DanmakuItem, DanmakuResponse } from './types';

/**
 * 彈幕格式類型
 */
export type DanmakuFormat = 'json' | 'xml';

/**
 * 獲取彈幕 API 基礎 URL
 * 從環境變量或配置中獲取，默認為空（使用相對路徑）
 */
function getDanmakuApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';

  const baseUrl =
    (window as any).RUNTIME_CONFIG?.DANMU_API_BASE_URL ||
    process.env.NEXT_PUBLIC_DANMU_API_BASE_URL ||
    '';

  return baseUrl;
}

/**
 * 獲取彈幕格式配置
 * 固定為 xml 格式（允許通過查詢參數臨時覆蓋）
 */
function getDanmakuFormat(format?: string): DanmakuFormat {
  // 查詢參數優先級最高（允許臨時覆蓋）
  if (format === 'xml' || format === 'json') {
    return format;
  }

  // 默認固定為 xml
  return 'xml';
}

/**
 * 解析 JSON 格式的彈幕數據（實際 API 格式）
 */
function parseJsonDanmaku(json: DanmakuResponse): DanmakuItem[] {
  const danmakuList: DanmakuItem[] = [];

  // 處理實際格式：{ count, comments: [{ cid, p, m, t }] }
  if (json.comments && Array.isArray(json.comments)) {
    for (const comment of json.comments) {
      if (!comment.m) continue; // 沒有文本內容，跳過

      // 解析 p 字段：格式為 "時間,類型,顏色,作者"
      // 例如："0.45,5,16777215,[bilibili1]"
      const pParts = comment.p ? comment.p.split(',') : [];

      // 優先使用 t 字段作為時間，如果沒有則從 p 解析
      const time =
        comment.t !== undefined
          ? comment.t
          : pParts[0]
          ? parseFloat(pParts[0])
          : 0;
      const type = pParts[1] ? parseInt(pParts[1]) : 1; // 默認滾動彈幕
      const color = pParts[2] ? parseInt(pParts[2]) : 16777215; // 默認白色
      const size = 25; // 默認大小
      const pool = pParts.length > 4 ? parseInt(pParts[4]) : 0;

      danmakuList.push({
        time,
        type,
        color,
        text: comment.m,
        size,
        pool,
      });
    }
  }

  // 兼容舊格式：{ data: [...] } 或 { comments: DanmakuItem[] }
  if (json.data && Array.isArray(json.data)) {
    danmakuList.push(...json.data);
  }

  return danmakuList;
}

/**
 * 解析 XML 格式的彈幕數據
 */
function parseXmlDanmaku(xmlText: string): DanmakuItem[] {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  const danmakuList: DanmakuItem[] = [];

  const danmakuElements = xmlDoc.getElementsByTagName('d');

  for (let i = 0; i < danmakuElements.length; i++) {
    const element = danmakuElements[i];
    const p = element.getAttribute('p') || '';
    const text = element.textContent || '';

    if (!p || !text) continue;

    const parts = p.split(',');
    if (parts.length < 4) continue;

    const time = parseFloat(parts[0]) || 0;
    const type = parseInt(parts[1]) || 1;
    const size = parseInt(parts[2]) || 25;
    const color = parseInt(parts[3]) || 16777215; // 默認白色
    const pool = parts.length > 4 ? parseInt(parts[4]) : 0;

    danmakuList.push({
      time,
      type,
      color,
      text,
      size,
      pool,
    });
  }

  return danmakuList;
}

/**
 * 通過評論 ID 獲取彈幕
 * @param commentId 評論 ID
 * @param format 彈幕格式（json 或 xml）
 */
export async function getDanmakuByCommentId(
  commentId: string,
  format?: string
): Promise<DanmakuItem[]> {
  if (!commentId) {
    throw new Error('評論 ID 不能為空');
  }

  const baseUrl = getDanmakuApiBaseUrl();
  const danmakuFormat = getDanmakuFormat(format);
  const url = `${baseUrl}/api/v2/comment/${commentId}?format=${danmakuFormat}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    if (danmakuFormat === 'xml') {
      const xmlText = await response.text();
      return parseXmlDanmaku(xmlText);
    } else {
      const json: DanmakuResponse = await response.json();
      return parseJsonDanmaku(json);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('獲取彈幕失敗:', error);
    throw new Error(`獲取彈幕失敗: ${(error as Error).message}`);
  }
}

/**
 * 搜索動漫接口響應
 */
interface AnimeSearchResult {
  code?: number;
  message?: string;
  data?: Array<{
    id: string;
    name: string;
    name_cn?: string;
    [key: string]: any;
  }>;
  list?: Array<{
    id: string;
    name: string;
    name_cn?: string;
    [key: string]: any;
  }>;
}

/**
 * 劇集信息接口響應（實際 API 格式）
 */
export interface EpisodeSearchResult {
  errorCode: number;
  success: boolean;
  errorMessage: string;
  animes: Array<{
    animeId: number;
    animeTitle: string;
    type: string;
    typeDescription: string;
    episodes: Array<{
      episodeId: number;
      episodeTitle: string;
    }>;
  }>;
}

/**
 * 動漫選項（用於用戶選擇）
 */
export interface AnimeOption {
  animeId: number;
  animeTitle: string;
  type: string;
  typeDescription: string;
  episodeCount: number;
  episodes: Array<{
    episodeId: number;
    episodeTitle: string;
  }>;
}

export interface AnimeMatch {
  animeId: number;
  animeTitle: string;
  type: string;
  typeDescription: string;
  episodeId: number;
  episodeTitle: string;
}

/**
 * 動漫詳情接口響應
 */
interface BangumiDetailResult {
  code?: number;
  message?: string;
  data?: {
    id: string;
    name: string;
    name_cn?: string;
    episodes?: Array<{
      id: string;
      name: string;
      episode: number;
      comment_id?: string;
      [key: string]: any;
    }>;
    [key: string]: any;
  };
}

/**
 * 根據關鍵字搜索動漫
 * @param keyword 搜索關鍵字（通常是視頻標題）
 */
export async function searchAnime(
  keyword: string
): Promise<AnimeSearchResult['data']> {
  if (!keyword) {
    throw new Error('搜索關鍵字不能為空');
  }

  const baseUrl = getDanmakuApiBaseUrl();
  const url = `${baseUrl}/api/v2/search/anime?keyword=${encodeURIComponent(
    keyword
  )}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const json: AnimeSearchResult = await response.json();
    return json.data || json.list || [];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('搜索動漫失敗:', error);
    throw new Error(`搜索動漫失敗: ${(error as Error).message}`);
  }
}

/**
 * 根據關鍵詞搜索所有匹配的劇集信息
 * @param animeTitle 動漫標題（搜索關鍵字）
 */

export async function matchAnime(
  fileName: string,
  signal?: AbortSignal
): Promise<AnimeMatch[]> {
  if (!fileName) {
    throw new Error('fileName 不能為空');
  }

  const baseUrl = getDanmakuApiBaseUrl();

  try {
    const response = await fetch(`${baseUrl}/api/v2/match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileName }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status = ${response.status}`);
    }

    const json = await response.json();

    return normalizeAnimeMatches(json);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('matchAnime 失敗:', err);
    throw err;
  }
}

function normalizeAnimeMatches(json: unknown): AnimeMatch[] {
  const payload = json as {
    matches?: unknown;
    data?: unknown;
  };
  const data = payload?.data as { matches?: unknown } | unknown[] | undefined;
  const rawMatches = Array.isArray(payload?.matches)
    ? payload.matches
    : data && !Array.isArray(data) && Array.isArray(data.matches)
    ? data.matches
    : Array.isArray(data)
    ? data
    : [];

  return rawMatches
    .map((match) => normalizeAnimeMatch(match))
    .filter((match): match is AnimeMatch => Boolean(match));
}

function normalizeAnimeMatch(match: unknown): AnimeMatch | null {
  const raw = match as Record<string, unknown>;
  const animeId = toNumber(raw.animeId ?? raw.anime_id);
  const episodeId = toNumber(raw.episodeId ?? raw.episode_id);
  const animeTitle = toText(raw.animeTitle ?? raw.anime_title);
  const episodeTitle =
    toText(raw.episodeTitle ?? raw.episode_title) ||
    (episodeId ? `EP${episodeId}` : '');

  if (!animeId || !episodeId || !animeTitle || !episodeTitle) {
    return null;
  }

  return {
    animeId,
    animeTitle,
    type: toText(raw.type),
    typeDescription: toText(raw.typeDescription ?? raw.type_description),
    episodeId,
    episodeTitle,
  };
}

function toNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 根據關鍵詞搜索所有匹配的劇集信息
 * @param animeTitle 動漫標題（搜索關鍵字）
 */
export async function searchEpisodes(
  animeTitle: string
): Promise<AnimeOption[]> {
  if (!animeTitle) {
    throw new Error('搜索關鍵字不能為空');
  }

  const baseUrl = getDanmakuApiBaseUrl();
  const url = `${baseUrl}/api/v2/search/episodes?anime=${encodeURIComponent(
    animeTitle
  )}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const json: EpisodeSearchResult = await response.json();

    if (!json.success || json.errorCode !== 0) {
      throw new Error(json.errorMessage || '搜索失敗');
    }

    // 轉換為選項格式
    return (json.animes || []).map((anime) => ({
      animeId: anime.animeId,
      animeTitle: anime.animeTitle,
      type: anime.type,
      typeDescription: anime.typeDescription,
      episodeCount: anime.episodes?.length || 0,
      episodes: anime.episodes || [],
    }));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('搜索劇集失敗:', error);
    throw new Error(`搜索劇集失敗: ${(error as Error).message}`);
  }
}

/**
 * 獲取指定動漫的詳細信息
 * @param animeId 動漫 ID
 */
export async function getBangumiDetail(
  animeId: string
): Promise<BangumiDetailResult['data'] | undefined> {
  if (!animeId) {
    throw new Error('動漫 ID 不能為空');
  }

  const baseUrl = getDanmakuApiBaseUrl();
  const url = `${baseUrl}/api/v2/bangumi/${animeId}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const json: BangumiDetailResult = await response.json();
    return json.data;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('獲取動漫詳情失敗:', error);
    throw new Error(`獲取動漫詳情失敗: ${(error as Error).message}`);
  }
}

/**
 * 根據視頻信息獲取彈幕
 * @param videoInfo 視頻信息
 * @param format 彈幕格式（json 或 xml）
 */
export interface VideoInfo {
  title: string;
  year?: string;
  episode?: number; // 集數（從1開始）
  type?: 'tv' | 'movie'; // 類型：電視劇或電影
}

/**
 * 從標題中提取季數（Season）
 * @param title 動漫標題
 * @returns 季數（從 1 開始），如果無法提取則返回 1
 */
export function extractSeasonFromTitle(title: string): number {
  if (!title) return 1;

  title = title.toLowerCase();

  // 正則1：S01、S1、Season 1、Season01
  const match = title.match(/(?:season|s)\s*?(\d{1,2})/i);
  if (match && match[1]) {
    return Number(match[1]);
  }

  // 正則2：中文「第1季、第2季」
  const cnMatch = title.match(/第\s*(\d+)\s*季/);
  if (cnMatch && cnMatch[1]) {
    return Number(cnMatch[1]);
  }

  // 默認季別
  return 1;
}

/**
 * 從集數標題中提取集數
 * @param episodeTitle 集數標題
 * @returns 集數（從1開始），如果無法提取則返回 null
 */
export function extractEpisodeNumber(episodeTitle: string): number | null {
  if (!episodeTitle) return null;

  // 1. "第X集" 或 "第X話"
  let match = episodeTitle.match(/第(\d+)[集話]/);
  if (match) {
    return parseInt(match[1]);
  }

  // 2. 匹配所有數字，優先選擇較大的數字（通常是集數）
  // 支持格式如: "[youku] 166", "166", "EP166", "第166話" 等
  const allNumbers = episodeTitle.match(/\d+/g);
  if (allNumbers && allNumbers.length > 0) {
    // 如果有多個數字，選擇最大的（通常是集數）
    const numbers = allNumbers
      .map((n) => parseInt(n))
      .filter((n) => n >= 1 && n <= 10000);
    if (numbers.length > 0) {
      // 優先選擇較大的數字（通常是集數），但也要考慮合理性
      const maxNum = Math.max(...numbers);
      // 如果最大數字在合理範圍內，使用它
      if (maxNum >= 1 && maxNum <= 10000) {
        return maxNum;
      }
    }
  }

  // 3. 舊的正則匹配（作為備選）
  match = episodeTitle.match(/(?:^|[^0-9])(\d+)(?:[集話]|$)/);
  if (match) {
    const num = parseInt(match[1]);
    // 如果數字在合理範圍內（1-10000），認為是集數
    if (num >= 1 && num <= 10000) {
      return num;
    }
  }

  return null;
}

export function resolveDanmakuEpisodeNumber(
  episodeTitle: string | null | undefined,
  episodeIndex: number
): number {
  return extractEpisodeNumber(episodeTitle || '') || episodeIndex + 1;
}

/**
 * 根據選中的動漫和集數獲取彈幕 URL 地址
 * @param selectedAnime 選中的動漫選項
 * @param episodeNumber 集數（從1開始，基於彈幕選擇器中選擇的集數）
 * @param format 彈幕格式（json 或 xml）
 */
export async function getDanmakuBySelectedAnime(
  selectedAnime: AnimeOption,
  episodeNumber: number,
  format?: string
): Promise<string> {
  if (!selectedAnime) {
    throw new Error('未選擇動漫');
  }

  const danmakuFormat = getDanmakuFormat(format);

  // 直接使用集數索引（episodeNumber 是從彈幕選擇器中選擇的，已經是正確的索引）
  if (episodeNumber < 1 || episodeNumber > selectedAnime.episodes.length) {
    throw new Error(
      `集數 ${episodeNumber} 超出範圍（共 ${selectedAnime.episodes.length} 集）`
    );
  }

  const targetEpisode = selectedAnime.episodes[episodeNumber - 1];

  if (!targetEpisode) {
    throw new Error(`未找到第 ${episodeNumber} 集的彈幕`);
  }

  return getDanmakuUrlByEpisodeId(targetEpisode.episodeId, danmakuFormat);
}

export function getDanmakuUrlByEpisodeId(
  episodeId: number | string,
  format?: string
): string {
  if (!episodeId) {
    throw new Error('彈幕 episodeId 不能為空');
  }

  const baseUrl = getDanmakuApiBaseUrl();
  const danmakuFormat = getDanmakuFormat(format);
  return `${baseUrl}/api/v2/comment/${episodeId.toString()}?format=${danmakuFormat}`;
}
