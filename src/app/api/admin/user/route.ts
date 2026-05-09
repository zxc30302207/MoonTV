import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { IStorage } from '@/lib/types';

export const runtime = 'nodejs';

// 支持的操作類型
const ACTIONS = [
  'add',
  'ban',
  'unban',
  'setAdmin',
  'cancelAdmin',
  'setAllowRegister',
  'changePassword',
  'deleteUser',
] as const;

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

  try {
    const body = await request.json();

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const {
      targetUsername, // 目標用戶名
      targetPassword, // 目標用戶密碼（僅在添加用戶時需要）
      allowRegister,
      action,
    } = body as {
      targetUsername?: string;
      targetPassword?: string;
      allowRegister?: boolean;
      action?: (typeof ACTIONS)[number];
    };

    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
    }

    if (action !== 'setAllowRegister' && !targetUsername) {
      return NextResponse.json({ error: '缺少目標用戶名' }, { status: 400 });
    }

    if (
      action !== 'setAllowRegister' &&
      action !== 'changePassword' &&
      action !== 'deleteUser' &&
      username === targetUsername
    ) {
      return NextResponse.json(
        { error: '無法對自己進行此操作' },
        { status: 400 }
      );
    }

    // 獲取配置與存儲
    const adminConfig = await getConfig();
    const storage: IStorage | null = getStorage();

    // 判定操作者角色
    let operatorRole: 'owner' | 'admin';
    if (username === process.env.USERNAME) {
      operatorRole = 'owner';
    } else {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
        return NextResponse.json({ error: '權限不足' }, { status: 401 });
      }
      operatorRole = 'admin';
    }

    // 查找目標用戶條目
    let targetEntry = adminConfig.UserConfig.Users.find(
      (u) => u.username === targetUsername
    );

    if (
      targetEntry &&
      targetEntry.role === 'owner' &&
      action !== 'changePassword'
    ) {
      return NextResponse.json({ error: '無法操作站長' }, { status: 400 });
    }

    // 權限校驗邏輯
    const isTargetAdmin = targetEntry?.role === 'admin';

    if (action === 'setAllowRegister') {
      if (typeof allowRegister !== 'boolean') {
        return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
      }
      adminConfig.UserConfig.AllowRegister = allowRegister;
      // 保存後直接返回成功（走後面的統一保存邏輯）
    } else {
      switch (action) {
        case 'add': {
          if (targetEntry) {
            return NextResponse.json({ error: '用戶已存在' }, { status: 400 });
          }
          if (!targetPassword) {
            return NextResponse.json(
              { error: '缺少目標用戶密碼' },
              { status: 400 }
            );
          }
          if (!storage || typeof storage.registerUser !== 'function') {
            return NextResponse.json(
              { error: '存儲未配置用戶註冊' },
              { status: 500 }
            );
          }
          await storage.registerUser(targetUsername as string, targetPassword);
          // 更新配置
          adminConfig.UserConfig.Users.push({
            username: targetUsername as string,
            role: 'user',
          });
          targetEntry =
            adminConfig.UserConfig.Users[
              adminConfig.UserConfig.Users.length - 1
            ];
          break;
        }
        case 'ban': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目標用戶不存在' },
              { status: 404 }
            );
          }
          if (isTargetAdmin) {
            // 目標是管理員
            if (operatorRole !== 'owner') {
              return NextResponse.json(
                { error: '僅站長可封禁管理員' },
                { status: 401 }
              );
            }
          }
          targetEntry.banned = true;
          break;
        }
        case 'unban': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目標用戶不存在' },
              { status: 404 }
            );
          }
          if (isTargetAdmin) {
            if (operatorRole !== 'owner') {
              return NextResponse.json(
                { error: '僅站長可操作管理員' },
                { status: 401 }
              );
            }
          }
          targetEntry.banned = false;
          break;
        }
        case 'setAdmin': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目標用戶不存在' },
              { status: 404 }
            );
          }
          if (targetEntry.role === 'admin') {
            return NextResponse.json(
              { error: '該用戶已是管理員' },
              { status: 400 }
            );
          }
          if (operatorRole !== 'owner') {
            return NextResponse.json(
              { error: '僅站長可設置管理員' },
              { status: 401 }
            );
          }
          targetEntry.role = 'admin';
          break;
        }
        case 'cancelAdmin': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目標用戶不存在' },
              { status: 404 }
            );
          }
          if (targetEntry.role !== 'admin') {
            return NextResponse.json(
              { error: '目標用戶不是管理員' },
              { status: 400 }
            );
          }
          if (operatorRole !== 'owner') {
            return NextResponse.json(
              { error: '僅站長可取消管理員' },
              { status: 401 }
            );
          }
          targetEntry.role = 'user';
          break;
        }
        case 'changePassword': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目標用戶不存在' },
              { status: 404 }
            );
          }
          if (!targetPassword) {
            return NextResponse.json({ error: '缺少新密碼' }, { status: 400 });
          }

          // 權限檢查：不允許修改站長密碼
          if (targetEntry.role === 'owner') {
            return NextResponse.json(
              { error: '無法修改站長密碼' },
              { status: 401 }
            );
          }

          if (
            isTargetAdmin &&
            operatorRole !== 'owner' &&
            username !== targetUsername
          ) {
            return NextResponse.json(
              { error: '僅站長可修改其他管理員密碼' },
              { status: 401 }
            );
          }

          if (!storage || typeof storage.changePassword !== 'function') {
            return NextResponse.json(
              { error: '存儲未配置密碼修改功能' },
              { status: 500 }
            );
          }

          await storage.changePassword(
            targetUsername as string,
            targetPassword
          );
          break;
        }
        case 'deleteUser': {
          if (!targetEntry) {
            return NextResponse.json(
              { error: '目標用戶不存在' },
              { status: 404 }
            );
          }

          // 權限檢查：站長可刪除所有用戶（除了自己），管理員可刪除普通用戶
          if (username === targetUsername) {
            return NextResponse.json(
              { error: '不能刪除自己' },
              { status: 400 }
            );
          }

          if (isTargetAdmin && operatorRole !== 'owner') {
            return NextResponse.json(
              { error: '僅站長可刪除管理員' },
              { status: 401 }
            );
          }

          if (!storage || typeof storage.deleteUser !== 'function') {
            return NextResponse.json(
              { error: '存儲未配置用戶刪除功能' },
              { status: 500 }
            );
          }

          await storage.deleteUser(targetUsername as string);

          // 從配置中移除用戶
          const userIndex = adminConfig.UserConfig.Users.findIndex(
            (u) => u.username === targetUsername
          );
          if (userIndex > -1) {
            adminConfig.UserConfig.Users.splice(userIndex, 1);
          }

          break;
        }
        default:
          return NextResponse.json({ error: '未知操作' }, { status: 400 });
      }
    }

    // 將更新後的配置寫入數據庫
    if (storage && typeof storage.setAdminConfig === 'function') {
      await storage.setAdminConfig(adminConfig);
    }

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 管理員配置不緩存
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: '用戶管理操作失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
