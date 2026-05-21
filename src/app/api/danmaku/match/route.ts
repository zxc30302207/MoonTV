import { NextRequest, NextResponse } from 'next/server';

import {
  buildDanmakuUpstreamHeaders,
  buildDanmakuUpstreamUrl,
  getDanmakuUpstreamBaseUrl,
  getDanmakuUpstreamConfigError,
} from '@/lib/danmaku.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REQUEST_TIMEOUT_MS = 10000;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { fileName?: unknown };
    if (typeof body.fileName !== 'string' || !body.fileName.trim()) {
      return NextResponse.json({ error: 'fileName 不能為空' }, { status: 400 });
    }

    const upstream = await getDanmakuUpstreamBaseUrl();
    const upstreamPath = '/api/v2/match';
    const configError = getDanmakuUpstreamConfigError(upstream);
    if (configError) {
      return NextResponse.json(
        { code: 'DANMAKU_UPSTREAM_AUTH_REQUIRED', error: configError },
        { status: 503 }
      );
    }

    const response = await fetch(
      buildDanmakuUpstreamUrl(upstream, upstreamPath),
      {
        method: 'POST',
        headers: buildDanmakuUpstreamHeaders(upstream, upstreamPath, {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ fileName: body.fileName }),
        cache: 'no-store',
        signal: createTimeoutSignal(REQUEST_TIMEOUT_MS),
      }
    );

    return proxyResponse(response, 'application/json');
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof DOMException && error.name === 'TimeoutError'
            ? '彈幕 API 請求逾時'
            : '彈幕 API 請求失敗',
      },
      {
        status:
          error instanceof DOMException && error.name === 'TimeoutError'
            ? 504
            : 502,
      }
    );
  }
}

function createTimeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

async function proxyResponse(response: Response, fallbackContentType: string) {
  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type':
        response.headers.get('content-type') || fallbackContentType,
    },
  });
}
