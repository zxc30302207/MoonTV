import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApiStream } from '@/lib/downstream';
import { SearchResult } from '@/lib/types';
import { yellowWords } from '@/lib/yellow';
import { toSimplified } from '@/lib/zh';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const queryForSearch = toSimplified(query || '');

  if (!query) {
    return new Response(JSON.stringify({ error: '搜索關鍵詞不能為空' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  const config = await getConfig();
  const apiSites = await getAvailableApiSites(authInfo.username);

  // 共享狀態
  let streamClosed = false;

  // 創建可讀流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // 輔助函數：安全地向控制器寫入數據
      const safeEnqueue = (data: Uint8Array) => {
        try {
          if (
            streamClosed ||
            (!controller.desiredSize && controller.desiredSize !== 0)
          ) {
            // 流已標記為關閉或控制器已關閉
            return false;
          }
          controller.enqueue(data);
          return true;
        } catch (error) {
          // 控制器已關閉或出現其他錯誤
          streamClosed = true;
          return false;
        }
      };

      // 發送開始事件
      const startEvent = `data: ${JSON.stringify({
        type: 'start',
        query,
        totalSources: apiSites.length,
        timestamp: Date.now(),
      })}\n\n`;

      if (!safeEnqueue(encoder.encode(startEvent))) {
        return; // 連接已關閉，提前退出
      }

      // 記錄已完成的源數量
      let completedSources = 0;
      const allResults: SearchResult[] = [];

      // 為每個源創建搜索 Promise
      const searchPromises = apiSites.map(async (site) => {
        try {
          // 添加超時控制
          const searchPromise = Promise.race([
            searchFromApiStream(site, queryForSearch),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`${site.name} timeout`)), 20000)
            ),
          ]);

          const resultsGenerator = (await searchPromise) as AsyncGenerator<
            SearchResult[],
            void,
            unknown
          >;

          // 收集所有結果
          const allResults: SearchResult[] = [];
          for await (const batch of resultsGenerator) {
            allResults.push(...batch);
          }

          // 過濾黃色內容
          let filteredResults = allResults;
          if (!config.SiteConfig.DisableYellowFilter) {
            filteredResults = allResults.filter((result) => {
              const typeName = result.type_name || '';
              return !yellowWords.some((word: string) =>
                typeName.includes(word)
              );
            });
          }

          // 發送該源的搜索結果
          completedSources++;

          if (!streamClosed) {
            const sourceEvent = `data: ${JSON.stringify({
              type: 'source_result',
              source: site.key,
              sourceName: site.name,
              results: filteredResults,
              timestamp: Date.now(),
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(sourceEvent))) {
              streamClosed = true;
              return; // 連接已關閉，停止處理
            }
          }

          if (filteredResults.length > 0) {
            allResults.push(...filteredResults);
          }
        } catch (error) {
          // 發送源錯誤事件
          completedSources++;

          if (!streamClosed) {
            const errorEvent = `data: ${JSON.stringify({
              type: 'source_error',
              source: site.key,
              sourceName: site.name,
              error: error instanceof Error ? error.message : '搜索失敗',
              timestamp: Date.now(),
            })}\n\n`;

            if (!safeEnqueue(encoder.encode(errorEvent))) {
              streamClosed = true;
              return; // 連接已關閉，停止處理
            }
          }
        }

        // 檢查是否所有源都已完成
        if (completedSources === apiSites.length) {
          if (!streamClosed) {
            // 發送最終完成事件
            const completeEvent = `data: ${JSON.stringify({
              type: 'complete',
              totalResults: allResults.length,
              completedSources,
              timestamp: Date.now(),
            })}\n\n`;

            if (safeEnqueue(encoder.encode(completeEvent))) {
              // 只有在成功發送完成事件後才關閉流
              try {
                controller.close();
              } catch (error) {
                // ignore
              }
            }
          }
        }
      });

      // 等待所有搜索完成
      await Promise.allSettled(searchPromises);
    },

    cancel() {
      // 客戶端斷開連接時，標記流已關閉
      streamClosed = true;
    },
  });

  // 返回流式響應
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
