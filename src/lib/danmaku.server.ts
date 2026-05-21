import { createHash } from 'crypto';

import { getConfig } from './config';

const DEFAULT_DANMAKU_API_BASE_URL = 'https://api.dandanplay.net';
const INTERNAL_DANMAKU_PROXY_PREFIX = '/api/danmaku';

export async function getDanmakuUpstreamBaseUrl(): Promise<string> {
  const configured = await getConfiguredDanmakuBaseUrl();
  const normalized = normalizeDanmakuBaseUrl(configured);
  return normalized || DEFAULT_DANMAKU_API_BASE_URL;
}

export function buildDanmakuUpstreamUrl(
  baseUrl: string,
  pathname: string,
  search = ''
): string {
  const url = new URL(baseUrl);
  url.pathname = buildDanmakuUpstreamPath(url.pathname, pathname);
  url.search = search.startsWith('?') ? search.slice(1) : search;
  return url.toString();
}

export function buildDanmakuUpstreamHeaders(
  baseUrl: string,
  pathname: string,
  headers: HeadersInit = {}
): HeadersInit {
  const nextHeaders = new Headers(headers);

  if (isDandanplayUpstream(baseUrl)) {
    const credentials = getDandanplayCredentials();
    if (credentials) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createHash('sha256')
        .update(
          `${credentials.appId}${timestamp}${pathname}${credentials.appSecret}`
        )
        .digest('base64');

      nextHeaders.set('X-AppId', credentials.appId);
      nextHeaders.set('X-Timestamp', timestamp);
      nextHeaders.set('X-Signature', signature);
    }
  }

  return nextHeaders;
}

export function getDanmakuUpstreamConfigError(baseUrl: string): string | null {
  if (!isDandanplayUpstream(baseUrl) || getDandanplayCredentials()) {
    return null;
  }

  return 'Dandanplay upstream requires DANDANPLAY_APP_ID and DANDANPLAY_APP_SECRET, or configure a custom danmu_api/misaka base URL.';
}

async function getConfiguredDanmakuBaseUrl(): Promise<string> {
  try {
    const config = await getConfig();
    return (
      config.SiteConfig.DanmakuApiBaseUrl ||
      process.env.NEXT_PUBLIC_DANMU_API_BASE_URL ||
      process.env.DANMU_API_BASE_URL ||
      ''
    );
  } catch {
    return (
      process.env.NEXT_PUBLIC_DANMU_API_BASE_URL ||
      process.env.DANMU_API_BASE_URL ||
      ''
    );
  }
}

function normalizeDanmakuBaseUrl(value: string): string {
  const raw = value.trim();
  if (!raw || raw.startsWith(INTERNAL_DANMAKU_PROXY_PREFIX)) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function buildDanmakuUpstreamPath(
  basePath: string,
  endpointPath: string
): string {
  const normalizedBase = normalizePath(basePath);
  const normalizedEndpoint = normalizePath(endpointPath);

  if (
    normalizedBase.endsWith('/api/v2') &&
    normalizedEndpoint.startsWith('/api/v2')
  ) {
    return `${normalizedBase}${normalizedEndpoint.slice('/api/v2'.length)}`;
  }

  if (!normalizedBase || normalizedBase === '/') {
    return normalizedEndpoint || '/';
  }

  return `${normalizedBase}${normalizedEndpoint}`;
}

function normalizePath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '');
  if (!normalized) return '';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function isDandanplayUpstream(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'api.dandanplay.net';
  } catch {
    return false;
  }
}

function getDandanplayCredentials(): {
  appId: string;
  appSecret: string;
} | null {
  const appId =
    process.env.DANDANPLAY_APP_ID ||
    process.env.DANMAKU_DANDANPLAY_APP_ID ||
    '';
  const appSecret =
    process.env.DANDANPLAY_APP_SECRET ||
    process.env.DANMAKU_DANDANPLAY_APP_SECRET ||
    '';

  if (!appId.trim() || !appSecret.trim()) {
    return null;
  }

  return {
    appId: appId.trim(),
    appSecret: appSecret.trim(),
  };
}
