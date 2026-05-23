import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { db, getStorage } from '@/lib/db';
import { IStorage } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  // 不支持 localstorage 模式
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存儲模式修改密碼',
      },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    // 獲取認證信息
    const authInfo = await getVerifiedAuthInfo(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 驗證新密碼
    if (!newPassword || typeof newPassword !== 'string') {
      return NextResponse.json({ error: '新密碼不得為空' }, { status: 400 });
    }
    if (!currentPassword || typeof currentPassword !== 'string') {
      return NextResponse.json({ error: '請輸入目前密碼' }, { status: 400 });
    }

    const username = authInfo.username;

    // 不允許站長修改密碼（站長用戶名等於 process.env.USERNAME）
    if (username === process.env.USERNAME) {
      return NextResponse.json(
        { error: '站長不能通過此接口修改密碼' },
        { status: 403 }
      );
    }

    const verifiedCurrentPassword = await db.verifyUser(
      username,
      currentPassword
    );
    if (!verifiedCurrentPassword) {
      return NextResponse.json({ error: '目前密碼錯誤' }, { status: 401 });
    }

    // 獲取存儲實例
    const storage: IStorage | null = getStorage();
    if (!storage || typeof storage.changePassword !== 'function') {
      return NextResponse.json(
        { error: '存儲服務不支持修改密碼' },
        { status: 500 }
      );
    }

    // 修改密碼
    await storage.changePassword(username, newPassword);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: '修改密碼失敗',
      },
      { status: 500 }
    );
  }
}
