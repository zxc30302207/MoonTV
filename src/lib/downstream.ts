import { API_CONFIG, ApiSite, getConfig } from '@/lib/config';
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

// 匹配 m3u8 連結
const M3U8_PATTERN = /https?:\/\/[^"'\s<>]+?\.m3u8(?:[?#][^"'\s<>]*)?/gi;
const M3U8_URL_PATTERN = /^https?:\/\/.+\.m3u8(?:$|[?#])/i;

function cleanM3U8Url(url: string): string {
  return url.trim().replace(/[),.;]+$/g, '');
}

export function isPlayableM3U8Url(url?: string): url is string {
  return Boolean(url && M3U8_URL_PATTERN.test(cleanM3U8Url(url)));
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
  const timeoutId = setTimeout(() => controller.abort(), timeout);
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

/** 對映 API 條目到 SearchResult */
function mapItemToResult(
  item: ApiSearchItem,
  apiSite: ApiSite,
  apiName: string
): SearchResult {
  const { episodes, titles } = parseEpisodes(
    item.vod_play_url,
    item.vod_content
  );

  return {
    id: item.vod_id.toString(),
    title: item.vod_name.trim().replace(/\s+/g, ' '),
    poster: item.vod_pic,
    episodes,
    episodes_titles: titles,
    source: apiSite.key,
    source_name: apiName,
    class: item.vod_class,
    year: item.vod_year?.match(/\d{4}/)?.[0] || 'unknown',
    desc: cleanHtmlTags(item.vod_content || ''),
    type_name: item.type_name,
    douban_id: item.vod_douban_id,
  };
}

/** API 搜索流 */
export async function* searchFromApiStream(
  apiSite: ApiSite,
  query: string,
  parallel = true,
  timeout?: number
): AsyncGenerator<SearchResult[], void, unknown> {
  const apiUrl =
    apiSite.api + API_CONFIG.search.path + encodeURIComponent(query);

  const response = await fetchWithTimeout(
    apiUrl,
    { headers: API_CONFIG.search.headers },
    timeout
  );
  if (!response.ok) return;

  const data = await response.json();
  if (!Array.isArray(data?.list)) return;

  // 第一頁
  yield data.list.map((item: ApiSearchItem) =>
    mapItemToResult(item, apiSite, apiSite.name)
  );

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
        const pageUrl =
          apiSite.api +
          API_CONFIG.search.pagePath
            .replace('{query}', encodeURIComponent(query))
            .replace('{page}', page.toString());

        const promise = (async () => {
          const pageRes = await fetchWithTimeout(
            pageUrl,
            { headers: API_CONFIG.search.headers },
            timeout
          );
          if (!pageRes.ok) return null;

          const pageData = await pageRes.json();
          if (!Array.isArray(pageData?.list)) return null;

          const results = pageData.list.map((item: ApiSearchItem) =>
            mapItemToResult(item, apiSite, apiSite.name)
          );
          return { page, results };
        })();

        pagePromises.push(promise);
      }

      const settled = await Promise.all(pagePromises);
      for (const res of settled
        .filter(
          (r): r is { page: number; results: SearchResult[] } =>
            !!r && r.results.length > 0
        )
        .sort((a, b) => a.page - b.page)) {
        yield res.results;
      }
    } else {
      // ------------------ 順序模式 ------------------
      for (let page = 2; page <= pagesToFetch; page++) {
        const pageUrl =
          apiSite.api +
          API_CONFIG.search.pagePath
            .replace('{query}', encodeURIComponent(query))
            .replace('{page}', page.toString());

        const pageRes = await fetchWithTimeout(
          pageUrl,
          { headers: API_CONFIG.search.headers },
          timeout
        );
        if (!pageRes.ok) continue;

        const pageData = await pageRes.json();
        if (Array.isArray(pageData?.list)) {
          const results = pageData.list.map((item: ApiSearchItem) =>
            mapItemToResult(item, apiSite, apiSite.name)
          );
          if (results.length > 0) yield results;
        }
      }
    }
  }
}

/** 獲取詳情 */
export async function getDetailFromApi(
  apiSite: ApiSite,
  id: string
): Promise<SearchResult> {
  if (apiSite.detail) return handleSpecialSourceDetail(id, apiSite);

  const detailUrl = `${apiSite.api}${API_CONFIG.detail.path}${id}`;
  const response = await fetchWithTimeout(detailUrl, {
    headers: API_CONFIG.detail.headers,
  });

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
  apiSite: ApiSite
): Promise<SearchResult> {
  const detailUrl = `${apiSite.detail}/index.php/vod/detail/id/${id}.html`;
  const response = await fetchWithTimeout(detailUrl, {
    headers: API_CONFIG.detail.headers,
  });

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
