import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { PinnedAddress, pinnedFetch } from './pinned-fetch';

export type UrlSafetyOptions = {
  allowPrivateNetworks?: boolean;
  allowLocalhost?: boolean;
  allowedProtocols?: string[];
  allowedHosts?: string[];
};

export type SafeFetchOptions = UrlSafetyOptions & {
  maxRedirects?: number;
  /** Total DNS + redirects + body deadline. */
  timeoutMs?: number;
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
  const address = hostname.replace(/^\[|\]$/g, '').split('%')[0];
  // Do not classify ordinary domain names such as fcdn.example as IPv6.
  if (isIP(address) !== 6) return false;

  // URL canonicalization converts dotted IPv4-mapped addresses into hex words.
  const normalized = new URL(`http://[${address}]/`).hostname.replace(
    /^\[|\]$/g,
    ''
  );
  const [left, right] = normalized.split('::');
  const leading = left ? left.split(':') : [];
  const trailing = right ? right.split(':') : [];
  const words = (
    right === undefined
      ? leading
      : [
          ...leading,
          ...Array(8 - leading.length - trailing.length).fill('0'),
          ...trailing,
        ]
  ).map((word) => parseInt(word, 16));

  if (words.slice(0, 7).every((word) => word === 0) && words[7] <= 1)
    return true;
  if ((words[0] & 0xfe00) === 0xfc00) return true;
  if ((words[0] & 0xffc0) === 0xfe80) return true;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const mapped = [
      words[6] >> 8,
      words[6] & 255,
      words[7] >> 8,
      words[7] & 255,
    ];
    return isPrivateIpv4(mapped.join('.'));
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

async function resolveSafeUrl(
  input: string,
  options: UrlSafetyOptions
): Promise<{ url: URL; addresses: PinnedAddress[] }> {
  const url = assertSafeUrl(input, options);
  const hostname = normalizeHostname(url.hostname);
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((record) => !isIP(record.address))) {
    throw new Error('DNS 沒有可用地址');
  }
  if (
    !options.allowPrivateNetworks &&
    addresses.some((record) => isPrivateAddress(record.address))
  ) {
    throw new Error('不允許訪問內網地址');
  }
  return { url, addresses };
}

export async function assertSafeResolvedUrl(
  input: string,
  options: UrlSafetyOptions = {}
): Promise<URL> {
  return (await resolveSafeUrl(input, options)).url;
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error('Aborted'));
    // Attach both settlement handlers even if cancellation won the race.
    // A late resolver failure must never become an unhandled rejection.
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Node-only scoped transport, pinned for every request and redirect hop. */
export async function safeFetch(
  input: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {}
): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  // All callers are read-only. Do not silently drop/replay a request body.
  if (!['GET', 'HEAD'].includes(method) || init.body != null) {
    throw new Error('Safe fetch 僅支援 GET / HEAD');
  }
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (
    !Number.isInteger(maxRedirects) ||
    maxRedirects < 0 ||
    maxRedirects > 10 ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 300_000
  ) {
    throw new Error('Invalid safe fetch bounds');
  }
  const headers = new Headers(init.headers);
  // Host is derived from the original URL, never supplied by the caller.
  headers.delete('host');
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) abort();
  const timer = setTimeout(
    () => controller.abort(new Error('Upstream deadline exceeded')),
    timeoutMs
  );
  const cleanup = () => {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  };
  let currentUrl = input;
  try {
    for (let count = 0; count <= maxRedirects; count += 1) {
      if (controller.signal.aborted)
        throw controller.signal.reason || new Error('Aborted');
      const { url, addresses } = await abortable(
        resolveSafeUrl(currentUrl, options),
        controller.signal
      );
      const response = await pinnedFetch(url, addresses, {
        method,
        headers,
        signal: controller.signal,
      });
      const location = response.headers.get('location');
      if ([301, 302, 303, 307, 308].includes(response.status) && location) {
        void response.body?.cancel().catch(() => undefined);
        if (count === maxRedirects) throw new Error('Redirect 次數過多');
        const next = new URL(location, url);
        if (next.origin !== url.origin) {
          for (const name of [
            'authorization',
            'proxy-authorization',
            'cookie',
            'cookie2',
            'referer',
          ])
            headers.delete(name);
        }
        if (url.protocol === 'https:' && next.protocol === 'http:') {
          headers.delete('referer');
        }
        currentUrl = next.href;
        continue;
      }
      if (!response.body) {
        cleanup();
        return response;
      }
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(stream) {
          try {
            const item = await reader.read();
            if (item.done) {
              cleanup();
              stream.close();
            } else stream.enqueue(item.value);
          } catch (error) {
            cleanup();
            stream.error(error);
          }
        },
        cancel(reason) {
          controller.abort(reason);
          void reader.cancel(reason).catch(() => undefined);
          cleanup();
        },
      });
      const result = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      Object.defineProperty(result, 'url', { value: response.url || url.href });
      return result;
    }
    throw new Error('Redirect 次數過多');
  } catch (error) {
    controller.abort(error);
    cleanup();
    throw error;
  }
}
