/* eslint-disable @typescript-eslint/no-explicit-any,no-console,no-case-declarations */

import { DoubanItem, DoubanResult } from './types';
import { toSimplified } from './zh';

interface DoubanCategoriesParams {
  kind: 'tv' | 'movie';
  category: string;
  type: string;
  pageLimit?: number;
  pageStart?: number;
}

interface DoubanCategoryApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

interface DoubanListApiResponse {
  total: number;
  subjects: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    cover: string;
    rate: string;
  }>;
}

interface DoubanRecommendApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    year: string;
    type: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

/**
 * 帶超時的 fetch 請求
 */
async function fetchWithTimeout(
  url: string,
  proxyUrl: string
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超時

  // 檢查是否使用代理
  const finalUrl = proxyUrl ? `${proxyUrl}${encodeURIComponent(url)}` : url;

  const fetchOptions: RequestInit = {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Referer: 'https://movie.douban.com/',
      Accept: 'application/json, text/plain, */*',
    },
  };

  try {
    const response = await fetch(finalUrl, fetchOptions);
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

function getDoubanProxyConfig(): {
  proxyType:
    | 'direct'
    | 'cors-proxy-zwei'
    | 'cmliussss-cdn-tencent'
    | 'cmliussss-cdn-ali'
    | 'custom';
  proxyUrl: string;
} {
  const doubanProxyType =
    localStorage.getItem('doubanDataSource') ||
    (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE ||
    'direct';
  const doubanProxy =
    localStorage.getItem('doubanProxyUrl') ||
    (window as any).RUNTIME_CONFIG?.DOUBAN_PROXY ||
    '';
  return {
    proxyType: doubanProxyType,
    proxyUrl: doubanProxy,
  };
}

/**
 * 瀏覽器端豆瓣分類數據獲取函數
 */
export async function fetchDoubanCategories(
  params: DoubanCategoriesParams,
  proxyUrl: string,
  useTencentCDN = false,
  useAliCDN = false
): Promise<DoubanResult> {
  const { kind, category, type, pageLimit = 20, pageStart = 0 } = params;

  // 驗證參數
  if (!['tv', 'movie'].includes(kind)) {
    throw new Error('kind 參數必須是 tv 或 movie');
  }

  if (!category || !type) {
    throw new Error('category 和 type 參數不能為空');
  }

  if (pageLimit < 1 || pageLimit > 100) {
    throw new Error('pageLimit 必須在 1-100 之間');
  }

  if (pageStart < 0) {
    throw new Error('pageStart 不能小於 0');
  }

  const categoryForRequest = encodeURIComponent(toSimplified(category));
  const typeForRequest = encodeURIComponent(toSimplified(type));
  const target = useTencentCDN
    ? `https://m.douban.cmliussss.net/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${categoryForRequest}&type=${typeForRequest}`
    : useAliCDN
    ? `https://m.douban.cmliussss.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${categoryForRequest}&type=${typeForRequest}`
    : `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${categoryForRequest}&type=${typeForRequest}`;

  try {
    const response = await fetchWithTimeout(
      target,
      useTencentCDN || useAliCDN ? '' : proxyUrl
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const doubanData: DoubanCategoryApiResponse = await response.json();

    // 轉換數據格式
    const list: DoubanItem[] = doubanData.items.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.pic?.normal || item.pic?.large || '',
      rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
      year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
    }));

    return {
      code: 200,
      message: '獲取成功',
      list: list,
    };
  } catch (error) {
    // 觸發全局錯誤提示
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('globalError', {
          detail: { message: '獲取豆瓣分類數據失敗' },
        })
      );
    }
    throw new Error(`獲取豆瓣分類數據失敗: ${(error as Error).message}`);
  }
}

/**
 * 統一的豆瓣分類數據獲取函數，根據代理設置選擇使用服務端 API 或客戶端代理獲取
 */
export async function getDoubanCategories(
  params: DoubanCategoriesParams
): Promise<DoubanResult> {
  const { kind, category, type, pageLimit = 20, pageStart = 0 } = params;
  const { proxyType, proxyUrl } = getDoubanProxyConfig();
  switch (proxyType) {
    case 'cors-proxy-zwei':
      return fetchDoubanCategories(params, 'https://ciao-cors.is-an.org/');
    case 'cmliussss-cdn-tencent':
      return fetchDoubanCategories(params, '', true, false);
    case 'cmliussss-cdn-ali':
      return fetchDoubanCategories(params, '', false, true);

    case 'custom':
      return fetchDoubanCategories(params, proxyUrl);
    case 'direct':
    default:
      const response = await fetch(
        `/api/douban/categories?kind=${kind}&category=${encodeURIComponent(
          category
        )}&type=${encodeURIComponent(
          type
        )}&limit=${pageLimit}&start=${pageStart}`
      );

      return response.json();
  }
}

