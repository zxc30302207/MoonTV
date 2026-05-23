import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { IStorage } from '@/lib/types';

export const runtime = 'nodejs';

type Action =
  | 'create'
  | 'delete'
  | 'rename'
  | 'setSources'
  | 'assignUsers' // 批量分配用戶到某個組
  | 'removeUsers'; // 批量將用戶從其組移除

export async function POST(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '不支持本地存儲進行管理員配置' },
      { status: 400 }
    );
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { action } = body as { action?: Action };

    const authInfo = await getVerifiedAuthInfo(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const adminConfig = await getConfig();
    const storage: IStorage | null = getStorage();

    // 權限與身份校驗：站長或管理員
    if (username !== process.env.USERNAME) {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
        return NextResponse.json({ error: '權限不足' }, { status: 401 });
      }
    }

    if (!action) {
      return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
    }

    // 確保分組數組存在
    if (!adminConfig.UserConfig.Groups) {
      adminConfig.UserConfig.Groups = [];
    }

    switch (action) {
      case 'create': {
        const { name, sourceKeys } = body as {
          name?: string;
          sourceKeys?: string[];
        };
        if (!name)
          return NextResponse.json({ error: '缺少分組名稱' }, { status: 400 });
        if (adminConfig.UserConfig.Groups.some((g) => g.name === name)) {
          return NextResponse.json({ error: '分組已存在' }, { status: 400 });
        }
        adminConfig.UserConfig.Groups.push({
          name,
          sourceKeys: Array.isArray(sourceKeys) ? sourceKeys : [],
        });
        break;
      }
      case 'delete': {
        const { name } = body as { name?: string };
        if (!name)
          return NextResponse.json({ error: '缺少分組名稱' }, { status: 400 });
        const idx = adminConfig.UserConfig.Groups.findIndex(
          (g) => g.name === name
        );
        if (idx === -1)
          return NextResponse.json({ error: '分組不存在' }, { status: 404 });
        adminConfig.UserConfig.Groups.splice(idx, 1);
        // 同步清除用戶上的該組標記
        adminConfig.UserConfig.Users.forEach((u) => {
          if (u.group === name) delete u.group;
        });
        break;
      }
      case 'rename': {
        const { name, newName } = body as { name?: string; newName?: string };
        if (!name || !newName)
          return NextResponse.json({ error: '缺少分組名稱' }, { status: 400 });
        if (adminConfig.UserConfig.Groups.some((g) => g.name === newName)) {
          return NextResponse.json(
            { error: '新分組名已存在' },
            { status: 400 }
          );
        }
        const group = adminConfig.UserConfig.Groups.find(
          (g) => g.name === name
        );
        if (!group)
          return NextResponse.json({ error: '分組不存在' }, { status: 404 });
        group.name = newName;
        // 同步用戶上的分組名
        adminConfig.UserConfig.Users.forEach((u) => {
          if (u.group === name) u.group = newName;
        });
        break;
      }
      case 'setSources': {
        const { name, sourceKeys } = body as {
          name?: string;
          sourceKeys?: string[];
        };
        if (!name || !Array.isArray(sourceKeys)) {
          return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
        }
        const group = adminConfig.UserConfig.Groups.find(
          (g) => g.name === name
        );
        if (!group)
          return NextResponse.json({ error: '分組不存在' }, { status: 404 });
        group.sourceKeys = sourceKeys;
        break;
      }
      case 'assignUsers': {
        const { name, users } = body as { name?: string; users?: string[] };
        if (!name || !Array.isArray(users)) {
          return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
        }
        const group = adminConfig.UserConfig.Groups.find(
          (g) => g.name === name
        );
        if (!group)
          return NextResponse.json({ error: '分組不存在' }, { status: 404 });
        const userSet = new Set(users);
        adminConfig.UserConfig.Users.forEach((u) => {
          if (userSet.has(u.username)) u.group = name;
        });
        break;
      }
      case 'removeUsers': {
        const { users } = body as { users?: string[] };
        if (!Array.isArray(users)) {
          return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
        }
        const userSet = new Set(users);
        adminConfig.UserConfig.Users.forEach((u) => {
          if (userSet.has(u.username)) delete u.group;
        });
        break;
      }
      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    if (storage && typeof storage.setAdminConfig === 'function') {
      await storage.setAdminConfig(adminConfig);
    }
    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json({ error: '分組管理操作失敗' }, { status: 500 });
  }
}
