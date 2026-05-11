import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { fetchDoubanHtml, isDoubanVerificationHtml } from '@/lib/douban';
import { parseDoubanCommentsHtml } from '@/lib/douban-comments';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const doubanId = searchParams.get('id') || '';
  const start = Number.parseInt(searchParams.get('start') || '0', 10);
  const limit = Number.parseInt(searchParams.get('limit') || '20', 10);

  if (!/^\d+$/.test(doubanId)) {
    return NextResponse.json({ error: 'Missing douban ID' }, { status: 400 });
  }

  if (!Number.isFinite(start) || start < 0) {
    return NextResponse.json({ error: 'Invalid start' }, { status: 400 });
  }

  if (!Number.isFinite(limit) || limit < 1 || limit > 50) {
    return NextResponse.json({ error: 'Invalid limit' }, { status: 400 });
  }

  const target = `https://movie.douban.com/subject/${doubanId}/comments?start=${start}&limit=${limit}&status=P&sort=new_score`;

  try {
    const html = await fetchDoubanHtml(target);
    if (isDoubanVerificationHtml(html)) {
      throw new Error('Douban verification page returned');
    }

    const result = parseDoubanCommentsHtml(html, start, limit);
    const cacheTime = await getCacheTime();

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown error';
    const isVerificationError = details.includes('Douban verification');

    return NextResponse.json(
      {
        error: isVerificationError
          ? '豆瓣短評暫時被風控，請稍後重試'
          : 'Failed to fetch douban comments',
        details,
      },
      { status: 502 }
    );
  }
}