interface DoubanListParams {
  tag: string;
  type: string;
  pageLimit?: number;
  pageStart?: number;
}

export async function getDoubanList(
  params: DoubanListParams
): Promise<DoubanResult> {
  const { tag, type, pageLimit = 20, pageStart = 0 } = params;
  const { proxyType, proxyUrl } = getDoubanProxyConfig();
  switch (proxyType) {
    case 'cors-proxy-zwei':
      return fetchDoubanList(params, 'https://ciao-cors.is-an.org/');
    case 'cmliussss-cdn-tencent':
      return fetchDoubanList(params, '', true, false);
    case 'cmliussss-cdn-ali':
      return fetchDoubanList(params, '', false, true);

    case 'custom':
      return fetchDoubanList(params, proxyUrl);
    case 'direct':
    default:
      const response = await fetch(
        `/api/douban?tag=${encodeURIComponent(
          tag
        )}&type=${type}&pageSize=${pageLimit}&pageStart=${pageStart}`
      );

      return response.json();
  }
}

export async function fetchDoubanList(
  params: DoubanListParams,
  proxyUrl: string,
  useTencentCDN = false,
  useAliCDN = false
): Promise<DoubanResult> {
  const { tag, type, pageLimit = 20, pageStart = 0 } = params;

  // 驗證參數
  if (!tag || !type) {
    throw new Error('tag 和 type 參數不能為空');
  }

  if (!['tv', 'movie'].includes(type)) {
    throw new Error('type 參數必須是 tv 或 movie');
  }

  if (pageLimit < 1 || pageLimit > 100) {
    throw new Error('pageLimit 必須在 1-100 之間');
  }

  if (pageStart < 0) {
    throw new Error('pageStart 不能小於 0');
  }

  const tagForRequest = encodeURIComponent(toSimplified(tag));
  const target = useTencentCDN
    ? `https://movie.douban.cmliussss.net/j/search_subjects?type=${type}&tag=${tagForRequest}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`
    : useAliCDN
    ? `https://movie.douban.cmliussss.com/j/search_subjects?type=${type}&tag=${tagForRequest}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`
    : `https://movie.douban.com/j/search_subjects?type=${type}&tag=${tagForRequest}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`;

  try {
    const response = await fetchWithTimeout(
      target,
      useTencentCDN || useAliCDN ? '' : proxyUrl
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const doubanData: DoubanListApiResponse = await response.json();

    // 轉換數據格式
    const list: DoubanItem[] = doubanData.subjects.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.cover,
      rate: item.rate,
      year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
    }));

    return {
      code: 200,
      message: '獲取成功',
      list: list,
    };
  } catch (error) {
    // 觸發全局錯誤提示
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('globalError', {
          detail: { message: '獲取豆瓣列表數據失敗' },
        })
      );
    }
    throw new Error(`獲取豆瓣分類數據失敗: ${(error as Error).message}`);
  }
}

interface DoubanRecommendsParams {
  kind: 'tv' | 'movie';
  pageLimit?: number;
  pageStart?: number;
  category?: string;
  format?: string;
  label?: string;
  region?: string;
  year?: string;
  platform?: string;
  sort?: string;
}

export async function getDoubanRecommends(
  params: DoubanRecommendsParams
): Promise<DoubanResult> {
  const {
    kind,
    pageLimit = 20,
    pageStart = 0,
    category,
    format,
    label,
    region,
    year,
    platform,
    sort,
  } = params;
  const { proxyType, proxyUrl } = getDoubanProxyConfig();
  switch (proxyType) {
    case 'cors-proxy-zwei':
      return fetchDoubanRecommends(params, 'https://ciao-cors.is-an.org/');
    case 'cmliussss-cdn-tencent':
      return fetchDoubanRecommends(params, '', true, false);
    case 'cmliussss-cdn-ali':
      return fetchDoubanRecommends(params, '', false, true);

    case 'custom':
      return fetchDoubanRecommends(params, proxyUrl);
    case 'direct':
    default:
      const response = await fetch(
        `/api/douban/recommends?kind=${kind}&limit=${pageLimit}&start=${pageStart}&category=${encodeURIComponent(
          category || ''
        )}&format=${encodeURIComponent(
          format || ''
        )}&region=${encodeURIComponent(region || '')}&year=${encodeURIComponent(
          year || ''
        )}&platform=${encodeURIComponent(
          platform || ''
        )}&sort=${encodeURIComponent(sort || '')}&label=${encodeURIComponent(
          label || ''
        )}`
      );

      return response.json();
  }
}

