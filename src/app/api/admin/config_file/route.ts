import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存儲進行管理員配置',
      },
      { status: 400 }
    );
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authInfo.username;

  try {
    // 檢查用戶權限
    const adminConfig = await getConfig();
    const storage = getStorage();

    if (username !== process.env.USERNAME) {
      const user = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json(
          { error: '權限不足，只有管理員可以修改配置文件' },
          { status: 403 }
        );
      }
    }

    // 獲取請求體
    const body = await request.json();
    const { configFile } = body;

    if (!configFile || typeof configFile !== 'string') {
      return NextResponse.json(
        { error: '配置文件內容不能為空' },
        { status: 400 }
      );
    }

    // 驗證 JSON 格式
    try {
      JSON.parse(configFile);
    } catch (e) {
      return NextResponse.json(
        { error: '配置文件格式錯誤，請檢查 JSON 語法' },
        { status: 400 }
      );
    }

    // 創建新的配置對象，避免直接修改原對象
    const updatedConfig = {
      ...adminConfig,
      ConfigFile: configFile,
    };

    // 更新配置文件
    if (storage && typeof storage.setAdminConfig === 'function') {
      await storage.setAdminConfig(updatedConfig);

      return NextResponse.json({
        success: true,
        message: '配置文件更新成功',
      });
    } else {
      return NextResponse.json({ error: '存儲服務不可用' }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: '更新配置文件失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
