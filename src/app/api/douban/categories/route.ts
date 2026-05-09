import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import { DoubanItem, DoubanResult } from '@/lib/types';
import { toSimplified } from '@/lib/zh';

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

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // 獲取參數
  const kind = searchParams.get('kind') || 'movie';
  const category = searchParams.get('category');
  const type = searchParams.get('type');
  const pageLimit = parseInt(searchParams.get('limit') || '20');
  const pageStart = parseInt(searchParams.get('start') || '0');

  // 驗證參數
  if (!kind || !category || !type) {
    return NextResponse.json(
      { error: '缺少必要參數: kind 或 category 或 type' },
      { status: 400 }
    );
  }

  if (!['tv', 'movie'].includes(kind)) {
    return NextResponse.json(
      { error: 'kind 參數必須是 tv 或 movie' },
      { status: 400 }
    );
  }

  if (pageLimit < 1 || pageLimit > 100) {
    return NextResponse.json(
      { error: 'pageSize 必須在 1-100 之間' },
      { status: 400 }
    );
  }

  if (pageStart < 0) {
    return NextResponse.json(
      { error: 'pageStart 不能小於 0' },
      { status: 400 }
    );
  }

  const categoryForRequest = encodeURIComponent(toSimplified(category));
  const typeForRequest = encodeURIComponent(toSimplified(type));
  const target = `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${categoryForRequest}&type=${typeForRequest}`;

  try {
    // 調用豆瓣 API
    const doubanData = await fetchDoubanData<DoubanCategoryApiResponse>(target);

    // 轉換數據格式
    const list: DoubanItem[] = doubanData.items.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.pic?.normal || item.pic?.large || '',
      rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
      year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
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
