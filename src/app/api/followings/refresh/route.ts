/* eslint-disable no-console */

import { NextRequest } from 'next/server';

import { db } from '@/lib/db';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import { Following } from '@/lib/types';
import { isYellowSearchResult } from '@/lib/yellow';

import {
  getFollowingAccess,
  isFollowing,
  parseFollowingKey,
  PRIVATE_HEADERS,
  privateJson,
} from '../access';

export const runtime = 'nodejs';

interface DetailResult {
  following: Following | null;
  reason?: string;
}

/**
 * POST /api/followings/refresh
 *
 * 批量刷新当前用户所有追更条目的最新集数，采用 SSE 流式返回：
 * 每成功获取一个追更的集数，就立即推送一条 item_result 事件，
 * 客户端可实时更新展示，无需等待全部完成。
 *
 * 请求体（可选）：
 *   { followings?: Record<string, Following> }
 *   - 若传入 followings，则基于传入的数据刷新（key 为 source+id）。
 *   - 若不传，则从数据库读取当前用户全部追更进行刷新。
 *
 * SSE 事件：
 *   data: { "type": "start", "total": number }
 *   data: { "type": "item_result", "key", "source", "id", "title", "total_episodes", "updated" }
 *   data: { "type": "item_failed", "key", "source", "id", "title", "reason" }
 *   data: { "type": "complete", "updatedCount", "failedCount", "successCount" }
 *
 * 说明：
 *   - 使用 fetchVideoDetail 获取集数：内部会先通过流式搜索精确匹配（能拿到集数），
 *     搜索未命中时才回退到 detail 接口，从而解决部分源 detail 拿不到集数的问题。
 *   - 仅在集数真正变化时才写回，避免无意义的写入。
 */
