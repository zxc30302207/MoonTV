import { NextResponse } from 'next/server';

import { getClientIp, getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';
import { parseAllowedHosts, safeFetch } from '@/lib/url-safety';

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

  try {
    const allowedHosts = parseAllowedHosts(
      process.env.ALLOWED_IMAGE_PROXY_HOSTS || process.env.ALLOWED_PROXY_HOSTS
    );
    const imageResponse = await safeFetch(
      imageUrl,
      {
        headers: {
          Referer: 'https://movie.douban.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        },
      },
      {
        allowPrivateNetworks: process.env.ALLOW_PRIVATE_NETWORKS === 'true',
        allowedHosts,
      }
    );

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: 'Image fetch failed' },
        {
          status: imageResponse.status,
          headers: { 'Cache-Control': 'private, no-store' },
        }
      );
    }

    if (!imageResponse.body) {
      return NextResponse.json(
        { error: 'Image response has no body' },
        { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const headers = new Headers();
    const contentType = imageResponse.headers.get('content-type');
    if (contentType && !contentType.toLowerCase().startsWith('image/')) {
      return NextResponse.json(
        { error: 'Proxy target is not an image' },
        { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    if (contentType) {
      headers.set('Content-Type', contentType);
    }
    headers.set('Cache-Control', 'private, no-store');
    headers.set('Vary', 'Cookie');

    return new Response(imageResponse.body, {
      status: 200,
      headers,
    });
  } catch (_) {
    return NextResponse.json(
      { error: 'Error fetching image' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}
