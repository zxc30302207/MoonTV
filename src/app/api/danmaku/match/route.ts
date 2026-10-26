import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { readBoundedText } from '@/lib/bounded-response';
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
    if (!(await getVerifiedAuthInfo(request)))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    let body: { fileName?: unknown };
    try {
      const text = await readBoundedText(
        new Response(request.body),
        64 * 1024,
        REQUEST_TIMEOUT_MS
      );
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return NextResponse.json(
          { error: '請提供合法 JSON 物件' },
          { status: 400 }
        );
      body = parsed as { fileName?: unknown };
    } catch {
      return NextResponse.json(
        { error: '請求格式錯誤、過大或逾時' },
        { status: 400 }
      );
    }
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

    return await proxyResponse(response, 'application/json');
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
  const body = await readBoundedText(
    response,
    16 * 1024 * 1024,
    REQUEST_TIMEOUT_MS
  );
  return new NextResponse(body, {
    status: response.status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type':
        response.headers.get('content-type') || fallbackContentType,
    },
  });
}
