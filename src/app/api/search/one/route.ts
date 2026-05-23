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
import { normalizeForCompare, toSimplified } from '@/lib/zh';

export const runtime = 'nodejs';

// OrionTV 兼容接口（JSON 非流式）
export async function GET(request: NextRequest) {
  // 檢查是否為本地存儲模式
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const isLocalStorage = storageType === 'localstorage';

  let authInfo = null;
  if (!isLocalStorage) {
    authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const queryForSearch = toSimplified(query || '');
  const resourceId = searchParams.get('resourceId');
  const timeoutParam = searchParams.get('timeout');
  const timeout = timeoutParam ? parseInt(timeoutParam, 10) * 1000 : undefined; // 毫秒

  if (!query || !resourceId) {
    return NextResponse.json(
      { result: null, error: '缺少必要參數: q 或 resourceId' },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    );
  }

  const config = await getConfig();
  const shouldFilterYellow = !canAccessAdultContent(config, authInfo?.username);
  const apiSites = await getAvailableApiSites(authInfo?.username);

  try {
    const targetSite = apiSites.find((site) => site.key === resourceId);
    if (!targetSite) {
      return NextResponse.json(
        {
          error: `未找到指定的視頻源: ${resourceId}`,
          result: null,
        },
        { status: 404, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    // 聚合搜索（使用流式實現做非流式聚合）
    const allResults: SearchResult[] = [];
    for await (const batch of searchFromApiStream(
      targetSite,
      queryForSearch,
      true,
      timeout
    )) {
      allResults.push(...batch);
    }

    // OrionTV 行為：按標題完全匹配過濾
    const cmp = normalizeForCompare(query || '');
    let result = allResults.filter((r) => normalizeForCompare(r.title) === cmp);
    if (shouldFilterYellow) {
      result = result.filter((item) => !isYellowSearchResult(item));
    }

    if (result.length === 0) {
      return NextResponse.json(
        {
          error: '未找到結果',
          result: null,
        },
        { status: 404, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    return NextResponse.json(
      { results: result },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: '搜索失敗',
        result: null,
      },
      { status: 500 }
    );
  }
}
