import { NextResponse } from 'next/server';

import {
  type AdultSourceOption,
  fetchAdultRecommendations,
  getAdultSources,
  toAdultSourceOptions,
} from '@/lib/adult-recommendations';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 96;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = parsePositiveInt(searchParams.get('page'), 1);
  const limit = clamp(
    parsePositiveInt(searchParams.get('limit'), DEFAULT_LIMIT),
    1,
    MAX_LIMIT
  );
  const selectedSource = searchParams.get('source') || 'all';

  const config = await getConfig();
  const adultSources = getAdultSources(await getAvailableApiSites());
  const sources = toAdultSourceOptions(adultSources);

  if (!config.SiteConfig.DisableYellowFilter) {
    return NextResponse.json(
      emptyResult(page, limit, sources, 'Adult recommendations are disabled')
    );
  }

  const scopedSources =
    selectedSource === 'all'
      ? adultSources
      : adultSources.filter((site) => site.key === selectedSource);

  if (scopedSources.length === 0) {
    return NextResponse.json(
      emptyResult(page, limit, sources, 'No adult sources available')
    );
  }

  const { list, hasMore } = await fetchAdultRecommendations(scopedSources, {
    page,
    limit,
  });
  const cacheTime = await getCacheTime();

  return NextResponse.json(
    {
      code: 200,
      message: 'success',
      list,
      page,
      limit,
      hasMore,
      sources,
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

function emptyResult(
  page: number,
  limit: number,
  sources: AdultSourceOption[],
  message: string
) {
  return {
    code: 200,
    message,
    list: [],
    page,
    limit,
    hasMore: false,
    sources,
  };
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
