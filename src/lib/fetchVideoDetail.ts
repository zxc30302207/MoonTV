import { getAvailableApiSites } from '@/lib/config';
import { SearchResult } from '@/lib/types';

import { getDetailFromApi, searchFromApiStream } from './downstream';

interface FetchVideoDetailOptions {
  source: string;
  id: string;
  fallbackTitle?: string;
  timeout?: number; // 超時時間（毫秒）
}

/**
 * 根據 source 與 id 獲取視頻詳情（支持流式搜索）。
 */
export async function fetchVideoDetail({
  source,
  id,
  fallbackTitle = '',
  timeout,
}: FetchVideoDetailOptions): Promise<SearchResult> {
  const apiSites = await getAvailableApiSites();
  const apiSite = apiSites.find((site) => site.key === source);
  if (!apiSite) {
    throw new Error('無效的API來源');
  }

  // 使用流式搜索嘗試精確匹配
  if (fallbackTitle) {
    try {
      for await (const results of searchFromApiStream(
        apiSite,
        fallbackTitle.trim(),
        true,
        timeout
      )) {
        const exactMatch = results.find(
          (item: SearchResult) =>
            item.source.toString() === source.toString() &&
            item.id.toString() === id.toString()
        );
        if (exactMatch) {
          return exactMatch; // 找到就立即返回
        }
      }
    } catch (error) {
      // 流式搜索失敗時忽略
    }
  }

  // 流式搜索未命中或未提供 fallbackTitle，則調用 /api/detail
  const detail = await getDetailFromApi(apiSite, id);
  if (!detail) {
    throw new Error('獲取視頻詳情失敗');
  }

  return detail;
}
