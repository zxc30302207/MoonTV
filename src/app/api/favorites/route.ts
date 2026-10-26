import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  mutateFromRequest,
  namespaceError,
  namespaceJson,
} from '@/lib/mutation-api';
import { Favorite } from '@/lib/types';

import {
  mediaSchema,
  storageKeySchema,
} from '@/app/api/admin/data_migration/validation';

export const runtime = 'nodejs';

/**
 * GET /api/favorites
 *
 * 支持兩種調用方式：
 * 1. 不帶 query，返回全部收藏列表（Record<string, Favorite>）。
 * 2. 帶 key=source+id，返回單條收藏（Favorite | null）。
 */
export async function GET(request: NextRequest) {
  try {
    // 從 cookie 獲取用戶信息
    const authInfo = await getVerifiedAuthInfo(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await getConfig();
    if (config.UserConfig.Users) {
      // 檢查用戶是否被封禁
      const user = config.UserConfig.Users.find(
        (u) => u.username === authInfo.username
      );
      if (user && user.banned) {
        return NextResponse.json({ error: '用戶已被封禁' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    // 查詢單條收藏
    if (key !== null) {
      const [source, id] = key.split('+');
      if (!source || !id || key.split('+').length !== 2) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }
      const snapshot = await db.readNamespace(authInfo.username, 'fav');
      return namespaceJson(
        (snapshot.data as Record<string, Favorite>)[key] ?? null,
        snapshot.version
      );
    }

    // 查詢全部收藏
    const snapshot = await db.readNamespace(authInfo.username, 'fav');
    return namespaceJson(snapshot.data, snapshot.version);
  } catch (err) {
    return namespaceError(err);
  }
}

/**
 * POST /api/favorites
 * body: { key: string; favorite: Favorite }
 */
export async function POST(request: NextRequest) {
  try {
    // 從 cookie 獲取用戶信息
    const authInfo = await getVerifiedAuthInfo(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await getConfig();
    if (config.UserConfig.Users) {
      // 檢查用戶是否被封禁
      const user = config.UserConfig.Users.find(
        (u) => u.username === authInfo.username
      );
      if (user && user.banned) {
        return NextResponse.json({ error: '用戶已被封禁' }, { status: 401 });
      }
    }

    const body = await request.json();
    const { key, favorite }: { key: string; favorite: Favorite } = body;

    if (!storageKeySchema.safeParse(key).success || !favorite) {
      return NextResponse.json(
        { error: 'Missing key or favorite' },
        { status: 400 }
      );
    }

    // 驗證必要字段
    if (
      !favorite.title ||
      !favorite.source_name ||
      !mediaSchema.safeParse({
        ...favorite,
        save_time: favorite.save_time,
      }).success
    ) {
      return NextResponse.json(
        { error: 'Invalid favorite data' },
        { status: 400 }
      );
    }

    const [source, id] = key.split('+');
    if (!source || !id || key.split('+').length !== 2) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 }
      );
    }

    const finalFavorite = {
      ...favorite,
      save_time: favorite.save_time,
    } as Favorite;

    return await mutateFromRequest(request, authInfo.username, 'fav', {
      action: 'set',
      key,
      value: finalFavorite,
    });
  } catch (err) {
    return namespaceError(err);
  }
}

/**
 * DELETE /api/favorites
 *
 * 1. 不帶 query -> 清空全部收藏
 * 2. 帶 key=source+id -> 刪除單條收藏
 */
export async function DELETE(request: NextRequest) {
  try {
    // 從 cookie 獲取用戶信息
    const authInfo = await getVerifiedAuthInfo(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await getConfig();
    if (config.UserConfig.Users) {
      // 檢查用戶是否被封禁
      const user = config.UserConfig.Users.find(
        (u) => u.username === authInfo.username
      );
      if (user && user.banned) {
        return NextResponse.json({ error: '用戶已被封禁' }, { status: 401 });
      }
    }

    const username = authInfo.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key !== null) {
      // 刪除單條
      const [source, id] = key.split('+');
      if (!source || !id || key.split('+').length !== 2) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }
    }
    return await mutateFromRequest(request, username, 'fav', {
      action: key !== null ? 'delete' : 'clear',
      ...(key !== null ? { key } : {}),
    });
  } catch (err) {
    return namespaceError(err);
  }
}
