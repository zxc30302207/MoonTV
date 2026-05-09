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
