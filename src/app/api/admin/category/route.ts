import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { IStorage } from '@/lib/types';

export const runtime = 'nodejs';

// 支持的操作類型
type Action = 'add' | 'disable' | 'enable' | 'delete' | 'sort';

interface BaseBody {
  action?: Action;
}

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
    const body = (await request.json()) as BaseBody & Record<string, unknown>;
    const { action } = body;

    const authInfo = await getVerifiedAuthInfo(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    // 基礎校驗
    const ACTIONS: Action[] = ['add', 'disable', 'enable', 'delete', 'sort'];
    if (!username || !action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
    }

    // 獲取配置與存儲
    const adminConfig = await getConfig();
    const storage: IStorage | null = getStorage();

    // 權限與身份校驗
    if (username !== process.env.USERNAME) {
      const userEntry = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
        return NextResponse.json({ error: '權限不足' }, { status: 401 });
      }
    }

    switch (action) {
      case 'add': {
        const { name, type, query } = body as {
          name?: string;
          type?: 'movie' | 'tv';
          query?: string;
        };
        if (!name || !type || !query) {
          return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
        }
        // 檢查是否已存在相同的查詢和類型組合
        if (
          adminConfig.CustomCategories.some(
            (c) => c.query === query && c.type === type
          )
        ) {
          return NextResponse.json({ error: '該分類已存在' }, { status: 400 });
        }
        adminConfig.CustomCategories.push({
          name,
          type,
          query,
          from: 'custom',
          disabled: false,
        });
        break;
      }
      case 'disable': {
        const { query, type } = body as {
          query?: string;
          type?: 'movie' | 'tv';
        };
        if (!query || !type)
          return NextResponse.json(
            { error: '缺少 query 或 type 參數' },
            { status: 400 }
          );
        const entry = adminConfig.CustomCategories.find(
          (c) => c.query === query && c.type === type
        );
        if (!entry)
          return NextResponse.json({ error: '分類不存在' }, { status: 404 });
        entry.disabled = true;
        break;
      }
      case 'enable': {
        const { query, type } = body as {
          query?: string;
          type?: 'movie' | 'tv';
        };
        if (!query || !type)
          return NextResponse.json(
            { error: '缺少 query 或 type 參數' },
            { status: 400 }
          );
        const entry = adminConfig.CustomCategories.find(
          (c) => c.query === query && c.type === type
        );
        if (!entry)
          return NextResponse.json({ error: '分類不存在' }, { status: 404 });
        entry.disabled = false;
        break;
      }
      case 'delete': {
        const { query, type } = body as {
          query?: string;
          type?: 'movie' | 'tv';
        };
        if (!query || !type)
          return NextResponse.json(
            { error: '缺少 query 或 type 參數' },
            { status: 400 }
          );
        const idx = adminConfig.CustomCategories.findIndex(
          (c) => c.query === query && c.type === type
        );
        if (idx === -1)
          return NextResponse.json({ error: '分類不存在' }, { status: 404 });
        const entry = adminConfig.CustomCategories[idx];
        if (entry.from === 'config') {
          return NextResponse.json(
            { error: '該分類不可刪除' },
            { status: 400 }
          );
        }
        adminConfig.CustomCategories.splice(idx, 1);
        break;
      }
      case 'sort': {
        const { order } = body as { order?: string[] };
        if (!Array.isArray(order)) {
          return NextResponse.json(
            { error: '排序列表格式錯誤' },
            { status: 400 }
          );
        }
        const map = new Map(
          adminConfig.CustomCategories.map((c) => [`${c.query}:${c.type}`, c])
        );
        const newList: typeof adminConfig.CustomCategories = [];
        order.forEach((key) => {
          const item = map.get(key);
          if (item) {
            newList.push(item);
            map.delete(key);
          }
        });
        // 未在 order 中的保持原順序
        adminConfig.CustomCategories.forEach((item) => {
          if (map.has(`${item.query}:${item.type}`)) newList.push(item);
        });
        adminConfig.CustomCategories = newList;
        break;
      }
      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    // 持久化到存儲
    if (storage && typeof storage.setAdminConfig === 'function') {
      await storage.setAdminConfig(adminConfig);
    }

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: '分類管理操作失敗',
      },
      { status: 500 }
    );
  }
}
