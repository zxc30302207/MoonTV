import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import {
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
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();
    const timeoutParam = searchParams.get('timeout');
    const timeout = timeoutParam
      ? parseInt(timeoutParam, 10) * 1000
      : undefined; // 轉換為毫秒

    if (!query) {
      return NextResponse.json(
        { suggestions: [] },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const authInfo = getAuthInfoFromCookie(request);
    const username = authInfo?.username;

    // 用 ReadableStream 流式返回搜索建議
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const suggestionsStream = generateSuggestionsStream(
          toSimplified(query || ''),
          username,
          timeout
        );

        for await (const suggestions of suggestionsStream) {
          controller.enqueue(
            encoder.encode(JSON.stringify({ suggestions }) + '\n')
          );
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: '獲取搜索建議失敗' }, { status: 500 });
  }
}

async function* generateSuggestionsStream(
  query: string,
  username?: string,
  timeout?: number
) {
  const queryLower = toSimplified(query).toLowerCase();
  const config = await getConfig();
  const shouldFilterYellow = !canAccessAdultContent(config, username);
  const apiSites = await getAvailableApiSites(username);

  if (apiSites.length > 0) {
    // 使用第一個可用的數據源進行流式搜索
    const site = apiSites[0];

    for await (const results of searchFromApiStream(
      site,
      toSimplified(query),
      true,
      timeout
    )) {
      const filteredResults = shouldFilterYellow
        ? results.filter((result) => !isYellowSearchResult(result))
        : results;

      // 統計關鍵詞出現頻率
      const keywordFrequency = new Map<string, number>();
      const allKeywords = filteredResults
        .map((r: SearchResult) => r.title)
        .filter(Boolean)
        .flatMap((title: string) => title.split(/[ -:：·、-]/))
        .filter(
          (w: string) => w.length > 1 && w.toLowerCase().includes(queryLower)
        );

      allKeywords.forEach((word) => {
        const lower = word.toLowerCase();
        keywordFrequency.set(lower, (keywordFrequency.get(lower) || 0) + 1);
      });

      const realKeywords: string[] = Array.from(new Set(allKeywords)).slice(
        0,
        8
      );

      const realSuggestions = realKeywords.map((word) => {
        const wordLower = word.toLowerCase();
        const queryWords = queryLower.split(/[ -:：·、-]/);
        const frequency = keywordFrequency.get(wordLower) || 1;

        // 計算基礎匹配分數
        let score = 1.0;
        if (wordLower === queryLower) {
          score = 3.0; // 完全匹配 - 最高優先級
        } else if (wordLower.startsWith(queryLower)) {
          score = 2.5; // 開頭匹配 - 高優先級
        } else if (wordLower.endsWith(queryLower)) {
          score = 2.0; // 結尾匹配 - 中高優先級
        } else if (queryWords.some((qw) => wordLower.startsWith(qw))) {
          score = 1.8; // 包含查詢詞開頭
        } else if (queryWords.some((qw) => wordLower.includes(qw))) {
          score = 1.5; // 包含查詢詞
        }

        // 長度相似度加分（長度接近查詢的更相關）
        const lengthDiff = Math.abs(wordLower.length - queryLower.length);
        const lengthSimilarity = 1 / (1 + lengthDiff * 0.1);
        score += lengthSimilarity * 0.3;

        // 頻率加分（出現次數多的更相關，但使用對數避免過度影響）
        const frequencyBonus = Math.log(frequency + 1) * 0.2;
        score += frequencyBonus;

        // 長度懲罰（過長的關鍵詞稍微降權）
        if (wordLower.length > queryLower.length * 2) {
          score -= 0.2;
        }

        return { text: word, score, frequency };
      });

      const sortedSuggestions = realSuggestions
        .sort((a, b) => {
          // 首先按分數排序
          if (Math.abs(a.score - b.score) > 0.01) {
            return b.score - a.score;
          }
          // 分數相近時，按頻率排序
          if (a.frequency !== b.frequency) {
            return b.frequency - a.frequency;
          }
          // 頻率相同時，按長度排序（較短的優先）
          return a.text.length - b.text.length;
        })
        .map(({ text }) => ({ text })); // 只保留 text 字段

      // 每次 yield 一批建議
      yield sortedSuggestions;
    }
  }
}
