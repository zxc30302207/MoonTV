import { NextResponse } from 'next/server';

import { getClientIp, getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';
import { assertSafeUrl, parseAllowedHosts } from '@/lib/url-safety';

export const runtime = 'nodejs';

// OrionTV 兼容接口
export async function GET(request: Request) {
  const rateLimitResult = rateLimit(getClientIp(request), {
    limit: 300,
    windowMs: 60_000,
    prefix: 'image-proxy',
  });
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: '請求過於頻繁，請稍後再試' },
      {
        status: 429,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  let safeUrl: URL;
  try {
    const allowedHosts = parseAllowedHosts(
      process.env.ALLOWED_IMAGE_PROXY_HOSTS || process.env.ALLOWED_PROXY_HOSTS
    );
    safeUrl = assertSafeUrl(imageUrl, {
      allowPrivateNetworks: process.env.ALLOW_PRIVATE_NETWORKS === 'true',
      allowedHosts,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'URL 校驗失敗' },
      { status: 400 }
    );
  }

  try {
    const imageResponse = await fetch(safeUrl.toString(), {
      headers: {
        Referer: 'https://movie.douban.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      },
    });

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: imageResponse.statusText },
        { status: imageResponse.status }
      );
    }

    const contentType = imageResponse.headers.get('content-type');

    if (!imageResponse.body) {
      return NextResponse.json(
        { error: 'Image response has no body' },
        { status: 500 }
      );
    }

    // 創建響應頭
    const headers = new Headers();
    if (contentType) {
      headers.set('Content-Type', contentType);
    }

    // 設置緩存頭（可選）
    headers.set('Cache-Control', 'public, max-age=15720000, s-maxage=15720000'); // 緩存半年
    headers.set('CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Netlify-Vary', 'query');

    // 直接返回圖片流
    return new Response(imageResponse.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Error fetching image',
      },
      { status: 500 }
    );
  }
}