async function fetchDoubanRecommends(
  params: DoubanRecommendsParams,
  proxyUrl: string,
  useTencentCDN = false,
  useAliCDN = false
): Promise<DoubanResult> {
  const { kind, pageLimit = 20, pageStart = 0 } = params;
  let { category, format, region, year, platform, sort, label } = params;
  if (category === 'all') {
    category = '';
  }
  if (format === 'all') {
    format = '';
  }
  if (label === 'all') {
    label = '';
  }
  if (region === 'all') {
    region = '';
  }
  if (year === 'all') {
    year = '';
  }
  if (platform === 'all') {
    platform = '';
  }
  if (sort === 'T') {
    sort = '';
  }

  const selectedCategories = {
    [toSimplified('類型')]: toSimplified(category),
  } as any;
  if (format) {
    selectedCategories[toSimplified('形式')] = toSimplified(format);
  }
  if (region) {
    selectedCategories[toSimplified('地區')] = toSimplified(region);
  }

  const tags = [] as Array<string>;
  if (category) {
    tags.push(toSimplified(category));
  }
  if (!category && format) {
    tags.push(toSimplified(format));
  }
  if (label) {
    tags.push(toSimplified(label));
  }
  if (region) {
    tags.push(toSimplified(region));
  }
  if (year) {
    tags.push(year);
  }
  if (platform) {
    tags.push(toSimplified(platform));
  }

  const baseUrl = useTencentCDN
    ? `https://m.douban.cmliussss.net/rexxar/api/v2/${kind}/recommend`
    : useAliCDN
    ? `https://m.douban.cmliussss.com/rexxar/api/v2/${kind}/recommend`
    : `https://m.douban.com/rexxar/api/v2/${kind}/recommend`;
  const reqParams = new URLSearchParams();
  reqParams.append('refresh', '0');
  reqParams.append('start', pageStart.toString());
  reqParams.append('count', pageLimit.toString());
  reqParams.append('selected_categories', JSON.stringify(selectedCategories));
  reqParams.append('uncollect', 'false');
  reqParams.append('score_range', '0,10');
  reqParams.append('tags', tags.join(','));
  if (sort) {
    reqParams.append('sort', sort);
  }
  const target = `${baseUrl}?${reqParams.toString()}`;
  console.log(target);
  try {
    const response = await fetchWithTimeout(
      target,
      useTencentCDN || useAliCDN ? '' : proxyUrl
    );

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const doubanData: DoubanRecommendApiResponse = await response.json();
    const list: DoubanItem[] = doubanData.items
      .filter((item) => item.type == 'movie' || item.type == 'tv')
      .map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.pic?.normal || item.pic?.large || '',
        rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
        year: item.year,
      }));

    return {
      code: 200,
      message: '獲取成功',
      list: list,
    };
  } catch (error) {
    throw new Error(`獲取豆瓣推薦數據失敗: ${(error as Error).message}`);
  }
}

/**
 * 豆瓣榜單類型（subject_collection 主題合集）
 */
export type DoubanCollectionId =
  | 'movie_top250' // 豆瓣電影 Top250
  | 'movie_weekly_best'; // 每周口碑榜

interface DoubanCollectionItem {
  id: string;
  title: string;
  card_subtitle: string;
  cover_url?: string;
  pic?: { large?: string; normal?: string };
  rating?: { value: number } | null;
  rank?: number;
}

interface DoubanCollectionResponse {
  total: number;
  subject_collection_items: DoubanCollectionItem[];
}

/**
 * 獲取豆瓣榜單數據（Top250 / 每周口碑榜）。
 *
 * 數據源：rexxar `subject_collection/<id>/items`，條目帶 rank（排名）、
 * cover_url/pic（海報）、rating.value（評分）、card_subtitle（含年份）。
 * 走與推薦接口一致的代理配置。
 */
