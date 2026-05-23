import { NextRequest, NextResponse } from 'next/server';
import { inflate } from 'pako';

import type { AdminConfig } from '@/lib/admin.types';
import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { configSelfCheck, setCachedConfig } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';
import type { Favorite, PlayRecord, SkipConfig } from '@/lib/types';

export const runtime = 'nodejs';

// pako 的 gunzip 是同步的，不需要 promisify

export async function POST(req: NextRequest) {
  try {
    // 檢查存儲類型
    const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json(
        { error: '不支持本地存儲進行數據遷移' },
        { status: 400 }
      );
    }

    // 驗證身份和權限
    const authInfo = await getVerifiedAuthInfo(req);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登錄' }, { status: 401 });
    }

    // 檢查用戶權限（只有站長可以導入數據）
    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json(
        { error: '權限不足，只有站長可以導入數據' },
        { status: 401 }
      );
    }

    // 解析表單數據
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const password = formData.get('password') as string;

    if (!file) {
      return NextResponse.json({ error: '請選擇備份文件' }, { status: 400 });
    }

    if (!password) {
      return NextResponse.json({ error: '請提供解密密碼' }, { status: 400 });
    }

    // 讀取文件內容
    const encryptedData = await file.text();

    // 解密數據
    let decryptedData: string;
    try {
      decryptedData = SimpleCrypto.decrypt(encryptedData, password);
    } catch (error) {
      return NextResponse.json(
        { error: '解密失敗，請檢查密碼是否正確' },
        { status: 400 }
      );
    }

    // 解壓縮數據
    const compressedBuffer = Buffer.from(decryptedData, 'base64');
    const decompressedBuffer = inflate(compressedBuffer);
    const decompressedData = new TextDecoder().decode(decompressedBuffer);

    // 解析JSON數據
    let importDataUnknown: unknown;
    try {
      importDataUnknown = JSON.parse(decompressedData);
    } catch (error) {
      return NextResponse.json({ error: '備份文件格式錯誤' }, { status: 400 });
    }

    // 驗證數據格式
    type ImportUserData = {
      password?: string;
      playRecords?: Record<string, PlayRecord>;
      favorites?: Record<string, Favorite>;
      searchHistory?: string[];
      skipConfigs?: Record<string, SkipConfig>;
    };
    const importData = importDataUnknown as {
      data?: {
        adminConfig?: AdminConfig;
        userData?: Record<string, ImportUserData>;
      };
      timestamp?: string;
      serverVersion?: string;
    };
    if (
      !importData.data ||
      !importData.data.adminConfig ||
      !importData.data.userData
    ) {
      return NextResponse.json({ error: '備份文件格式無效' }, { status: 400 });
    }

    // 開始導入數據 - 先清空現有數據
    await db.clearAllData();

    // 導入管理員配置
    importData.data.adminConfig = configSelfCheck(importData.data.adminConfig);
    await db.saveAdminConfig(importData.data.adminConfig);
    await setCachedConfig(importData.data.adminConfig);

    // 導入用戶數據
    const userData = importData.data.userData;
    for (const username in userData) {
      const user = userData[username];

      // 重新註冊用戶（包含密碼）
      if (user.password) {
        await db.registerUser(username, String(user.password));
      }

      // 導入播放記錄
      if (user.playRecords) {
        if (user.playRecords) {
          for (const [key, record] of Object.entries(user.playRecords)) {
            const [source, id] = key.split('+');
            if (source && id) {
              await db.savePlayRecord(
                username,
                source,
                id,
                record as PlayRecord
              );
            }
          }
        }
      }

      // 導入收藏夾
      if (user.favorites) {
        if (user.favorites) {
          for (const [key, favorite] of Object.entries(user.favorites)) {
            const [source, id] = key.split('+');
            if (source && id) {
              await db.saveFavorite(username, source, id, favorite as Favorite);
            }
          }
        }
      }

      // 導入搜索歷史
      if (user.searchHistory && Array.isArray(user.searchHistory)) {
        for (const keyword of user.searchHistory.reverse()) {
          // 反轉以保持順序
          await db.addSearchHistory(username, keyword);
        }
      }

      // 導入跳過片頭片尾配置
      if (user.skipConfigs) {
        for (const [key, skipConfig] of Object.entries(user.skipConfigs)) {
          const [source, id] = key.split('+');
          if (source && id) {
            await db.setSkipConfig(
              username,
              source,
              id,
              skipConfig as SkipConfig
            );
          }
        }
      }
    }

    return NextResponse.json({
      message: '數據導入成功',
      importedUsers: Object.keys(userData).length,
      timestamp: importData.timestamp,
      serverVersion:
        typeof importData.serverVersion === 'string'
          ? importData.serverVersion
          : '未知版本',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '導入失敗' },
      { status: 500 }
    );
  }
}