export async function POST(request: NextRequest) {
  try {
    const access = await getFollowingAccess(request);
    if (!access) return privateJson({ error: 'Unauthorized' }, 401);
    const username = access.username;

    // 解析请求体（可选）
    let body: { followings?: Record<string, Following> } = {};
    try {
      body = await request.json();
    } catch {
      // 无 body 时忽略，从数据库读取
    }

    // Server storage is authoritative. A client may select entries but cannot
    // replace their saved progress/metadata with an arbitrary request body.
    const isLocal = process.env.NEXT_PUBLIC_STORAGE_TYPE === 'localstorage';
    const saved = isLocal
      ? body.followings || {}
      : await db.getAllFollowings(username);
    const selected =
      body.followings &&
      typeof body.followings === 'object' &&
      !Array.isArray(body.followings)
        ? new Set(Object.keys(body.followings))
        : null;
    const entries = Object.entries(saved).filter(([key, item]) => {
      const parsed = parseFollowingKey(key);
      return (
        parsed &&
        isFollowing(item) &&
        access.canView(parsed[0], item) &&
        (!selected || selected.has(key))
      );
    });

    // 函数级缓存：key 为 `${source}+${id}`，避免同一详情被重复请求
    const detailCache = new Map<string, Promise<DetailResult>>();

    const getDetail = (
      source: string,
      id: string,
      fallbackTitle: string
    ): Promise<DetailResult> => {
      const cacheKey = `${source}+${id}`;
      let promise = detailCache.get(cacheKey);
      if (!promise) {
        promise = fetchVideoDetail({
          source,
          id,
          username,
          fallbackTitle: fallbackTitle.trim(),
          timeout: 30000,
        })
          .then((detail) => {
            if (!access.allowAdult && isYellowSearchResult(detail)) {
              return { following: null, reason: '內容不可用' };
            }
            const episodeCount = detail.episodes?.length || 0;
            if (episodeCount <= 0) {
              return {
                following: null,
                reason: '接口返回 0 集（可能资源已下架或未收录）',
              };
            }
            return {
              following: {
                title: detail.title || '',
                cover: detail.poster || '',
                source_name: detail.source_name || '',
                year: detail.year || 'unknown',
                total_episodes: episodeCount,
                search_title: detail.title || '',
              } as Following,
            };
          })
          .catch((err) => {
            console.error(`获取视频详情失败 (${source}+${id}):`, err);
            const msg = err instanceof Error ? err.message : String(err || '');
            return {
              following: null,
              reason: msg || '获取详情失败',
            };
          });
        detailCache.set(cacheKey, promise);
      }
      return promise;
    };

    let streamClosed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        const safeEnqueue = (data: Uint8Array): boolean => {
          try {
            if (
              streamClosed ||
              (!controller.desiredSize && controller.desiredSize !== 0)
            ) {
              return false;
            }
            controller.enqueue(data);
            return true;
          } catch (error) {
            // 流已关闭或客户端断开，静默处理，避免 uncaughtException
            streamClosed = true;
            return false;
          }
        };

        const send = (payload: Record<string, unknown>): boolean => {
          const event = `data: ${JSON.stringify(payload)}\n\n`;
          return safeEnqueue(encoder.encode(event));
        };

        // 安全关闭控制器（客户端断开后调用可能抛错，需捕获）
        const safeClose = () => {
          try {
            if (!streamClosed) {
              controller.close();
            }
          } catch {
            // 忽略关闭异常
          }
        };

        try {
          // 发送开始事件
          if (!send({ type: 'start', total: entries.length })) {
            return;
          }

          let updatedCount = 0;
          let failedCount = 0;
          let successCount = 0;

          // 并发处理单个追更条目：获取详情、必要时写回、实时推送结果
          const processEntry = async (key: string, item: Following) => {
            if (streamClosed) return;

            const [source, id] = key.split('+');
            if (!source || !id) {
              console.warn(`跳过无效的追更键: ${key}`);
              failedCount++;
              if (
                !send({
                  type: 'item_failed',
                  key,
                  source,
                  id,
                  title: item.title || '',
                  reason: '无效的追更键',
                })
              ) {
                streamClosed = true;
              }
              return;
            }

            const fallbackTitle = item.search_title || item.title || '';
            if (!fallbackTitle) {
              console.warn(`跳过缺少标题的追更: ${key}`);
              failedCount++;
              if (
                !send({
                  type: 'item_failed',
                  key,
                  source,
                  id,
                  title: item.title || '',
                  reason: '缺少标题',
                })
              ) {
                streamClosed = true;
              }
              return;
            }

            const { following: detail, reason } = await getDetail(
              source,
              id,
              fallbackTitle
            );
            if (streamClosed) return;

            if (!detail) {
              failedCount++;
              if (
                !send({
                  type: 'item_failed',
                  key,
                  source,
                  id,
                  title: item.title || '',
                  reason: reason || '获取集数失败',
                })
              ) {
                streamClosed = true;
              }
              return;
            }

            const episodeCount = detail.total_episodes;
            let updated = false;
            let latest = item;
            let settled = isLocal;
            // Re-read after the slow source request. The conditional UPDATE
            // below also closes the delete/edit race between this read and write.
            for (let attempt = 0; !isLocal && attempt < 3; attempt++) {
              const current = await db.getFollowing(username, source, id);
              if (!current || !access.canView(source, current)) {
                send({ type: 'item_removed', key, source, id });
                return;
              }
              latest = current;
              if (
                episodeCount <= 0 ||
                episodeCount === current.total_episodes
              ) {
                settled = true;
                break;
              }
              const next = {
                ...current,
                title: detail.title || current.title,
                cover: detail.cover || current.cover,
                source_name: detail.source_name || current.source_name,
                year:
                  detail.year && detail.year !== 'unknown'
                    ? detail.year
                    : current.year,
                total_episodes: episodeCount,
                search_title:
                  current.search_title || detail.search_title || current.title,
              };
              if (
                await db.updateFollowingIfUnchanged(
                  username,
                  source,
                  id,
                  current,
                  next
                )
              ) {
                latest = next;
                updated = true;
                settled = true;
                break;
              }
            }
            if (!settled) {
              failedCount++;
              send({
                type: 'item_failed',
                key,
                source,
                id,
                title: latest.title,
                reason: '追更資料已變更，請重試',
              });
              return;
            }
            if (isLocal)
              updated =
                episodeCount > 0 && episodeCount !== item.total_episodes;
            if (updated) updatedCount++;

            successCount++;
            if (
              !send({
                type: 'item_result',
                key,
                source,
                id,
                title: latest.title,
                total_episodes: episodeCount,
                updated,
              })
            ) {
              streamClosed = true;
            }
          };

          // 固定并发数的 worker 池：多个追更同时获取详情，显著缩短整体耗时
          const CONCURRENCY = 5;
          let cursor = 0;
          const workerCount = Math.min(CONCURRENCY, entries.length);
          const workers = Array.from({ length: workerCount }, async () => {
            while (!streamClosed) {
              const idx = cursor++;
              if (idx >= entries.length) break;
              const [key, item] = entries[idx];
              await processEntry(key, item);
            }
          });
          await Promise.all(workers);

          // 发送完成事件
          if (
            send({
              type: 'complete',
              updatedCount,
              failedCount,
              successCount,
              total: entries.length,
            })
          ) {
            safeClose();
          }
        } catch (error) {
          // 处理过程中任何异常都不应导致 uncaughtException
          console.warn('刷新追更流处理异常:', error);
          safeClose();
        }
      },

      cancel() {
        streamClosed = true;
        console.log(
          'Client disconnected, cancelling followings refresh stream'
        );
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        ...PRIVATE_HEADERS,
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error('批量刷新追更失败', err);
    return privateJson({ error: 'Internal Server Error' }, 500);
  }
}
