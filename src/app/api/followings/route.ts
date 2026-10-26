import { NextRequest } from 'next/server';

import { db } from '@/lib/db';
import {
  mutateFromRequest,
  namespaceError,
  namespaceJson,
} from '@/lib/mutation-api';
import { Following } from '@/lib/types';

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
      const snapshot = await db.readNamespace(access.username, 'followings');
      const following = (snapshot.data as Record<string, Following>)[
        `${source}+${id}`
      ];
      return namespaceJson(
        following && access.canView(source, following) ? following : null,
        snapshot.version
      );
    }
    const snapshot = await db.readNamespace(access.username, 'followings');
    const followings = snapshot.data as Record<string, Following>;
    return namespaceJson(
      Object.fromEntries(
        Object.entries(followings).filter(([key, item]) => {
          const parsed = parseFollowingKey(key);
          return parsed && access.canView(parsed[0], item);
        })
      ),
      snapshot.version
    );
  } catch (error) {
    return namespaceError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await getFollowingAccess(request);
    if (!access) return privateJson({ error: 'Unauthorized' }, 401);
    const body = await request.json().catch(() => null);
    const parsed = parseFollowingKey(body?.key);
    if (
      !parsed ||
      !isFollowing(body?.following) ||
      !Number.isFinite(body.following.save_time)
    ) {
      return privateJson({ error: 'Invalid following data' }, 400);
    }
    const [source, id] = parsed;
    const following = body.following;
    if (!access.canView(source, following))
      return privateJson({ error: 'Forbidden' }, 403);
    return await mutateFromRequest(request, access.username, 'followings', {
      action: 'set',
      key: body.key,
      value: {
        ...following,
        source,
        id,
        save_time: following.save_time,
      },
    });
  } catch (error) {
    return namespaceError(error);
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
    }
    return await mutateFromRequest(request, access.username, 'followings', {
      action: key !== null ? 'delete' : 'clear',
      ...(key !== null ? { key } : {}),
    });
  } catch (error) {
    return namespaceError(error);
  }
}
