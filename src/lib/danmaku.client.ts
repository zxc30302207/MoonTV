/* eslint-disable @typescript-eslint/no-explicit-any */

import { DEFAULT_DANMAKU_API_BASE_URL } from './danmaku.constants';
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
  if (typeof window === 'undefined') return DEFAULT_DANMAKU_API_BASE_URL;

  const baseUrl =
    (window as any).RUNTIME_CONFIG?.DANMU_API_BASE_URL ||
    process.env.NEXT_PUBLIC_DANMU_API_BASE_URL ||
    DEFAULT_DANMAKU_API_BASE_URL;

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
  errorCode?: number;
  success?: boolean;
  errorMessage?: string;
  animes?: Array<{
    animeId?: number | string;
    bangumiId?: number | string;
    animeTitle?: string;
    type?: string;
    typeDescription?: string;
    [key: string]: any;
  }>;
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

export interface DanmakuMatchFileNameOptions {
  title: string;
  year?: string;
  episodeNumber: number;
  season?: number;
  platform?: string;
}

export type AutoDanmakuMatchSource = 'match' | 'search';

export interface AutoDanmakuMatchOptions extends DanmakuMatchFileNameOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  preferSearchSource?: boolean;
}

export interface AutoDanmakuMatchResult {
  match: AnimeMatch | null;
  source: AutoDanmakuMatchSource | null;
  fileName: string | null;
  error: unknown | null;
}

export class DanmakuRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'DanmakuRequestError';
  }
}

/**
 * 動漫詳情接口響應
 */
interface BangumiDetailResult {
  errorCode?: number;
  success?: boolean;
  errorMessage?: string;
  bangumi?: {
    animeId?: number | string;
    bangumiId?: number | string;
    animeTitle?: string;
    type?: string;
    typeDescription?: string;
    episodes?: Array<{
      episodeId?: number | string;
      episodeTitle?: string;
      episodeNumber?: number | string;
      [key: string]: any;
    }>;
    [key: string]: any;
  };
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
  keyword: string,
  signal?: AbortSignal
): Promise<NonNullable<AnimeSearchResult['animes']>> {
  if (!keyword) {
    throw new Error('搜索關鍵字不能為空');
  }

  const baseUrl = getDanmakuApiBaseUrl();
  const url = `${baseUrl}/api/v2/search/anime?keyword=${encodeURIComponent(
    keyword
  )}`;

  try {
    const response = await fetch(url, { signal });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const json: AnimeSearchResult = await response.json();
    return normalizeAnimeSearchResults(json);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    // eslint-disable-next-line no-console
    console.error('搜索動漫失敗:', error);
    throw new Error(`搜索動漫失敗: ${(error as Error).message}`);
  }
}

function normalizeAnimeSearchResults(
  json: AnimeSearchResult
): NonNullable<AnimeSearchResult['animes']> {
  if (Array.isArray(json.animes)) return json.animes;

  const legacyItems = json.data || json.list || [];
  return legacyItems.map((item) => ({
    animeId: item.id,
    bangumiId: item.id,
    animeTitle: item.name_cn || item.name,
    type: toText(item.type),
    typeDescription: toText(item.typeDescription ?? item.type_description),
  }));
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

    if (!response.ok) throw await createDanmakuRequestError(response);

    const json = await response.json();

    return normalizeAnimeMatches(json);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }

    // eslint-disable-next-line no-console
    console.error('matchAnime 失敗:', err);
    throw err;
  }
}

async function createDanmakuRequestError(
  response: Response
): Promise<DanmakuRequestError> {
  const fallbackMessage = `HTTP error! status = ${response.status}`;

  try {
    const text = await response.text();
    if (!text) return new DanmakuRequestError(fallbackMessage, response.status);

    const payload = JSON.parse(text) as {
      code?: unknown;
      error?: unknown;
      message?: unknown;
    };
    const code = typeof payload.code === 'string' ? payload.code : undefined;
    const message =
      typeof payload.error === 'string'
        ? payload.error
        : typeof payload.message === 'string'
        ? payload.message
        : fallbackMessage;

    return new DanmakuRequestError(message, response.status, code);
  } catch {
    return new DanmakuRequestError(fallbackMessage, response.status);
  }
}

export async function matchAnimeCandidates(
  fileNames: string[],
  signal?: AbortSignal
): Promise<{ matches: AnimeMatch[]; fileName: string | null }> {
  for (const fileName of fileNames) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      const matches = await matchAnime(fileName, signal);
      if (matches.length > 0) {
        return { matches, fileName };
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }

      // Some upstream danmaku servers occasionally fail a single match shape.
      // Keep trying the remaining candidates so auto-load can still fall back
      // to the same episode search flow used by manual selection.
      // eslint-disable-next-line no-console
      console.warn('彈幕候選匹配失敗，改試下一個:', fileName, error);
    }
  }

  return { matches: [], fileName: null };
}

