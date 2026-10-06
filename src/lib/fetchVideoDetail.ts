import { getAvailableApiSites } from '@/lib/config';
import { sanitizePlaybackResult } from '@/lib/playback-url';
import { SearchResult } from '@/lib/types';

import { getDetailFromApi, searchFromApiStream } from './downstream';

interface FetchVideoDetailOptions {
  source: string;
  id: string;
  fallbackTitle?: string;
  timeout?: number;
  username?: string;
}

/** 優先使用搜索中 source + id 精確命中的可播放集數，再回退到詳情接口。 */
export async function fetchVideoDetail({
  source,
  id,
  fallbackTitle = '',
  timeout,
  username,
}: FetchVideoDetailOptions): Promise<SearchResult> {
  const apiSites = await getAvailableApiSites(username);
  const apiSite = apiSites.find((site) => site.key === source);
  if (!apiSite) throw new Error('無效的API來源');

  if (fallbackTitle.trim()) {
    try {
      for await (const results of searchFromApiStream(
        apiSite,
        fallbackTitle.trim(),
        true,
        timeout
      )) {
        for (const item of results) {
          if (
            String(item.source) === String(source) &&
            String(item.id) === String(id) &&
            item.episodes?.length
          ) {
            const playable = sanitizePlaybackResult(item);
            if (playable.episodes.length) return playable;
          }
        }
      }
    } catch {
      // 搜索不可用時繼續使用相同來源的詳情接口。
    }
  }

  const detail = await getDetailFromApi(apiSite, id);
  if (!detail) throw new Error('獲取視頻詳情失敗');
  return sanitizePlaybackResult(detail);
}
