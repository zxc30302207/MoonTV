import { NextRequest } from 'next/server';

import { db } from '@/lib/db';

import {
  getFollowingAccess,
  isFollowing,
  parseFollowingKey,
  privateJson,
} from './access';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const access = await getFollowingAccess(request);
    if (!access) return privateJson({ error: 'Unauthorized' }, 401);
    const key = request.nextUrl.searchParams.get('key');
    if (key !== null) {
      const parsed = parseFollowingKey(key);
      if (!parsed) return privateJson({ error: 'Invalid key format' }, 400);
      const [source, id] = parsed;
      const following = await db.getFollowing(access.username, source, id);
      return privateJson(
        following && access.canView(source, following) ? following : null
      );
    }
    const followings = await db.getAllFollowings(access.username);
    return privateJson(
      Object.fromEntries(
        Object.entries(followings).filter(([key, item]) => {
          const parsed = parseFollowingKey(key);
          return parsed && access.canView(parsed[0], item);
        })
      )
    );
  } catch {
    return privateJson({ error: 'Internal Server Error' }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await getFollowingAccess(request);
    if (!access) return privateJson({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => null);
    const parsed = parseFollowingKey(body?.key);
    if (!parsed || !isFollowing(body?.following)) {
      return privateJson({ error: 'Invalid following data' }, 400);
    }
    const [source, id] = parsed;
    const following = body.following;
    if (!access.canView(source, following))
      return privateJson({ error: 'Forbidden' }, 403);
    await db.saveFollowing(access.username, source, id, {
      ...following,
      source,
      id,
      save_time: following.save_time ?? Date.now(),
    });
    return privateJson({ success: true });
  } catch {
    return privateJson({ error: 'Internal Server Error' }, 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const access = await getFollowingAccess(request);
    if (!access) return privateJson({ error: 'Unauthorized' }, 401);
    const key = request.nextUrl.searchParams.get('key');
    if (key !== null) {
      const parsed = parseFollowingKey(key);
      if (!parsed) return privateJson({ error: 'Invalid key format' }, 400);
      await db.deleteFollowing(access.username, ...parsed);
    } else {
      const followings = await db.getAllFollowings(access.username);
      await Promise.all(
        Object.keys(followings).map(async (entry) => {
          const parsed = parseFollowingKey(entry);
          if (parsed) await db.deleteFollowing(access.username, ...parsed);
        })
      );
    }
    return privateJson({ success: true });
  } catch {
    return privateJson({ error: 'Internal Server Error' }, 500);
  }
}
