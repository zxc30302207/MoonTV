import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  mutateFromRequest,
  namespaceError,
  namespaceJson,
} from '@/lib/mutation-api';

export const runtime = 'nodejs';

/**
 * GET /api/searchhistory
 * 返回 string[]
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

    const snapshot = await db.readNamespace(authInfo.username, 'sh');
    return namespaceJson(snapshot.data, snapshot.version);
  } catch (err) {
    return namespaceError(err);
  }
}

/**
 * POST /api/searchhistory
 * body: { keyword: string }
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
    const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';

    if (!keyword || keyword.length > 1024) {
      return NextResponse.json(
        { error: 'Keyword is required' },
        { status: 400 }
      );
    }

    return await mutateFromRequest(request, authInfo.username, 'sh', {
      action: 'add',
      key: keyword,
    });
  } catch (err) {
    return namespaceError(err);
  }
}

/**
 * DELETE /api/searchhistory?keyword=<kw>
 *
 * 1. 不帶 keyword -> 清空全部搜索歷史
 * 2. 帶 keyword=<kw> -> 刪除單條關鍵字
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

    const { searchParams } = new URL(request.url);
    const kw = searchParams.get('keyword')?.trim();

    if (searchParams.has('keyword') && (!kw || kw.length > 1024))
      return namespaceJson({ error: 'Invalid keyword' }, undefined, 400);
    return await mutateFromRequest(request, authInfo.username, 'sh', {
      action: kw ? 'delete' : 'clear',
      ...(kw ? { key: kw } : {}),
    });
  } catch (err) {
    return namespaceError(err);
  }
}
