import type { SearchResult } from './types';

const DIRECT_M3U8_URL_PATTERN = /^https?:\/\/.+\.m3u8(?:$|[?#])/i;

export function cleanM3U8Url(url: string): string {
  return url.trim().replace(/[),.;]+$/g, '');
}

export function isDirectM3U8Url(url?: string): url is string {
  return Boolean(url && DIRECT_M3U8_URL_PATTERN.test(cleanM3U8Url(url)));
}

export function filterDirectM3U8Episodes(
  episodes: string[] = [],
  titles: string[] = []
) {
  return episodes.reduce(
    (filtered, rawUrl, index) => {
      const url = cleanM3U8Url(rawUrl || '');
      if (!isDirectM3U8Url(url)) return filtered;

      filtered.episodes.push(url);
      filtered.titles.push(titles[index] || String(index + 1));
      filtered.indexes.push(index);
      return filtered;
    },
    {
      episodes: [] as string[],
      titles: [] as string[],
      indexes: [] as number[],
    }
  );
}

export function sanitizePlaybackResult<T extends SearchResult>(result: T): T {
  const filtered = filterDirectM3U8Episodes(
    result.episodes,
    result.episodes_titles
  );

  if (filtered.episodes.length === result.episodes.length) return result;

  return {
    ...result,
    episodes: filtered.episodes,
    episodes_titles: filtered.titles,
  };
}
