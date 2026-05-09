export type UrlSafetyOptions = {
  allowPrivateNetworks?: boolean;
  allowLocalhost?: boolean;
  allowedProtocols?: string[];
  allowedHosts?: string[];
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
  const normalized = hostname.split('%')[0].toLowerCase();
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

  const hostname = url.hostname;
  if (!options.allowLocalhost && isLocalHostname(hostname)) {
    throw new Error('不允許訪問本地地址');
  }

  if (!options.allowPrivateNetworks) {
    if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
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
