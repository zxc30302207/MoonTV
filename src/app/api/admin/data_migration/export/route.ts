import { NextRequest, NextResponse } from 'next/server';
import { deflate } from 'pako';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';
import { hashPassword, isPasswordHash } from '@/lib/password';
import { CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

// pako 的 gzip 是同步的，不需要 promisify

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

    // 檢查用戶權限（只有站長可以導出數據）
    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json(
        { error: '權限不足，只有站長可以導出數據' },
        { status: 401 }
      );
    }

    const config = await db.getAdminConfig();
    if (!config) {
      return NextResponse.json({ error: '無法獲取配置' }, { status: 500 });
    }

    // 解析請求體獲取密碼
    const { password } = await req.json();
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '請提供加密密碼' }, { status: 400 });
    }

    // 收集所有數據
    const exportData = {
      timestamp: new Date().toISOString(),
      serverVersion: CURRENT_VERSION,
      data: {
        // 管理員配置
        adminConfig: config,
        // 所有用戶數據
        userData: {} as Record<string, unknown>,
      },
    };

    // 獲取所有用戶
    let allUsers = await db.getAllUsers();
    // 添加站長用戶
    allUsers.push(process.env.USERNAME);
    allUsers = Array.from(new Set(allUsers));

    // 為每個用戶收集數據
    for (const username of allUsers) {
      const userData = {
        // 播放記錄
        playRecords: await db.getAllPlayRecords(username),
        // 收藏夾
        favorites: await db.getAllFavorites(username),
        // 搜索歷史
        searchHistory: await db.getSearchHistory(username),
        // 跳過片頭片尾配置
        skipConfigs: await db.getAllSkipConfigs(username),
        // 用戶密碼（通過驗證空密碼來檢查用戶是否存在，然後獲取密碼）
        password: await getUserPassword(username),
      };

      exportData.data.userData[username] = userData;
    }

    // 覆蓋站長密碼
    const ownerKey = process.env.USERNAME as string;
    const ownerData = exportData.data.userData[ownerKey] as Record<
      string,
      unknown
    >;
    if (process.env.PASSWORD) {
      const ownerPassword = process.env.PASSWORD;
      (ownerData as { password?: string }).password = isPasswordHash(
        ownerPassword
      )
        ? ownerPassword
        : await hashPassword(ownerPassword);
    }

    // 將數據轉換為JSON字符串
    const jsonData = JSON.stringify(exportData);

    // 先壓縮數據
    const compressedData = deflate(jsonData);

    // 使用提供的密碼加密壓縮後的數據
    const compressedBase64 = Buffer.from(compressedData).toString('base64');
    const encryptedData = SimpleCrypto.encrypt(compressedBase64, password);

    // 生成文件名
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(
      now.getMonth() + 1
    ).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(
      now.getHours()
    ).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
      now.getSeconds()
    ).padStart(2, '0')}`;
    const filename = `moontv-backup-${timestamp}.dat`;

    // 返回加密的數據作為文件下載
    return new NextResponse(encryptedData, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': encryptedData.length.toString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '導出失敗' },
      { status: 500 }
    );
  }
}

// 輔助函數：獲取用戶密碼（通過數據庫直接訪問）
async function getUserPassword(username: string): Promise<string | null> {
  try {
    const password = await db.getUserPassword(username);
    if (!password) return null;
    return isPasswordHash(password) ? password : await hashPassword(password);
  } catch {
    return null;
  }
}
