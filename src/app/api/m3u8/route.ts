import { NextRequest, NextResponse } from 'next/server';

import { parseM3U8 } from '@/lib/m3u8-downloader';
import { getClientIp, getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';
import {
  assertSafeResolvedUrl,
  assertSafeUrl,
  parseAllowedHosts,
  safeFetch,
} from '@/lib/url-safety';

export const runtime = 'nodejs';

/**
 * 解析M3U8文件接口
 * POST /api/m3u8/parse
 */
export async function POST(request: NextRequest) {
  try {
    const rateLimitResult = rateLimit(getClientIp(request), {
      limit: 60,
      windowMs: 60_000,
      prefix: 'm3u8-parse',
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

    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: '缺少 m3u8 URL' }, { status: 400 });
    }

    const allowPrivateNetworks = process.env.ALLOW_PRIVATE_NETWORKS === 'true';
    const allowedHosts = parseAllowedHosts(
      process.env.ALLOWED_M3U8_HOSTS || process.env.ALLOWED_PROXY_HOSTS
    );
    let safeUrl: string;
    try {
      safeUrl = assertSafeUrl(url, {
        allowPrivateNetworks,
        allowedHosts,
      }).toString();
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'URL 校驗失敗' },
        { status: 400 }
      );
    }
    const validateUrl = (targetUrl: string) => {
      assertSafeUrl(targetUrl, { allowPrivateNetworks, allowedHosts });
    };
    const task = await parseM3U8(safeUrl, {
      fetcher: (targetUrl, init) =>
        safeFetch(targetUrl, init, { allowPrivateNetworks, allowedHosts }),
      validateUrl,
    });

    return NextResponse.json({
      success: true,
      data: {
        title: task.title,
        type: task.type,
        totalSegments: task.tsUrlList.length,
        duration: task.durationSecond,
        hasAes: !!task.aesConf.key,
        segments: task.tsUrlList.map((url, index) => ({
          index: index + 1,
          url,
        })),
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('解析M3U8失敗:', error);
    return NextResponse.json(
      {
        error: '解析M3U8文件失敗',
        message: error instanceof Error ? error.message : '未知錯誤',
      },
      { status: 500 }
    );
  }
}

/**
 * 代理下載TS片段（避免CORS問題）
 * GET /api/m3u8/proxy?url=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = rateLimit(getClientIp(request), {
      limit: 1200,
      windowMs: 60_000,
      prefix: 'm3u8-proxy',
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
    const url = searchParams.get('url');

    if (!url) {
      return NextResponse.json({ error: '缺少 URL 參數' }, { status: 400 });
    }

    const allowPrivateNetworks = process.env.ALLOW_PRIVATE_NETWORKS === 'true';
    const allowedHosts = parseAllowedHosts(
      process.env.ALLOWED_M3U8_HOSTS || process.env.ALLOWED_PROXY_HOSTS
    );
    let safeUrl: string;
    try {
      safeUrl = assertSafeUrl(url, {
        allowPrivateNetworks,
        allowedHosts,
      }).toString();
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'URL 校驗失敗' },
        { status: 400 }
      );
    }
    await assertSafeResolvedUrl(safeUrl, {
      allowPrivateNetworks,
      allowedHosts,
    });
    const response = await safeFetch(
      safeUrl,
      {},
      {
        allowPrivateNetworks,
        allowedHosts,
      }
    );
    if (!response.ok) {
      throw new Error(`下載失敗: ${response.status}`);
    }
    const data = await response.arrayBuffer();

    return new NextResponse(data, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('代理下載失敗:', error);
    return NextResponse.json(
      {
        error: '下載失敗',
        message: error instanceof Error ? error.message : '未知錯誤',
      },
      { status: 500 }
    );
  }
}
