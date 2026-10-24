import { API_CONFIG, ApiSite, getConfig } from '@/lib/config';
import { cleanM3U8Url, isDirectM3U8Url } from '@/lib/playback-url';
import { getFallbackSearchQuery } from '@/lib/search-title';
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

interface ApiSearchItem {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_play_url?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

/** Upstream search response, validated before mapping. */
interface ApiSearchResponse {
  list?: unknown[];
  pagecount?: number;
}

// 匹配 m3u8 連結
const M3U8_PATTERN = /https?:\/\/[^"'\s<>]+?\.m3u8(?:[?#][^"'\s<>]*)?/gi;

export function isPlayableM3U8Url(url?: string): url is string {
  return isDirectM3U8Url(url);
}

function parseEpisodeEntry(entry: string): { title: string; url: string } {
  const separatorIndex = entry.indexOf('$');
  if (separatorIndex === -1) {
    return { title: '', url: cleanM3U8Url(entry) };
  }

  return {
    title: entry.slice(0, separatorIndex).trim(),
    url: cleanM3U8Url(entry.slice(separatorIndex + 1)),
  };
}

function splitEpisodeEntries(source: string): string[] {
  return source.split(/#(?=[^#$]*\$https?:\/\/)/i);
}

function extractM3U8Urls(content: string): string[] {
  return Array.from(content.matchAll(M3U8_PATTERN), ([url]) =>
    cleanM3U8Url(url)
  ).filter(isPlayableM3U8Url);
}

/** 包裝 fetch：加入逾時與網路錯誤分類 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout = 30000
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeoutMs =
    Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 120000) : 30000;
  const timeoutId = setTimeout(abort, timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error: unknown) {
    // 區分超時錯誤和網絡錯誤
    const err = error as Error;
    if (err.name === 'AbortError') {
      throw new Error('請求超時');
    } else if (
      err.message?.includes('Failed to fetch') ||
      err.message?.includes('fetch failed') ||
      err.message?.includes('NetworkError')
    ) {
      throw new Error('請求失敗');
    } else {
      throw new Error(`網絡錯誤: ${err.message || '未知錯誤'}`);
    }
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abort);
  }
}

/**
 * 通用的播放源解析
 * 支持：
 *  1. vod_play_url (通過 $$$、#、$ 分割)
 *  2. 內容中的 m3u8 鏈接（正則提取）
 */
export function parseEpisodes(
  vod_play_url?: string,
  fallbackContent?: string
): { episodes: string[]; titles: string[] } {
  let episodes: string[] = [];
  let titles: string[] = [];

  // 1. 優先解析 vod_play_url
  if (vod_play_url) {
    const sources = vod_play_url.split('$$$');
    sources.forEach((source) => {
      const currentEpisodes: string[] = [];
      const currentTitles: string[] = [];

      splitEpisodeEntries(source).forEach((entry) => {
        const { title, url } = parseEpisodeEntry(entry);
        if (isPlayableM3U8Url(url)) {
          currentTitles.push(title);
          currentEpisodes.push(url);
        }
      });

      // 選用分集最多的播放源
      if (currentEpisodes.length > episodes.length) {
        episodes = currentEpisodes;
        titles = currentTitles;
      }
    });
  }

  // 2. 若無可解析連結，則以內容備援擷取
  if (episodes.length === 0 && fallbackContent) {
    episodes = extractM3U8Urls(fallbackContent);
    titles = episodes.map((_, i) => (i + 1).toString()); // 默認用序號作為標題
  }

  return { episodes, titles };
}

/**
 * 映射 API 数据到 SearchResult。
 * 单条数据缺字段或类型异常时返回 null，避免整页 map 抛错拖垮整个源。
 */
function mapItemToResult(
  item: unknown,
  apiSite: ApiSite,
  apiName: string
): SearchResult | null {
  if (!item || typeof item !== 'object') return null;

  const raw = item as Partial<ApiSearchItem>;
  if (
    raw.vod_id === undefined ||
    raw.vod_id === null ||
    String(raw.vod_id).trim() === ''
  ) {
    return null;
  }

  const title = typeof raw.vod_name === 'string' ? raw.vod_name.trim() : '';
  if (!title) return null;

  const { episodes, titles } = parseEpisodes(
    typeof raw.vod_play_url === 'string' ? raw.vod_play_url : undefined,
    typeof raw.vod_content === 'string' ? raw.vod_content : undefined
  );

  return {
    id: String(raw.vod_id),
    title: title.replace(/\s+/g, ' '),
    poster: typeof raw.vod_pic === 'string' ? raw.vod_pic : '',
    episodes,
    episodes_titles: titles,
    source: apiSite.key,
    source_name: apiName,
    class: typeof raw.vod_class === 'string' ? raw.vod_class : undefined,
    // 上游可能把年份返回成数字，统一转成字符串再提取
    year: String(raw.vod_year ?? '').match(/\d{4}/)?.[0] || 'unknown',
    desc: cleanHtmlTags(
      typeof raw.vod_content === 'string' ? raw.vod_content : ''
    ),
    type_name: typeof raw.type_name === 'string' ? raw.type_name : undefined,
    douban_id:
      raw.vod_douban_id === undefined || raw.vod_douban_id === null
        ? undefined
        : Number(raw.vod_douban_id) || undefined,
  };
}

/** 批量映射并丢弃脏数据 */
function mapItemsToResults(
  items: unknown[],
  apiSite: ApiSite,
  apiName: string
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const item of items) {
    const mapped = mapItemToResult(item, apiSite, apiName);
    if (mapped) results.push(mapped);
  }
  return results;
}

/** API 搜索流 */
export async function* searchFromApiStream(
  apiSite: ApiSite,
  query: string,
  parallel = true,
  timeout?: number,
  signal?: AbortSignal
): AsyncGenerator<SearchResult[], void, unknown> {
  if (signal?.aborted) return;
  // Normalize only the upstream keyword; callers retain the full query for matching.
  const searchQuery = getFallbackSearchQuery(query) ?? query;
  const seen = new Set<string>();

  for await (const page of searchApiQuery(
    apiSite,
    searchQuery,
    parallel,
    timeout,
    signal
  )) {
    if (signal?.aborted) return;
    const results = page.filter((result) => {
      const key = JSON.stringify([result.source, result.id]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (results.length > 0) yield results;
  }
}

/** Search one literal keyword, including all configured pages. */
async function* searchApiQuery(
  apiSite: ApiSite,
  query: string,
  parallel = true,
  timeout?: number,
  signal?: AbortSignal
): AsyncGenerator<SearchResult[], void, unknown> {
  if (signal?.aborted) return;
  const apiUrl =
    apiSite.api + API_CONFIG.search.path + encodeURIComponent(query);

  const response = await fetchWithTimeout(
    apiUrl,
    { headers: API_CONFIG.search.headers, signal },
    timeout
  );
  if (!response.ok) {
    // 不再静默当作“无结果”，让失败源显示真实原因
    throw new Error(`請求失敗（HTTP ${response.status}）`);
  }

  let data: ApiSearchResponse;
  try {
    data = (await response.json()) as ApiSearchResponse;
  } catch {
    throw new Error('回應格式錯誤');
  }
  if (!Array.isArray(data?.list)) {
    throw new Error('回應格式錯誤');
  }

  // 第一页
  yield mapItemsToResults(data.list, apiSite, apiSite.name);

  // 分頁
  const { SiteConfig } = await getConfig();
  const maxPages = SiteConfig.SearchDownstreamMaxPage;
  const pageCount = data.pagecount || 1;
  const pagesToFetch = Math.min(pageCount, maxPages);

  if (pagesToFetch > 1) {
    if (parallel) {
      // ------------------ 並行模式 ------------------
      const pagePromises: Promise<{
        page: number;
        results: SearchResult[];
      } | null>[] = [];

      for (let page = 2; page <= pagesToFetch; page++) {
        if (signal?.aborted) return;
        const pageUrl =
          apiSite.api +
          API_CONFIG.search.pagePath
            .replace('{query}', encodeURIComponent(query))
            .replace('{page}', page.toString());

        const promise = (async () => {
          const pageRes = await fetchWithTimeout(
            pageUrl,
            { headers: API_CONFIG.search.headers, signal },
            timeout
          );
          if (!pageRes.ok) return null;

          const pageData = (await pageRes.json()) as ApiSearchResponse;
          if (!Array.isArray(pageData?.list)) return null;

          const results = mapItemsToResults(
            pageData.list,
            apiSite,
            apiSite.name
          );
          return { page, results };
        })();

        pagePromises.push(promise);
      }

      const settled = await Promise.allSettled(pagePromises);
      const successful = settled.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      );
      for (const res of successful
        .filter(
          (r): r is { page: number; results: SearchResult[] } =>
            !!r && r.results.length > 0
        )
        .sort((a, b) => a.page - b.page)) {
        if (signal?.aborted) return;
        yield res.results;
      }
    } else {
      // ------------------ 順序模式 ------------------
      for (let page = 2; page <= pagesToFetch; page++) {
        if (signal?.aborted) return;
        const pageUrl =
          apiSite.api +
          API_CONFIG.search.pagePath
            .replace('{query}', encodeURIComponent(query))
            .replace('{page}', page.toString());

        try {
          const pageRes = await fetchWithTimeout(
            pageUrl,
            { headers: API_CONFIG.search.headers, signal },
            timeout
          );
          if (!pageRes.ok) continue;

          const pageData = (await pageRes.json()) as ApiSearchResponse;
          if (Array.isArray(pageData?.list)) {
            const results = mapItemsToResults(
              pageData.list,
              apiSite,
              apiSite.name
            );
            if (results.length > 0) yield results;
          }
        } catch {
          // 单页失败不影响已获得的结果，与并行模式保持一致
          if (signal?.aborted) return;
        }
      }
    }
  }
}

export interface DetailRequestOptions {
  timeout?: number;
  signal?: AbortSignal;
}

/** 獲取詳情 */
export async function getDetailFromApi(
  apiSite: ApiSite,
  id: string,
  options: DetailRequestOptions = {}
): Promise<SearchResult> {
  if (apiSite.detail) return handleSpecialSourceDetail(id, apiSite, options);

  const detailUrl = `${apiSite.api}${API_CONFIG.detail.path}${id}`;
  const response = await fetchWithTimeout(
    detailUrl,
    {
      headers: API_CONFIG.detail.headers,
      signal: options.signal,
    },
    options.timeout
  );

  if (!response.ok) throw new Error(`詳情請求失敗: ${response.status}`);

  const data = await response.json();
  if (!Array.isArray(data?.list) || data.list.length === 0) {
    throw new Error('獲取到的詳情內容無效');
  }

  const video = data.list[0];
  const { episodes, titles } = parseEpisodes(
    video.vod_play_url,
    video.vod_content
  );

  return {
    id: id.toString(),
    title: video.vod_name,
    poster: video.vod_pic,
    episodes,
    episodes_titles: titles,
    source: apiSite.key,
    source_name: apiSite.name,
    class: video.vod_class,
    year: video.vod_year?.match(/\d{4}/)?.[0] || 'unknown',
    desc: cleanHtmlTags(video.vod_content),
    type_name: video.type_name,
    douban_id: video.vod_douban_id,
  };
}

/** 特殊站點詳情處理 */
async function handleSpecialSourceDetail(
  id: string,
  apiSite: ApiSite,
  options: DetailRequestOptions = {}
): Promise<SearchResult> {
  const detailUrl = `${apiSite.detail}/index.php/vod/detail/id/${id}.html`;
  const response = await fetchWithTimeout(
    detailUrl,
    {
      headers: API_CONFIG.detail.headers,
      signal: options.signal,
    },
    options.timeout
  );

  if (!response.ok) throw new Error(`詳情頁請求失敗: ${response.status}`);

  const html = await response.text();

  // 特定站點規則（優先）
  let matches: string[] = [];
  if (apiSite.key === 'ffzy') {
    matches = extractM3U8Urls(html)
      .filter((url) =>
        /\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8(?:$|[?#])/i.test(url)
      )
      .map((url) => `$${url}`);
  }

  // 通用正則
  if (matches.length === 0) {
    matches = extractM3U8Urls(html).map((url) => `$${url}`);
  }

  // 去重並清理
  matches = Array.from(new Set(matches)).map((link) => {
    const clean = link.substring(1); // 去掉 $
    const parenIndex = clean.indexOf('(');
    return parenIndex > 0 ? clean.substring(0, parenIndex) : clean;
  });

  // 如果依舊沒解析到，用 parseEpisodes fallback
  if (matches.length === 0) {
    const { episodes } = parseEpisodes(undefined, html);
    matches = episodes;
  }

  const episodes_titles = matches.map((_, i) => (i + 1).toString());

  const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim() || '';
  const desc = cleanHtmlTags(
    html.match(/<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/)?.[1] ||
      ''
  );
  const cover = html.match(/(https?:\/\/[^"'\s]+?\.jpg)/)?.[0]?.trim() || '';
  const year = html.match(/>(\d{4})</)?.[1] || 'unknown';

  return {
    id,
    title,
    poster: cover,
    episodes: matches,
    episodes_titles,
    source: apiSite.key,
    source_name: apiSite.name,
    class: '',
    year,
    desc,
    type_name: '',
    douban_id: 0,
  };
}
