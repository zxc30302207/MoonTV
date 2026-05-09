import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getCacheTime, getConfig } from '@/lib/config';
import { searchFromApiStream } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';
import { toSimplified } from '@/lib/zh';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // 檢查是否為本地存儲模式
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const isLocalStorage = storageType === 'localstorage';

  let authInfo = null;
  if (!isLocalStorage) {
    // 非本地存儲模式才需要認證
    authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const queryForSearch = toSimplified(query || '');
  const streamParam = searchParams.get('stream');
  const enableStream = streamParam ? streamParam !== '0' : false; // 無該參數關閉流式
  const timeoutParam = searchParams.get('timeout');
  const timeout = timeoutParam ? parseInt(timeoutParam, 10) * 1000 : undefined; // 轉換為毫秒

  const config = await getConfig();

  // 獲取用戶可用的搜索源
  let apiSites = await getAvailableApiSites(authInfo?.username);

  // 如果指定了搜索源，只使用選中的搜索源
  const selectedSourcesParam = searchParams.get('sources');
  if (selectedSourcesParam) {
    const selectedSources = selectedSourcesParam.split(',');
    apiSites = apiSites.filter((site) => selectedSources.includes(site.key));
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  if (!query) {
    // 空查詢，明確不緩存
    return new Response(JSON.stringify({ results: [] }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  }

  // 安全寫入與斷連處理
  let shouldStop = false;
  const abortSignal = request.signal as AbortSignal | undefined;
  abortSignal?.addEventListener('abort', () => {
    shouldStop = true;
    try {
      writer.close();
    } catch {
      // ignore
    }
  });

  const safeWrite = async (obj: unknown) => {
    if (shouldStop || abortSignal?.aborted) return false;
    try {
      await writer.write(encoder.encode(JSON.stringify(obj) + '\n'));
      return true;
    } catch {
      shouldStop = true;
      return false;
    }
  };

  // -------------------------
  // 非流式：並發
  // -------------------------
  if (!enableStream) {
    const tasks = apiSites.map(async (site) => {
      const siteResults: SearchResult[] = [];
      let hasResults = false;
      try {
        const generator = searchFromApiStream(
          site,
          queryForSearch,
          true,
          timeout
        );
        for await (const pageResults of generator) {
          let filteredResults = pageResults;
          if (filteredResults.length !== 0) {
            hasResults = true;
          }
          if (!config.SiteConfig.DisableYellowFilter) {
            filteredResults = pageResults.filter((result) => {
              const typeName = result.type_name || '';
              return !yellowWords.some((word) => typeName.includes(word));
            });
          }
          if (hasResults && filteredResults.length === 0) {
            throw new Error('結果被過濾');
          }
          siteResults.push(...filteredResults);
        }
        if (!hasResults) {
          throw new Error('無搜索結果');
        }
        return { siteResults, failed: null };
      } catch (err: unknown) {
        let errorMessage = (err as Error).message || '未知的錯誤';

        // 根據錯誤類型提供更具體的錯誤信息
        if ((err as Error).message === '請求超時') {
          errorMessage = '請求超時';
        } else if (
          (err as Error).message === '請求失敗' ||
          (err as Error).message === '網絡連接失敗'
        ) {
          errorMessage = '請求失敗';
        } else if ((err as Error).message.includes('網絡錯誤')) {
          errorMessage = '網絡錯誤';
        }

        return {
          siteResults: [],
          failed: { name: site.name, key: site.key, error: errorMessage },
        };
      }
    });

    const results = await Promise.all(tasks);
    const aggregatedResults = results.flatMap((r) => r.siteResults);
    const failedSources = results.filter((r) => r.failed).map((r) => r.failed);

    if (aggregatedResults.length === 0) {
      const body = { results: [], failedSources };
      return new Response(JSON.stringify(body), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      });
    } else {
      const cacheTime = await getCacheTime();
      const body = { results: aggregatedResults, failedSources };
      return new Response(JSON.stringify(body), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': `private, max-age=${cacheTime}`,
        },
      });
    }
  }

  // -------------------------
  // 流式：並發
  // -------------------------
  (async () => {
    const aggregatedResults: SearchResult[] = [];
    const failedSources: { name: string; key: string; error: string }[] = [];

    const tasks = apiSites.map(async (site) => {
      try {
        const generator = searchFromApiStream(
          site,
          queryForSearch,
          true,
          timeout
        );
        let hasResults = false;

        for await (const pageResults of generator) {
          let filteredResults = pageResults;
          if (filteredResults.length !== 0) {
            hasResults = true;
          }
          if (!config.SiteConfig.DisableYellowFilter) {
            filteredResults = pageResults.filter((result) => {
              const typeName = result.type_name || '';
              return !yellowWords.some((word) => typeName.includes(word));
            });
          }

          if (hasResults && filteredResults.length === 0) {
            failedSources.push({
              name: site.name,
              key: site.key,
              error: '結果被過濾',
            });
            await safeWrite({ failedSources });
            return;
          }

          aggregatedResults.push(...filteredResults);
          if (
            !(await safeWrite({ site: site.key, pageResults: filteredResults }))
          ) {
            return;
          }
        }

        if (!hasResults) {
          failedSources.push({
            name: site.name,
            key: site.key,
            error: '無搜索結果',
          });
          await safeWrite({ failedSources });
        }
      } catch (err: unknown) {
        let errorMessage = (err as Error).message || '未知的錯誤';

        // 根據錯誤類型提供更具體的錯誤信息
        if ((err as Error).message === '請求超時') {
          errorMessage = '請求超時';
        } else if ((err as Error).message === '請求失敗') {
          errorMessage = '請求失敗';
        } else if ((err as Error).message.includes('網絡錯誤')) {
          errorMessage = '網絡錯誤';
        }

        failedSources.push({
          name: site.name,
          key: site.key,
          error: errorMessage,
        });
        await safeWrite({ failedSources });
      }
    });

    // 等所有 site 跑完
    await Promise.allSettled(tasks);

    if (failedSources.length > 0) {
      await safeWrite({ failedSources });
    }
    await safeWrite({ aggregatedResults });

    try {
      await writer.close();
    } catch {
      // ignore
    }
  })();

  const cacheTime = await getCacheTime();
  return new Response(readable, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `private, max-age=${cacheTime}`,
    },
  });
}