export async function getDoubanCollection(
  collectionId: DoubanCollectionId,
  pageStart = 0,
  pageLimit = 25
): Promise<DoubanResult> {
  const { proxyType, proxyUrl } = getDoubanProxyConfig();

  const useTencentCDN = proxyType === 'cmliussss-cdn-tencent';
  const useAliCDN = proxyType === 'cmliussss-cdn-ali';
  const baseUrl = useTencentCDN
    ? `https://m.douban.cmliussss.net/rexxar/api/v2/subject_collection/${collectionId}/items`
    : useAliCDN
    ? `https://m.douban.cmliussss.com/rexxar/api/v2/subject_collection/${collectionId}/items`
    : `https://m.douban.com/rexxar/api/v2/subject_collection/${collectionId}/items`;

  const proxy =
    proxyType === 'cors-proxy-zwei'
      ? 'https://ciao-cors.is-an.org/'
      : proxyType === 'custom'
      ? proxyUrl
      : '';

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}?start=${pageStart}&count=${pageLimit}`,
      useTencentCDN || useAliCDN ? '' : proxy
    );
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = (await response.json()) as DoubanCollectionResponse;
    const list: DoubanItem[] = (data.subject_collection_items || []).map(
      (item) => ({
        id: item.id,
        title: item.title,
        poster: item.cover_url || item.pic?.large || item.pic?.normal || '',
        rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
        year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
      })
    );

    return { code: 200, message: '獲取成功', list };
  } catch (error) {
    throw new Error(`獲取豆瓣榜單失敗: ${(error as Error).message}`);
  }
}

/**
 * 豆瓣條目詳情（劇情簡介等）
 */
export interface DoubanSubjectDetail {
  id: string;
  title: string;
  year: string;
  rate: string;
  intro: string;
}

interface DoubanSubjectApiResponse {
  id?: string;
  title?: string;
  year?: string;
  intro?: string;
  rating?: { value?: number };
}

// 詳情內存緩存，避免同一卡片多次打開菜單時重復請求
const DOUBAN_DETAIL_CACHE_LIMIT = 200;
const doubanDetailCache = new Map<string, DoubanSubjectDetail>();
const doubanDetailRequests = new Map<string, Promise<DoubanSubjectDetail>>();

function normalizeDoubanSubjectDetail(
  id: string,
  data: DoubanSubjectApiResponse
): DoubanSubjectDetail {
  return {
    id: data.id || id,
    title: data.title || '',
    year: data.year || '',
    rate: data.rating?.value ? data.rating.value.toFixed(1) : '',
    intro: data.intro || '',
  };
}

/**
 * 獲取豆瓣條目詳情（劇情簡介）。
 * 根據代理設置選擇服務端接口或客戶端代理，並做內存緩存。
 */
async function requestDoubanDetail(id: string): Promise<DoubanSubjectDetail> {
  const { proxyType, proxyUrl } = getDoubanProxyConfig();
  const target = `https://m.douban.com/rexxar/api/v2/subject/${encodeURIComponent(
    id
  )}`;

  let response: Response;
  switch (proxyType) {
    case 'cmliussss-cdn-tencent':
      response = await fetchWithTimeout(
        `https://m.douban.cmliussss.net/rexxar/api/v2/subject/${encodeURIComponent(
          id
        )}`,
        ''
      );
      break;
    case 'cmliussss-cdn-ali':
      response = await fetchWithTimeout(
        `https://m.douban.cmliussss.com/rexxar/api/v2/subject/${encodeURIComponent(
          id
        )}`,
        ''
      );
      break;
    case 'cors-proxy-zwei':
      response = await fetchWithTimeout(target, 'https://ciao-cors.is-an.org/');
      break;
    case 'custom':
      response = await fetchWithTimeout(target, proxyUrl);
      break;
    case 'direct':
    default:
      response = await fetch(
        `/api/detail?provider=douban&id=${encodeURIComponent(id)}&fields=desc`
      );
      break;
  }

  if (!response.ok) {
    throw new Error(`獲取豆瓣詳情失敗: ${response.status}`);
  }

  // 直連模式返回 { desc }，代理模式返回豆瓣條目原始結構
  const data = (await response.json()) as DoubanSubjectApiResponse & {
    desc?: string;
  };
  const detail = normalizeDoubanSubjectDetail(id, data);
  if (!detail.intro && typeof data.desc === 'string') {
    detail.intro = data.desc;
  }
  if (doubanDetailCache.size >= DOUBAN_DETAIL_CACHE_LIMIT) {
    const oldest = doubanDetailCache.keys().next().value;
    if (oldest !== undefined) doubanDetailCache.delete(oldest);
  }
  doubanDetailCache.set(id, detail);
  return detail;
}

/** 有界 LRU 快取；重複開啟同一卡片共用進行中的請求。 */
export function getDoubanDetail(id: string): Promise<DoubanSubjectDetail> {
  const cached = doubanDetailCache.get(id);
  if (cached) {
    doubanDetailCache.delete(id);
    doubanDetailCache.set(id, cached);
    return Promise.resolve(cached);
  }
  const inflight = doubanDetailRequests.get(id);
  if (inflight) return inflight;
  const request = requestDoubanDetail(id);
  doubanDetailRequests.set(id, request);
  void request
    .catch(() => {
      // 呼叫端處理失敗；不保留錯誤結果，允許重新嘗試。
    })
    .finally(() => {
      if (doubanDetailRequests.get(id) === request)
        doubanDetailRequests.delete(id);
    });
  return request;
}
