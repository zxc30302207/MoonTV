import { NextRequest, NextResponse } from 'next/server';

import { db, getStorage } from '@/lib/db';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import { SearchResult } from '@/lib/types';

export async function handleCronRequest(
  request: NextRequest,
  pathToken?: string
): Promise<NextResponse> {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json(
        {
          success: false,
          message: 'Cron secret 未配置',
        },
        { status: 403 }
      );
    }

    const authHeader = request.headers.get('authorization') || '';
    const headerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : '';
    const token =
      pathToken || headerToken || request.nextUrl.searchParams.get('token');
    if (!token || token !== secret) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    const release =
      storageType === 'localstorage'
        ? async () => undefined
        : await getStorage().acquireLease('refresh-records', 60000);
    if (!release)
      return NextResponse.json(
        { success: false, message: 'Cron job already running' },
        { status: 409 }
      );
    let result;
    try {
      result = await refreshRecordAndFavorites();
    } finally {
      await release();
    }

    return NextResponse.json({
      success: true,
      message: 'Cron job completed',
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: 'Cron job failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

async function refreshRecordAndFavorites() {
  if (
    (process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage'
  ) {
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;
  const deadline = Date.now() + 45000;
  try {
    const users = await db.getAllUsers();
    if (process.env.USERNAME && !users.includes(process.env.USERNAME)) {
      users.push(process.env.USERNAME);
    }
    // 函數級緩存：key 為 `${source}+${id}`，值為 Promise<VideoDetail | null>
    const detailCache = new Map<string, Promise<SearchResult | null>>();

    // 獲取詳情 Promise（帶緩存和錯誤處理）
    const getDetail = async (
      source: string,
      id: string,
      fallbackTitle: string
    ): Promise<SearchResult | null> => {
      if (Date.now() >= deadline)
        throw new Error('Cron job deadline exceeded; retry remaining work');
      const key = `${source}+${id}`;
      let promise = detailCache.get(key);
      if (!promise) {
        promise = fetchVideoDetail({
          source,
          id,
          fallbackTitle: fallbackTitle.trim(),
          timeout: Math.min(15000, Math.max(1, deadline - Date.now())), // Bounded by the remaining job window
        })
          .then((detail) => {
            // 成功時才緩存結果
            const successPromise = Promise.resolve(detail);
            detailCache.set(key, successPromise);
            return detail;
          })
          .catch(() => {
            failed += 1;
            return null;
          });
      }
      detailCache.set(key, promise);
      return promise;
    };

    for (const user of users) {
      if (Date.now() >= deadline) throw new Error('Cron job deadline exceeded');
      // 播放記錄
      try {
        const playRecords = await db.getAllPlayRecords(user);

        for (const [key, record] of Object.entries(playRecords)) {
          try {
            if (Date.now() >= deadline)
              throw new Error('Cron job deadline exceeded');
            processed += 1;
            const [source, id] = key.split('+');
            if (!source || !id) {
              continue;
            }

            const detail = await getDetail(source, id, record.title);
            if (!detail) {
              continue;
            }

            const episodeCount = detail.episodes?.length || 0;
            if (episodeCount > 0 && episodeCount !== record.total_episodes) {
              await getStorage().updatePlayRecordIfUnchanged(
                user,
                key,
                record,
                {
                  title: detail.title || record.title,
                  source_name: record.source_name,
                  cover: detail.poster || record.cover,
                  index: record.index,
                  total_episodes: episodeCount,
                  play_time: record.play_time,
                  year: detail.year || record.year,
                  total_time: record.total_time,
                  save_time: record.save_time,
                  search_title: record.search_title,
                }
              );
            }
          } catch {
            failed += 1;
            // 繼續處理下一個記錄
          }
        }
      } catch {
        failed += 1;
      }

      // 收藏
      try {
        const favorites = await db.getAllFavorites(user);

        for (const [key, fav] of Object.entries(favorites)) {
          try {
            if (Date.now() >= deadline)
              throw new Error('Cron job deadline exceeded');
            processed += 1;
            const [source, id] = key.split('+');
            if (!source || !id) {
              continue;
            }

            const favDetail = await getDetail(source, id, fav.title);
            if (!favDetail) {
              continue;
            }

            const favEpisodeCount = favDetail.episodes?.length || 0;
            if (favEpisodeCount > 0 && favEpisodeCount !== fav.total_episodes) {
              await getStorage().updateFavoriteIfUnchanged(user, key, fav, {
                title: favDetail.title || fav.title,
                source_name: fav.source_name,
                cover: favDetail.poster || fav.cover,
                year: favDetail.year || fav.year,
                total_episodes: favEpisodeCount,
                save_time: fav.save_time,
                search_title: fav.search_title,
              });
            }
          } catch {
            failed += 1;
            // 繼續處理下一個收藏
          }
        }
      } catch {
        failed += 1;
      }
    }
  } catch {
    failed += 1;
  }
  if (failed)
    throw new Error(
      `Cron job incomplete: processed=${processed}, failed=${failed}`
    );
  return { processed, failed };
}
