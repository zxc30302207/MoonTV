/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api') && !isSafeMethod(request.method)) {
    if (!isSameOrigin(request)) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  // 跳過不需要認證的路徑
  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  if (!process.env.PASSWORD) {
    // 如果沒有設置密碼，重定向到警告頁面
    const warningUrl = new URL('/warning', request.url);
    return NextResponse.redirect(warningUrl);
  }

  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo) {
    return handleAuthFailure(request, pathname);
  }

  return NextResponse.next();
}

// 處理認證失敗的情況
function handleAuthFailure(
  request: NextRequest,
  pathname: string
): NextResponse {
  // 如果是 API 路由，返回 401 狀態碼
  if (pathname.startsWith('/api')) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // 否則重定向到登錄頁面
  const loginUrl = new URL('/login', request.url);
  // 保留完整的URL，包括查詢參數
  const fullUrl = `${pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set('redirect', fullUrl);
  return NextResponse.redirect(loginUrl);
}

function isSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') || request.nextUrl.host;
  const proto =
    request.headers.get('x-forwarded-proto') ||
    request.nextUrl.protocol.replace(':', '');
  const expectedOrigin = `${proto}://${host}`;

  if (origin) {
    return origin === expectedOrigin;
  }

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) {
    return fetchSite === 'same-origin' || fetchSite === 'same-site';
  }

  return false;
}

// 判斷是否需要跳過認證的路徑
function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/sw.js',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
    '/login',
    '/warning',
    '/api/login',
    '/api/register',
    '/api/logout',
    '/api/auth/me',
    '/api/cron',
    '/api/server-config',
    '/api/tvbox/config',
    '/api/tvbox/categories',
    '/api/douban/recommends',
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

// 配置middleware匹配規則
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
