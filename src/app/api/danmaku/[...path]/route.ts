import { NextRequest, NextResponse } from 'next/server';

import {
  buildDanmakuUpstreamUrl,
  getDanmakuUpstreamBaseUrl,
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
    const { path } = await paramsPromise;
    if (!Array.isArray(path) || path[0] !== 'api' || path[1] !== 'v2') {
      return NextResponse.json(
        { error: '不支持的彈幕 API 路徑' },
        { status: 404 }
      );
    }

    const requestUrl = new URL(request.url);
    const upstream = await getDanmakuUpstreamBaseUrl();
    const body =
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.text();
    const response = await fetch(
      buildDanmakuUpstreamUrl(
        upstream,
        `/${path.join('/')}`,
        requestUrl.search
      ),
      {
        method: request.method,
        headers: pickProxyHeaders(request),
        body,
        cache: 'no-store',
        signal: createTimeoutSignal(REQUEST_TIMEOUT_MS),
      }
    );

    return proxyResponse(response);
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
  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type':
        response.headers.get('content-type') || 'application/octet-stream',
    },
  });
}
