/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    // 从 cookie 获取用户信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await getConfig();
    if (config.UserConfig.Users) {
      // 检查用户是否被封禁
      const user = config.UserConfig.Users.find(
        (u) => u.username === authInfo.username
      );
      if (user && user.banned) {
        return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();

    if (!query) {
      return NextResponse.json({ suggestions: [] });
    }

    // 生成建议
    const suggestions = await generateSuggestions(query);

    const cacheTime = 300; // 5分钟缓存

    return NextResponse.json(
      { suggestions },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        },
      }
    );
  } catch (error) {
    console.error('获取搜索建议失败', error);
    return NextResponse.json({ error: '获取搜索建议失败' }, { status: 500 });
  }
}

async function generateSuggestions(query: string): Promise<
  Array<{
    text: string;
    type: 'related';
    score: number;
  }>
> {
  const queryLower = query.toLowerCase();

  const config = await getConfig();
  const apiSites = config.SourceConfig.filter((site: any) => !site.disabled);
  let realKeywords: string[] = [];
  if (apiSites.length > 0) {
    // 只取一个数据源的搜索API，传入用户输入的query
    const results = await searchFromApi(apiSites[10], query); //10是豆瓣资源
    realKeywords = Array.from(
      new Set(
        results
          .map((r: any) => r.title)
          .filter(Boolean)
          .flatMap((title: string) => title.split(/[ -:：·、-]/))
          .filter(
            (w: string) => w.length > 1 && w.toLowerCase().includes(queryLower)
          )
      )
    ).slice(0, 8);
  }

  const realSuggestions = realKeywords.map((word) => ({
    text: word,
    type: 'related' as const,
    score: 1.5,
  }));

  return realSuggestions;
}
