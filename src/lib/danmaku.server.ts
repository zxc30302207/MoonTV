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
  const url = new URL(pathname, baseUrl);
  url.search = search;
  return url.toString();
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
