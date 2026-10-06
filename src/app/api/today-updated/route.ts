import { NextRequest } from 'next/server';

import { db } from '@/lib/db';
import { TodayUpdatedItem, TodayUpdatedRecord } from '@/lib/types';

import {
  getFollowingAccess,
  parseFollowingKey,
  privateJson,
} from '../followings/access';

export const runtime = 'nodejs';

function validateRecord(body: unknown): TodayUpdatedRecord | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as TodayUpdatedRecord;
  if (
    typeof record.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(record.date) ||
    !Array.isArray(record.items)
  )
    return null;
  if (record.items.length > 10000) return null;
  const strings: Array<keyof TodayUpdatedItem> = [
    'source',
    'id',
    'title',
    'poster',
    'source_name',
    'year',
  ];
  const numbers: Array<keyof TodayUpdatedItem> = [
    'episodes',
    'watchedEpisodes',
    'unwatchedEpisodes',
    'save_time',
    'oldEpisodes',
    'newEpisodes',
  ];
  if (
    !record.items.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        strings.every((key) => typeof item[key] === 'string') &&
        numbers.every(
          (key) =>
            typeof item[key] === 'number' &&
            Number.isFinite(item[key]) &&
            Number(item[key]) >= 0
        ) &&
        parseFollowingKey(`${item.source}+${item.id}`)
    )
  )
    return null;
  return record;
}

export async function GET(request: NextRequest) {
  try {
    const access = await getFollowingAccess(request);
    if (!access) return privateJson({ error: 'Unauthorized' }, 401);
    const record = await db.getTodayUpdated(access.username);
    return privateJson(
      record
        ? {
            ...record,
            items: record.items.filter((item) =>
              access.canView(item.source, item)
            ),
          }
        : null
    );
  } catch {
    return privateJson({ error: '獲取今日新更失敗' }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await getFollowingAccess(request);
    if (!access) return privateJson({ error: 'Unauthorized' }, 401);
    const record = validateRecord(await request.json().catch(() => null));
    if (!record) return privateJson({ error: '無效的記錄格式' }, 400);
    if (!record.items.every((item) => access.canView(item.source, item))) {
      return privateJson({ error: 'Forbidden' }, 403);
    }
    await db.setTodayUpdated(access.username, record);
    return privateJson({ success: true });
  } catch {
    return privateJson({ error: '保存今日新更失敗' }, 500);
  }
}
