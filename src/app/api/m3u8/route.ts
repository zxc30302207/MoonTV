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
    const rateLimitResult = await rateLimit(getClientIp(request), {
      limit: 60,
      windowMs: 60_000,
      prefix: 'm3u8-parse',
    });
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: rateLimitResult.unavailable
            ? '服務暫時無法使用，請稍後再試'
            : '請求過於頻繁，請稍後再試',
        },
        {
          status: rateLimitResult.unavailable ? 503 : 429,
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
      signal: request.signal,
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
    const rateLimitResult = await rateLimit(getClientIp(request), {
      limit: 1200,
      windowMs: 60_000,
      prefix: 'm3u8-proxy',
    });
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: rateLimitResult.unavailable
            ? '服務暫時無法使用，請稍後再試'
            : '請求過於頻繁，請稍後再試',
        },
        {
          status: rateLimitResult.unavailable ? 503 : 429,
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
    const range = request.headers.get('Range');
    if (range) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      const start = Number(match?.[1]);
      const end = Number(match?.[2]);
      if (
        !match ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        end < start
      ) {
        return NextResponse.json(
          { error: '無效的 Range 請求' },
          { status: 400 }
        );
      }
    }
    const response = await safeFetch(
      safeUrl,
      {
        signal: request.signal,
        cache: 'no-store',
        headers: range
          ? { Range: range, 'Accept-Encoding': 'identity' }
          : undefined,
      },
      { allowPrivateNetworks, allowedHosts }
    );
    const headers = new Headers({
      // Never serve upstream HTML/SVG as active content on our own origin.
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-MoonTV-Upstream-URL': response.url || safeUrl,
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Cookie, Range',
    });
    // Preserve range response metadata and status, including 416 and servers
    // that ignore Range with 200, so clients can validate before using bytes.
    for (const name of ['Content-Range', 'Content-Length', 'Accept-Ranges']) {
      // fetch may transparently decode gzip; its wire length is then invalid.
      if (
        name === 'Content-Length' &&
        response.headers.get('Content-Encoding') &&
        response.headers.get('Content-Encoding') !== 'identity'
      )
        continue;
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new NextResponse(response.body, {
      status: response.status,
      headers,
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
