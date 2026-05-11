import { ADULT_SOURCE_KEYS, API_CONFIG, ApiSite } from '@/lib/config';
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

type AdultVodItem = {
  vod_id?: string | number;
  vod_name?: string;
  vod_pic?: string;
  vod_remarks?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
};

type AdultVodResponse = {
  list?: AdultVodItem[];
  page?: number | string;
  pagecount?: number | string;
  total?: number | string;
  limit?: number | string;
};

export type AdultSourceOption = {
  key: string;
  name: string;
};

type AdultSourceResult = {
  items: SearchResult[];
  hasMore: boolean;
};

type Fetcher = typeof fetch;

export function getAdultSources(apiSites: ApiSite[]): ApiSite[] {
  return apiSites.filter((site) => ADULT_SOURCE_KEYS.has(site.key));
}

export function toAdultSourceOptions(apiSites: ApiSite[]): AdultSourceOption[] {
  return apiSites.map((site) => ({
    key: site.key,
    name: site.name,
  }));
}

export async function fetchAdultRecommendations(
  apiSites: ApiSite[],
  options: { page: number; limit: number },
  fetcher: Fetcher = fetch
): Promise<{ list: SearchResult[]; hasMore: boolean }> {
  const settled = await Promise.allSettled(
    apiSites.map(async (site) => {
      const response = await fetcher(
        buildAdultListUrl(site.api, options.page),
        {
          headers: API_CONFIG.search.headers,
          signal: createTimeoutSignal(10000),
        }
      );
      if (!response.ok) {
        return { items: [], hasMore: false };
      }

      const data = (await response.json()) as AdultVodResponse;
      if (!Array.isArray(data.list)) {
        return { items: [], hasMore: false };
      }

      const items = data.list
        .map((item) => mapAdultItem(item, site.key, site.name))
        .filter((item): item is SearchResult => Boolean(item));

      return {
        items,
        hasMore: hasMoreAdultPages(data, options.page, items.length),
      };
    })
  );

  const sourceResults = settled
    .filter(
      (result): result is PromiseFulfilledResult<AdultSourceResult> =>
        result.status === 'fulfilled'
    )
    .map((result) => result.value);

  return {
    list: takeRoundRobin(
      sourceResults.map((result) => result.items),
      options.limit
    ),
    hasMore: sourceResults.some((result) => result.hasMore),
  };
}

function buildAdultListUrl(api: string, page: number): string {
  const separator = api.includes('?') ? '&' : '?';
  return `${api}${separator}ac=videolist&pg=${page}`;
}

function mapAdultItem(
  item: AdultVodItem,
  source: string,
  sourceName: string
): SearchResult | null {
  if (!item.vod_id || !item.vod_name) return null;

  return {
    id: String(item.vod_id),
    title: item.vod_name.trim().replace(/\s+/g, ' '),
    poster: item.vod_pic || '',
    episodes: [],
    episodes_titles: [],
    source,
    source_name: sourceName,
    class: item.vod_class,
    year: item.vod_year?.match(/\d{4}/)?.[0] || 'unknown',
    desc: cleanHtmlTags(item.vod_content || ''),
    type_name: item.type_name,
    douban_id: item.vod_douban_id,
  };
}

function hasMoreAdultPages(
  data: AdultVodResponse,
  currentPage: number,
  itemCount: number
): boolean {
  const pageCount = toPositiveInt(data.pagecount);
  if (pageCount !== null) {
    return currentPage < pageCount;
  }

  return itemCount > 0;
}

function takeRoundRobin(
  groups: SearchResult[][],
  limit: number
): SearchResult[] {
  const list: SearchResult[] = [];
  const seen = new Set<string>();
  const maxLength = Math.max(0, ...groups.map((group) => group.length));

  for (let index = 0; index < maxLength && list.length < limit; index += 1) {
    for (const group of groups) {
      const item = group[index];
      if (!item) continue;

      const key = `${item.source}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(item);

      if (list.length >= limit) break;
    }
  }

  return list;
}

function toPositiveInt(value: number | string | undefined): number | null {
  if (value === undefined) return null;

  const parsed =
    typeof value === 'number' ? value : Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}
