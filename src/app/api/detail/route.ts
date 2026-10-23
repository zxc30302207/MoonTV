import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { fetchBangumiSubjectDetail } from '@/lib/bangumi';
import { getAvailableApiSites } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import { getDetailFromApi, searchFromApiStream } from '@/lib/downstream';
import { sanitizePlaybackResult } from '@/lib/playback-url';

export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };

/** 完整播放詳情或卡片簡介；所有供應商共用簽名登入與私人快取策略。 */
export async function GET(request: NextRequest) {
  const auth = await getVerifiedAuthInfo(request);
  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers }
    );
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const sourceCode = searchParams.get('source');
  const descOnly = searchParams.get('fields') === 'desc';
  const provider = searchParams.get('provider') || 'vod';
  const title = (searchParams.get('title') || '').trim();

  if (descOnly && (provider === 'douban' || provider === 'bangumi')) {
    if (!id || !/^\d+$/.test(id)) {
      return NextResponse.json(
        { error: '無效的條目 ID' },
        { status: 400, headers }
      );
    }
    try {
      const desc =
        provider === 'bangumi'
          ? (await fetchBangumiSubjectDetail(id)).summary
          : (
              await fetchDoubanData<{ intro?: string }>(
                `https://m.douban.com/rexxar/api/v2/subject/${id}`
              )
            )?.intro;
      return NextResponse.json(
        { desc: typeof desc === 'string' ? desc : '' },
        { headers }
      );
    } catch {
      return NextResponse.json({ desc: '' }, { headers });
    }
  }
  if (provider !== 'vod') {
    return NextResponse.json(
      { error: '無效的供應商' },
      { status: 400, headers }
    );
  }
  if (!id || !sourceCode) {
    return NextResponse.json(
      { error: '缺少必要參數' },
      { status: 400, headers }
    );
  }
  if (!/^[\w-]+$/.test(id)) {
    return NextResponse.json(
      { error: '無效的視頻ID格式' },
      { status: 400, headers }
    );
  }
  try {
    // 包含成人授權、使用者群組、停用來源與已移除來源的篩選。
    const apiSites = await getAvailableApiSites(auth.username);
    const apiSite = apiSites.find((site) => site.key === sourceCode);
    if (!apiSite) {
      return NextResponse.json(
        { error: '無效的API來源' },
        { status: 400, headers }
      );
    }
    if (descOnly) {
      // 卡片請求在瀏覽器端 15 秒逾時；搜尋及回退共用 12 秒總預算。
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
      const deadline = setTimeout(abort, 12000);
      let desc = '';
      try {
        if (title && !controller.signal.aborted) {
          const searchController = new AbortController();
          const abortSearch = () => searchController.abort();
          controller.signal.addEventListener('abort', abortSearch, {
            once: true,
          });
          const searchDeadline = setTimeout(abortSearch, 5000);
          try {
            for await (const batch of searchFromApiStream(
              apiSite,
              title,
              true,
              5000,
              searchController.signal
            )) {
              const match = batch.find((item) => String(item.id) === id);
              if (match?.desc) {
                desc = match.desc;
                break;
              }
            }
          } catch {
            // 搜尋失敗或達到階段預算時回退詳情接口。
          } finally {
            clearTimeout(searchDeadline);
            controller.signal.removeEventListener('abort', abortSearch);
            searchController.abort();
          }
        }
        if (!desc && !controller.signal.aborted) {
          try {
            desc =
              (
                await getDetailFromApi(apiSite, id, {
                  timeout: 7000,
                  signal: controller.signal,
                })
              ).desc || '';
          } catch {
            // 簡介失敗不影響卡片其他功能。
          }
        }
        return NextResponse.json({ desc }, { headers });
      } finally {
        clearTimeout(deadline);
        request.signal.removeEventListener('abort', abort);
        controller.abort();
      }
    }
    const result = sanitizePlaybackResult(await getDetailFromApi(apiSite, id));
    return NextResponse.json(result, { headers });
  } catch {
    return NextResponse.json(
      { error: '獲取詳情失敗' },
      { status: 500, headers }
    );
  }
}
