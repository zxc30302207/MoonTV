import { NextResponse } from 'next/server';

import {
  ADULT_SOURCE_KEYS,
  API_CONFIG,
  getAvailableApiSites,
  getCacheTime,
  getConfig,
} from '@/lib/config';
import { SearchResult } from '@/lib/types';
import { cleanHtmlTags } from '@/lib/utils';

export const runtime = 'nodejs';

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
};

const DEFAULT_LIMIT = 24;
const MAX_SOURCES = 9;
const SOURCE_ITEM_LIMIT = 6;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') || `${DEFAULT_LIMIT}`, 10), 1),
    60
  );

  const config = await getConfig();
  if (!config.SiteConfig.DisableYellowFilter) {
    return NextResponse.json(emptyResult());
  }

  const apiSites = (await getAvailableApiSites())
    .filter((site) => ADULT_SOURCE_KEYS.has(site.key))
    .slice(0, MAX_SOURCES);

  if (apiSites.length === 0) {
    return NextResponse.json(emptyResult());
  }

  const settled = await Promise.allSettled(
    apiSites.map(async (site) => {
      const response = await fetch(`${site.api}?ac=videolist&pg=1`, {
        headers: API_CONFIG.search.headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return [];

      const data = (await response.json()) as AdultVodResponse;
      if (!Array.isArray(data.list)) return [];

      return data.list
        .slice(0, SOURCE_ITEM_LIMIT)
        .map((item) => mapAdultItem(item, site.key, site.name))
        .filter((item): item is SearchResult => Boolean(item));
    })
  );

  const seen = new Set<string>();
  const list = settled
    .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    .filter((item) => {
      const key = `${item.source}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);

  const cacheTime = await getCacheTime();
  return NextResponse.json(
    {
      code: 200,
      message: '獲取成功',
      list,
    },
    {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    }
  );
}

function emptyResult() {
  return {
    code: 200,
    message: '未啟用成人推薦',
    list: [],
  };
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
