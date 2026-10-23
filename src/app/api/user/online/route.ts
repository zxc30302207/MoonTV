/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { ok: false, reason: 'localstorage 模式不支持管理員配置寫入' },
      { status: 400 }
    );
  }

  try {
    const auth = await getVerifiedAuthInfo(request);
    if (!auth?.username) {
      return NextResponse.json({ error: '未登錄' }, { status: 401 });
    }

    const username = auth.username;
    const adminConfig = await getConfig();

    const userEntry = adminConfig.UserConfig.Users.find(
      (u) => u.username === username
    );
    if (!userEntry) {
      return NextResponse.json({ error: '用戶不存在' }, { status: 404 });
    }
    if (userEntry.banned) {
      return NextResponse.json({ error: '用戶已被封禁' }, { status: 401 });
    }

    const lastOnline = Date.now();
    const storage = getStorage();
    if (!storage) throw new Error('Storage unavailable');
    if (!(await storage.updateUserLastOnline(username, lastOnline))) {
      return NextResponse.json(
        { error: '用戶已停用或不存在' },
        { status: 401 }
      );
    }
    // Keep the Docker in-process view fresh only after the atomic write.
    userEntry.lastOnline = Math.max(userEntry.lastOnline || 0, lastOnline);

    return NextResponse.json(
      { ok: true, lastOnline: userEntry.lastOnline },
      { status: 200 }
    );
  } catch (error) {
    console.error('更新用戶上線時間失敗:', error);
    return NextResponse.json(
      { error: '更新用戶上線時間失敗' },
      { status: 500 }
    );
  }
}
