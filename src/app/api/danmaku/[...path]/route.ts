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

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyDanmakuRequest(request, context.params);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyDanmakuRequest(request, context.params);
}

async function proxyDanmakuRequest(
  request: NextRequest,
  paramsPromise: Promise<{ path: string[] }>
) {
  try {
    if (!(await getVerifiedAuthInfo(request)))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { path } = await paramsPromise;
    const upstreamPath = Array.isArray(path) ? `/${path.join('/')}` : '';
    const allowed =
      request.method === 'GET'
        ? /^\/api\/v2\/(?:search\/(?:anime|episodes)|(?:bangumi|comment)\/\d+)$/.test(
            upstreamPath
          )
        : request.method === 'POST' && upstreamPath === '/api/v2/match';
    if (!allowed)
      return NextResponse.json(
        { error: '不支持的彈幕 API 路徑' },
        { status: 404 }
      );

    const requestUrl = new URL(request.url);
    const upstream = await getDanmakuUpstreamBaseUrl();
    const configError = getDanmakuUpstreamConfigError(upstream);
    if (configError) {
      return NextResponse.json(
        { code: 'DANMAKU_UPSTREAM_AUTH_REQUIRED', error: configError },
        { status: 503 }
      );
    }

    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await readBoundedText(new Response(request.body), 64 * 1024);
    const response = await fetch(
      buildDanmakuUpstreamUrl(upstream, upstreamPath, requestUrl.search),
      {
        method: request.method,
        headers: buildDanmakuUpstreamHeaders(
          upstream,
          upstreamPath,
          pickProxyHeaders(request)
        ),
        body,
        cache: 'no-store',
        signal: createTimeoutSignal(REQUEST_TIMEOUT_MS),
      }
    );

    return await proxyResponse(response);
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

function pickProxyHeaders(request: NextRequest): HeadersInit {
  const headers: Record<string, string> = {
    Accept: request.headers.get('accept') || 'application/json',
  };
  const contentType = request.headers.get('content-type');
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  return headers;
}

async function proxyResponse(response: Response) {
  const body = await readBoundedText(response, 16 * 1024 * 1024);
  return new NextResponse(body, {
    status: response.status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type':
        response.headers.get('content-type') || 'application/octet-stream',
    },
  });
}
