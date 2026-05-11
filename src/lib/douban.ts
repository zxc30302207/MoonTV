import * as cheerio from 'cheerio';
import { createHash } from 'crypto';

type DoubanCookieCache = {
  cookie: string;
  expiresAt: number;
};

let doubanCookieCache: DoubanCookieCache | null = null;

/**
 * 通用的豆瓣數據獲取函數
 * @param url 請求的URL
 * @returns Promise<T> 返回指定類型的數據
 */
export async function fetchDoubanData<T>(url: string): Promise<T> {
  // 添加超時控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超時

  // 設置請求選項，包括信號和頭部
  const fetchOptions = {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Referer: 'https://movie.douban.com/',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://movie.douban.com',
    },
  };

  try {
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function fetchDoubanHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  const headers = {
    ...doubanHtmlHeaders(),
    Origin: 'https://movie.douban.com',
  };
  const fetchOptions: RequestInit = {
    signal: controller.signal,
    redirect: 'manual',
    headers,
  };

  try {
    let response = await fetch(url, fetchOptions);

    if (isDoubanVerificationRedirect(response)) {
      const cookie = await getDoubanVerificationCookie(url, response);
      response = await fetch(url, {
        ...fetchOptions,
        headers: {
          ...headers,
          Cookie: cookie,
        },
      });
    }

    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const html = await response.text();
    if (isDoubanVerificationHtml(html)) {
      throw new Error('Douban verification page returned');
    }

    return html;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export function isDoubanVerificationHtml(html: string): boolean {
  return (
    html.includes('sec.douban.com') ||
    (html.includes('id="tok"') &&
      html.includes('id="cha"') &&
      html.includes('id="red"'))
  );
}

function isDoubanVerificationRedirect(response: Response): boolean {
  if (response.status !== 302 && response.status !== 301) return false;
  return (response.headers.get('location') || '').includes('sec.douban.com');
}

async function getDoubanVerificationCookie(
  originalUrl: string,
  redirectResponse?: Response
): Promise<string> {
  const cachedCookie = getCachedDoubanCookie();
  if (cachedCookie) {
    return cachedCookie;
  }

  const location =
    redirectResponse?.headers.get('location') ||
    (await resolveVerificationLocation(originalUrl));

  if (!location) {
    throw new Error('Douban verification location missing');
  }

  const verificationUrl = new URL(location, originalUrl).toString();
  const verificationResponse = await fetch(verificationUrl, {
    headers: doubanHtmlHeaders(),
  });

  if (!verificationResponse.ok) {
    throw new Error(
      `Failed to fetch douban verification page: ${verificationResponse.status}`
    );
  }

  const verificationHtml = await verificationResponse.text();
  const challenge = parseDoubanVerificationChallenge(verificationHtml);
  if (!challenge) {
    throw new Error('Failed to parse douban verification challenge');
  }

  const formBody = new URLSearchParams({
    tok: challenge.tok,
    cha: challenge.cha,
    sol: solveProofOfWork(challenge.cha).toString(),
    red: challenge.red,
  });

  const submitResponse = await fetch('https://sec.douban.com/c', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...doubanHtmlHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formBody.toString(),
  });

  const cookie = extractDoubanCookie(submitResponse.headers.get('set-cookie'));
  if (!cookie) {
    throw new Error('No douban verification cookie received');
  }

  doubanCookieCache = {
    cookie,
    expiresAt: Date.now() + 300000,
  };

  return cookie;
}

async function resolveVerificationLocation(
  url: string
): Promise<string | null> {
  const response = await fetch(url, {
    redirect: 'manual',
    headers: doubanHtmlHeaders(),
  });

  return response.headers.get('location');
}

function parseDoubanVerificationChallenge(html: string): {
  tok: string;
  cha: string;
  red: string;
} | null {
  const $ = cheerio.load(html);
  const tok = String($('#tok').val() || '');
  const cha = String($('#cha').val() || '');
  const red = String($('#red').val() || '');

  if (!tok || !cha || !red) return null;

  return { tok, cha, red };
}

function solveProofOfWork(challenge: string, difficulty = 4): number {
  const prefix = '0'.repeat(difficulty);
  let nonce = 0;

  while (nonce < Number.MAX_SAFE_INTEGER) {
    nonce += 1;
    const hash = createHash('sha512')
      .update(`${challenge}${nonce}`)
      .digest('hex');

    if (hash.startsWith(prefix)) return nonce;
  }

  throw new Error('Douban proof-of-work solution not found');
}

function extractDoubanCookie(setCookieHeader: string | null): string {
  if (!setCookieHeader) return '';

  const dbsawcv1 = setCookieHeader.match(/dbsawcv1=([^;]+)/);
  if (dbsawcv1) {
    return `dbsawcv1=${dbsawcv1[1]}`;
  }

  return setCookieHeader.split(';')[0] || '';
}

function isDoubanCookieCacheValid(): boolean {
  return (
    !!doubanCookieCache && Date.now() < doubanCookieCache.expiresAt - 20000
  );
}

function getCachedDoubanCookie(): string | null {
  return isDoubanCookieCacheValid() && doubanCookieCache
    ? doubanCookieCache.cookie
    : null;
}

function doubanHtmlHeaders() {
  return {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    Referer: 'https://movie.douban.com/',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
}
