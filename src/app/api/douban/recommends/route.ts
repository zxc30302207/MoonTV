import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getCacheTime } from '@/lib/config';
import { getConfig } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import { DoubanResult } from '@/lib/types';
import { toSimplified } from '@/lib/zh';

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

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const { searchParams } = url;

  // 認證策略：已登錄用戶 或 TVBox 開啟（無需口令）
  const auth = await getVerifiedAuthInfo(request);
  if (!auth || !auth.username) {
    const cfg = await getConfig();
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    const enabled =
      storageType === 'localstorage'
        ? process.env.TVBOX_ENABLED == null
          ? true
          : String(process.env.TVBOX_ENABLED).toLowerCase() === 'true'
        : cfg.SiteConfig.TVBoxEnabled === true;
    if (!enabled) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // TVBox 已開啟，允許匿名訪問，無需口令
  }

  // 獲取參數
  const kind = searchParams.get('kind');
  const pageLimit = parseInt(searchParams.get('limit') || '20');
  const pageStart = parseInt(searchParams.get('start') || '0');
  const category =
    searchParams.get('category') === 'all' ? '' : searchParams.get('category');
  const format =
    searchParams.get('format') === 'all' ? '' : searchParams.get('format');
  const region =
    searchParams.get('region') === 'all' ? '' : searchParams.get('region');
  const year =
    searchParams.get('year') === 'all' ? '' : searchParams.get('year');
  const platform =
    searchParams.get('platform') === 'all' ? '' : searchParams.get('platform');
  const sort = searchParams.get('sort') === 'T' ? '' : searchParams.get('sort');
  const label =
    searchParams.get('label') === 'all' ? '' : searchParams.get('label');

  if (!kind) {
    return NextResponse.json({ error: '缺少必要參數: kind' }, { status: 400 });
  }

  const selectedCategories: Record<string, string | undefined> = {};
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

  const baseUrl = `https://m.douban.com/rexxar/api/v2/${kind}/recommend`;
  const params = new URLSearchParams();
  params.append('refresh', '0');
  params.append('start', pageStart.toString());
  params.append('count', pageLimit.toString());
  params.append('selected_categories', JSON.stringify(selectedCategories));
  params.append('uncollect', 'false');
  params.append('score_range', '0,10');
  params.append('tags', tags.join(','));
  if (sort) {
    params.append('sort', sort);
  }

  const target = `${baseUrl}?${params.toString()}`;
  try {
    const doubanData = await fetchDoubanData<DoubanRecommendApiResponse>(
      target
    );
    const list = doubanData.items
      .filter((item) => item.type == 'movie' || item.type == 'tv')
      .map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.pic?.normal || item.pic?.large || '',
        rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
        year: item.year,
      }));
    const response: DoubanResult = {
      code: 200,
      message: '獲取成功',
      list: list,
    };

    const cacheTime = await getCacheTime();
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: '獲取豆瓣數據失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
