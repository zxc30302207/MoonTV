import { NextRequest } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { clampSearchConcurrency, mapWithConcurrency } from '@/lib/concurrency';
import {
  ApiSite,
  canAccessAdultContent,
  getAvailableApiSites,
  getConfig,
} from '@/lib/config';
import { searchFromApiStream } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';
import { isYellowSearchResult } from '@/lib/yellow';
import { toSimplified } from '@/lib/zh';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // 檢查是否為本地存儲模式
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const isLocalStorage = storageType === 'localstorage';

  let authInfo = null;
  if (!isLocalStorage) {
    // 非本地存儲模式才需要認證
    authInfo = await getVerifiedAuthInfo(request);
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

  // 单次搜索同时查询的上游源数量，由前端搜索设置传入。
  // 服务端再做一次收敛，避免被构造请求放大到不受控的并发。
  const searchConcurrency = clampSearchConcurrency(
    searchParams.get('concurrency')
  );

  if (!query) {
    // 空查询无需读取配置，也无需创建流，明确不缓存
    return new Response(JSON.stringify({ results: [] }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  }

  const config = await getConfig();
  const shouldFilterYellow = !canAccessAdultContent(config, authInfo?.username);

  // 获取用户可用的搜索源
  let apiSites = await getAvailableApiSites(authInfo?.username);

  // 如果指定了搜索源，只使用选中的搜索源
  const selectedSourcesParam = searchParams.get('sources');
  if (selectedSourcesParam) {
    const selectedSources = selectedSourcesParam.split(',');
    apiSites = apiSites.filter((site) => selectedSources.includes(site.key));
  }

  // -------------------------
  // 非流式：並發
  // -------------------------
  if (!enableStream) {
    const searchSite = async (site: ApiSite) => {
      const siteResults: SearchResult[] = [];
      let hasResults = false;
      try {
        const generator = searchFromApiStream(
          site,
          queryForSearch,
          true,
          timeout,
          request.signal
        );
        for await (const pageResults of generator) {
          let filteredResults = pageResults;
          if (filteredResults.length !== 0) {
            hasResults = true;
          }
          if (shouldFilterYellow) {
            filteredResults = pageResults.filter(
              (result) => !isYellowSearchResult(result)
            );
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
        const error = err instanceof Error ? err : new Error(String(err));
        let errorMessage = error.message || '未知的錯誤';

        // 根據錯誤類型提供更具體的錯誤信息
        if (error.message === '請求超時') {
          errorMessage = '請求超時';
        } else if (
          error.message === '請求失敗' ||
          error.message === '網絡連接失敗'
        ) {
          errorMessage = '請求失敗';
        } else if (error.message.includes('網絡錯誤')) {
          errorMessage = '網絡錯誤';
        }

        return {
          siteResults: [],
          failed: { name: site.name, key: site.key, error: errorMessage },
        };
      }
    };

    const results = await mapWithConcurrency(
      apiSites,
      searchConcurrency,
      searchSite
    );
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
      const body = { results: aggregatedResults, failedSources };
      return new Response(JSON.stringify(body), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'private, no-store',
        },
      });
    }
  }

  // -------------------------
  // 流式：並發
  // -------------------------
  // 只有流式响应才需要创建 TransformStream 与 writer
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // 安全写入与断连处理
  let shouldStop = false;
  const abortSignal = request.signal as AbortSignal | undefined;
  abortSignal?.addEventListener('abort', () => {
    shouldStop = true;
    void writer.abort().catch(() => undefined);
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

  (async () => {
    const failedSources: { name: string; key: string; error: string }[] = [];

    const searchSite = async (site: ApiSite) => {
      if (shouldStop || abortSignal?.aborted) return;
      try {
        const generator = searchFromApiStream(
          site,
          queryForSearch,
          true,
          timeout,
          request.signal
        );
        let hasResults = false;

        for await (const pageResults of generator) {
          let filteredResults = pageResults;
          if (filteredResults.length !== 0) {
            hasResults = true;
          }
          if (shouldFilterYellow) {
            filteredResults = pageResults.filter(
              (result) => !isYellowSearchResult(result)
            );
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
        const error = err instanceof Error ? err : new Error(String(err));
        let errorMessage = error.message || '未知的錯誤';

        // 根據錯誤類型提供更具體的錯誤信息
        if (error.message === '請求超時') {
          errorMessage = '請求超時';
        } else if (error.message === '請求失敗') {
          errorMessage = '請求失敗';
        } else if (error.message.includes('網絡錯誤')) {
          errorMessage = '網絡錯誤';
        }

        failedSources.push({
          name: site.name,
          key: site.key,
          error: errorMessage,
        });
        await safeWrite({ failedSources });
      }
    };

    try {
      // 等所有來源完成；斷線後不再啟動佇列中的查詢。
      await mapWithConcurrency(apiSites, searchConcurrency, searchSite);
      if (failedSources.length > 0) {
        await safeWrite({ failedSources });
      }
    } finally {
      try {
        await writer.close();
      } catch {
        // The reader may already have disconnected.
      }
    }
  })().catch(() => undefined);

  return new Response(readable, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}