export async function findAutoDanmakuMatch(
  options: AutoDanmakuMatchOptions
): Promise<AutoDanmakuMatchResult> {
  if (options.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const timeoutMs = Math.max(1000, options.timeoutMs || 7000);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  options.signal?.addEventListener('abort', abortFromParent, { once: true });

  const fileNames = buildDanmakuMatchFileNames(options);
  const searchTask = createAutoDanmakuTask('search', async () => {
    const animes = await searchEpisodes(options.title, controller.signal);
    return {
      fileName: null,
      match: findDanmakuEpisodeFromSearch(
        animes || [],
        options.episodeNumber,
        options.platform
      ),
    };
  });
  const matchTask = createAutoDanmakuTask('match', async () => {
    const { matches, fileName } = await matchAnimeCandidates(
      fileNames,
      controller.signal
    );
    return {
      fileName,
      match: matches[0] || null,
    };
  });
  const tasks = [searchTask, matchTask];

  const pending = new Set(tasks);
  let lastError: unknown = null;

  try {
    if (options.preferSearchSource) {
      const searchResult = await searchTask;
      pending.delete(searchTask);

      if (options.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      if (searchResult.match) {
        controller.abort();
        return {
          match: searchResult.match,
          source: searchResult.source,
          fileName: searchResult.fileName,
          error: null,
        };
      }

      if (searchResult.error) {
        lastError = searchResult.error;
      }
    }

    while (pending.size > 0) {
      const result = await Promise.race(pending);
      pending.delete(result.task);

      if (options.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      if (result.match) {
        controller.abort();
        return {
          match: result.match,
          source: result.source,
          fileName: result.fileName,
          error: null,
        };
      }

      if (result.error) {
        lastError = result.error;
      }
    }

    return {
      match: null,
      source: null,
      fileName: null,
      error: lastError,
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromParent);
  }
}

type AutoDanmakuTaskResult = AutoDanmakuMatchResult & {
  source: AutoDanmakuMatchSource;
  task: Promise<AutoDanmakuTaskResult>;
};

function createAutoDanmakuTask(
  source: AutoDanmakuMatchSource,
  run: () => Promise<Pick<AutoDanmakuMatchResult, 'match' | 'fileName'>>
): Promise<AutoDanmakuTaskResult> {
  const task: Promise<AutoDanmakuTaskResult> = run()
    .then((result) => ({
      source,
      match: result.match,
      fileName: result.fileName,
      error: null,
      task,
    }))
    .catch((error) => ({
      source,
      match: null,
      fileName: null,
      error,
      task,
    }));
  return task;
}

export function buildDanmakuMatchFileNames(
  options: DanmakuMatchFileNameOptions
): string[] {
  const title = options.title.trim();
  if (!title) return [];

  const episodeNumber = Math.max(1, Math.floor(options.episodeNumber || 1));
  const season = Math.max(1, Math.floor(options.season || 1));
  const paddedSeason = String(season).padStart(2, '0');
  const paddedEpisode = String(episodeNumber).padStart(2, '0');
  const year = options.year?.match(/\d{4}/)?.[0] || '';
  const platformSuffix = options.platform ? ` @${options.platform}` : '';
  const titles = year ? [`${title} ${year}`, title] : [title];
  const patterns = [
    `S${paddedSeason}E${paddedEpisode}`,
    `S${season}E${episodeNumber}`,
    `第${episodeNumber}集`,
    `EP${episodeNumber}`,
    `${episodeNumber}`,
  ];
  const candidates: string[] = [];

  for (const candidateTitle of titles) {
    for (const pattern of patterns) {
      candidates.push(`${candidateTitle} ${pattern}${platformSuffix}`);
    }
  }

  if (options.platform) {
    for (const candidateTitle of titles) {
      for (const pattern of patterns) {
        candidates.push(`${candidateTitle} ${pattern}`);
      }
    }
  }

  return Array.from(new Set(candidates));
}

function normalizeAnimeMatches(json: unknown): AnimeMatch[] {
  const payload = json as {
    isMatched?: unknown;
    matches?: unknown;
    data?: unknown;
  };

  if (payload?.isMatched === false) {
    return [];
  }

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
  animeTitle: string,
  signal?: AbortSignal
): Promise<AnimeOption[]> {
  if (!animeTitle) {
    throw new Error('搜索關鍵字不能為空');
  }

  try {
    const fastOptions = await searchEpisodesByAnimeDetail(animeTitle, signal);
    if (fastOptions.length > 0) {
      return fastOptions;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    // eslint-disable-next-line no-console
    console.warn('快速彈幕搜尋失敗，改用完整搜尋:', error);
  }

  const baseUrl = getDanmakuApiBaseUrl();
  const url = `${baseUrl}/api/v2/search/episodes?anime=${encodeURIComponent(
    animeTitle
  )}`;

  try {
    const response = await fetch(url, { signal });

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
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    // eslint-disable-next-line no-console
    console.error('搜索劇集失敗:', error);
    throw new Error(`搜索劇集失敗: ${(error as Error).message}`);
  }
}

async function searchEpisodesByAnimeDetail(
  animeTitle: string,
  signal?: AbortSignal
): Promise<AnimeOption[]> {
  const animes = await searchAnime(animeTitle, signal);
  const candidates = animes
    .map((anime) => ({
      animeId: toNumber(anime.animeId ?? anime.bangumiId),
      animeTitle: toText(anime.animeTitle),
      type: toText(anime.type),
      typeDescription: toText(anime.typeDescription),
    }))
    .filter(
      (
        anime
      ): anime is {
        animeId: number;
        animeTitle: string;
        type: string;
        typeDescription: string;
      } => Boolean(anime.animeId && anime.animeTitle)
    )
    .slice(0, 5);

  if (candidates.length === 0) return [];

  const settled = await Promise.allSettled(
    candidates.map((anime) => fetchBangumiEpisodes(anime, signal))
  );

  return settled
    .map((result) => (result.status === 'fulfilled' ? result.value : null))
    .filter((option): option is AnimeOption => Boolean(option));
}

async function fetchBangumiEpisodes(
  fallback: {
    animeId: number;
    animeTitle: string;
    type: string;
    typeDescription: string;
  },
  signal?: AbortSignal
): Promise<AnimeOption | null> {
  const baseUrl = getDanmakuApiBaseUrl();
  const url = `${baseUrl}/api/v2/bangumi/${encodeURIComponent(
    fallback.animeId.toString()
  )}`;
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const json: BangumiDetailResult = await response.json();
  const bangumi = json.bangumi;
  if (!bangumi) return null;

  const episodes = (bangumi.episodes || [])
    .map((episode) => ({
      episodeId: toNumber(episode.episodeId),
      episodeTitle:
        toText(episode.episodeTitle) ||
        (episode.episodeNumber ? `EP${episode.episodeNumber}` : ''),
    }))
    .filter(
      (
        episode
      ): episode is {
        episodeId: number;
        episodeTitle: string;
      } => Boolean(episode.episodeId && episode.episodeTitle)
    );

  if (episodes.length === 0) return null;

  return {
    animeId: toNumber(bangumi.animeId ?? bangumi.bangumiId) || fallback.animeId,
    animeTitle: toText(bangumi.animeTitle) || fallback.animeTitle,
    type: toText(bangumi.type) || fallback.type,
    typeDescription:
      toText(bangumi.typeDescription) || fallback.typeDescription,
    episodeCount: episodes.length,
    episodes,
  };
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

export function findDanmakuEpisodeFromSearch(
  animes: AnimeOption[],
  episodeNumber: number,
  preferredPlatform?: string
): AnimeMatch | null {
  const normalizedEpisodeNumber = Math.max(1, Math.floor(episodeNumber || 1));

  const rankedAnimes = animes
    .map((anime, index) => ({
      anime,
      index,
      score: getDanmakuPlatformScore(anime, preferredPlatform),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.anime);

  for (const anime of rankedAnimes) {
    const episodes = anime.episodes || [];
    const exactEpisode =
      episodes.find(
        (episode) =>
          extractEpisodeNumber(episode.episodeTitle) === normalizedEpisodeNumber
      ) || episodes[normalizedEpisodeNumber - 1];
    const episodeId = Number(exactEpisode?.episodeId);

    if (!Number.isFinite(episodeId) || episodeId <= 0) {
      continue;
    }

    return {
      animeId: anime.animeId,
      animeTitle: anime.animeTitle,
      type: anime.type,
      typeDescription: anime.typeDescription,
      episodeId,
      episodeTitle:
        exactEpisode?.episodeTitle || `${anime.animeTitle} EP${episodeNumber}`,
    };
  }

  return null;
}

function getDanmakuPlatformScore(
  anime: AnimeOption,
  preferredPlatform?: string
): number {
  if (!preferredPlatform) return 0;

  const platform = preferredPlatform.toLowerCase();
  const aliases: Record<string, string[]> = {
    qiyi: ['qiyi', 'iqiyi', '愛奇藝', '爱奇艺'],
    bilibili1: ['bilibili', 'bilibili1', '嗶哩', '哔哩'],
    imgo: ['imgo', 'mgtv', '芒果'],
    youku: ['youku', '優酷', '优酷'],
    qq: ['qq', 'tencent', '騰訊', '腾讯'],
    renren: ['renren', '人人'],
    hanjutv: ['hanjutv', '韓劇', '韩剧'],
    bahamut: ['bahamut', '巴哈'],
    dandan: ['dandan', '彈彈', '弹弹'],
  };
  const needles = aliases[platform] || [platform];
  const haystack = [
    anime.animeTitle,
    anime.type,
    anime.typeDescription,
    ...(anime.episodes || []).map((episode) => episode.episodeTitle),
  ]
    .join(' ')
    .toLowerCase();

  return needles.some((needle) => haystack.includes(needle.toLowerCase()))
    ? 100
    : 0;
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
