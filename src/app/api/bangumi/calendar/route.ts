import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { safeFetch } from '@/lib/url-safety';

export const runtime = 'nodejs';

interface BangumiCalendarItem {
  id: number;
  name: string;
  name_cn: string;
  rating: {
    score: number;
  };
  air_date: string;
  images: {
    large: string;
    common: string;
    medium: string;
    small: string;
    grid: string;
  };
}

interface BangumiCalendarData {
  weekday: {
    en: string;
  };
  items: BangumiCalendarItem[];
}

function replaceImageUrl(
  data: BangumiCalendarData[],
  imageProxy: string
): BangumiCalendarData[] {
  return data
    .filter((day) => day && Array.isArray(day.items))
    .map((day) => ({
      ...day,
      items: (day.items || [])
        .filter((item) => item && item.images)
        .map((item) => {
          const replace = (url: string) => {
            if (typeof url !== 'string') return '';
            if (!imageProxy) return url;
            try {
              const parsed = new URL(url);
              if (parsed.origin !== 'https://lain.bgm.tv') return url;
              return imageProxy + parsed.pathname + parsed.search;
            } catch {
              return '';
            }
          };
          return {
            ...item,
            images: {
              large: replace(item.images.large),
              common: replace(item.images.common),
              medium: replace(item.images.medium),
              small: replace(item.images.small),
              grid: replace(item.images.grid),
            },
          };
        }),
    }));
}

export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  const auth = await getVerifiedAuthInfo(request);
  if (!auth)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  try {
    const config = await getConfig();
    const bangumiProxy =
      config.SiteConfig.BangumiProxy ||
      process.env.NEXT_PUBLIC_BANGUMI_PROXY ||
      '';
    const imageProxy =
      config.SiteConfig.BangumiImageProxy ||
      process.env.NEXT_PUBLIC_BANGUMI_IMAGE_PROXY ||
      '';

    const baseUrl = bangumiProxy
      ? bangumiProxy.replace(/\/+$/, '')
      : 'https://api.bgm.tv';

    const urls = bangumiProxy
      ? [`${baseUrl}/calendar`, 'https://api.bgm.tv/calendar']
      : ['https://api.bgm.tv/calendar'];

    let data: BangumiCalendarData[] = [];
    let lastError: unknown;

    for (const url of urls) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      const timeout = setTimeout(abort, 10000);
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
      try {
        const response = await safeFetch(url, {
          signal: controller.signal,
          cache: 'no-store',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            Accept: 'application/json',
          },
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new Error(`HTTP ${response.status}`);
        }
        const json = await response.json();
        if (Array.isArray(json)) {
          data = json as BangumiCalendarData[];
          lastError = undefined;
          break;
        }
      } catch (error) {
        lastError = error;
        if (request.signal.aborted) break;
        continue;
      } finally {
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', abort);
      }
    }

    if (!data.length && lastError) {
      // eslint-disable-next-line no-console
      console.error('Bangumi 日曆所有來源均請求失敗:', lastError);
    }

    let safeImageProxy = '';
    try {
      const parsed = new URL(imageProxy);
      if (
        ['http:', 'https:'].includes(parsed.protocol) &&
        !parsed.username &&
        !parsed.password
      )
        safeImageProxy = imageProxy.replace(/\/+$/, '');
    } catch {
      /* 使用原始圖片網址 */
    }
    const processed = replaceImageUrl(data, safeImageProxy);

    return NextResponse.json(processed, { headers });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Bangumi 日曆接口異常:', error);
    return NextResponse.json([], { status: 200, headers });
  }
}
