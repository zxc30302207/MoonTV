import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type UrlSafetyOptions = {
  allowPrivateNetworks?: boolean;
  allowLocalhost?: boolean;
  allowedProtocols?: string[];
  allowedHosts?: string[];
};

export type SafeFetchOptions = UrlSafetyOptions & {
  maxRedirects?: number;
};

function isIpv4Address(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = Number(part);
    return Number.isInteger(num) && num >= 0 && num <= 255;
  });
}

function isPrivateIpv4(hostname: string): boolean {
  if (!isIpv4Address(hostname)) return false;
  const [a, b] = hostname.split('.').map((part) => Number(part));

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && b >= 18 && b <= 19) return true;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname
    .replace(/^\[|\]$/g, '')
    .split('%')[0]
    .toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.replace('::ffff:', '');
    return isPrivateIpv4(mapped);
  }
  return false;
}

function isLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (lower.endsWith('.local') || lower.endsWith('.internal')) return true;
  if (lower.endsWith('.lan')) return true;
  return false;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function isPrivateAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  return isPrivateIpv4(normalized) || isPrivateIpv6(normalized);
}

function isAllowedHostname(hostname: string, allowedHosts: string[]): boolean {
  const lower = hostname.toLowerCase();
  return allowedHosts.some((entry) => {
    const normalized = entry.trim().toLowerCase();
    if (!normalized) return false;
    const candidate = normalized.startsWith('.')
      ? normalized.slice(1)
      : normalized;
    return lower === candidate || lower.endsWith(`.${candidate}`);
  });
}

export function parseAllowedHosts(value?: string): string[] | undefined {
  if (!value) return undefined;
  const parsed = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

export function assertSafeUrl(
  input: string,
  options: UrlSafetyOptions = {}
): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('URL 格式錯誤');
  }

  const allowedProtocols = options.allowedProtocols || ['http:', 'https:'];
  if (!allowedProtocols.includes(url.protocol)) {
    throw new Error('不支持的 URL 協議');
  }

  if (url.username || url.password) {
    throw new Error('URL 不允許包含用戶名或密碼');
  }

  const hostname = normalizeHostname(url.hostname);
  if (!options.allowLocalhost && isLocalHostname(hostname)) {
    throw new Error('不允許訪問本地地址');
  }

  if (!options.allowPrivateNetworks) {
    if (isPrivateAddress(hostname)) {
      throw new Error('不允許訪問內網地址');
    }
  }

  if (options.allowedHosts && options.allowedHosts.length > 0) {
    if (!isAllowedHostname(hostname, options.allowedHosts)) {
      throw new Error('目標地址不在允許列表');
    }
  }

  return url;
}

export async function assertSafeResolvedUrl(
  input: string,
  options: UrlSafetyOptions = {}
): Promise<URL> {
  const url = assertSafeUrl(input, options);
  if (options.allowPrivateNetworks) return url;

  const hostname = normalizeHostname(url.hostname);
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error('不允許訪問內網地址');
    }
    return url;
  }

  const records = await lookup(hostname, { all: true, verbatim: true });
  if (records.some((record) => isPrivateAddress(record.address))) {
    throw new Error('不允許訪問內網地址');
  }

  return url;
}

export async function safeFetch(
  input: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {}
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 3;
  let currentUrl = (await assertSafeResolvedUrl(input, options)).toString();

  for (
    let redirectCount = 0;
    redirectCount <= maxRedirects;
    redirectCount += 1
  ) {
    const response = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
    });
    const location = response.headers.get('location');

    if (
      response.status >= 300 &&
      response.status < 400 &&
      location &&
      redirectCount < maxRedirects
    ) {
      currentUrl = (
        await assertSafeResolvedUrl(
          new URL(location, currentUrl).toString(),
          options
        )
      ).toString();
      continue;
    }

    if (response.status >= 300 && response.status < 400 && location) {
      throw new Error('Redirect 次數過多');
    }

    return response;
  }

  throw new Error('Redirect 次數過多');
}
