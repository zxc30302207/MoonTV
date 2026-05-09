import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { IStorage } from '@/lib/types';

export const runtime = 'nodejs';

// 支持的操作類型
type Action =
  | 'add'
  | 'disable'
  | 'enable'
  | 'delete'
  | 'sort'
  | 'batchDisable'
  | 'batchEnable'
  | 'batchDelete';

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

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    // 基礎校驗
    const ACTIONS: Action[] = [
      'add',
      'disable',
      'enable',
      'delete',
      'sort',
      'batchDisable',
      'batchEnable',
      'batchDelete',
    ];
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
        const { key, name, api, detail } = body as {
          key?: string;
          name?: string;
          api?: string;
          detail?: string;
        };
        if (!key || !name || !api) {
          return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
        }
        if (adminConfig.SourceConfig.some((s) => s.key === key)) {
          return NextResponse.json({ error: '該源已存在' }, { status: 400 });
        }
        adminConfig.SourceConfig.push({
          key,
          name,
          api,
          detail,
          from: 'custom',
          disabled: false,
        });
        break;
      }
      case 'disable': {
        const { key } = body as { key?: string };
        if (!key)
          return NextResponse.json({ error: '缺少 key 參數' }, { status: 400 });
        const entry = adminConfig.SourceConfig.find((s) => s.key === key);
        if (!entry)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        entry.disabled = true;
        break;
      }
      case 'enable': {
        const { key } = body as { key?: string };
        if (!key)
          return NextResponse.json({ error: '缺少 key 參數' }, { status: 400 });
        const entry = adminConfig.SourceConfig.find((s) => s.key === key);
        if (!entry)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        entry.disabled = false;
        break;
      }
      case 'delete': {
        const { key } = body as { key?: string };
        if (!key)
          return NextResponse.json({ error: '缺少 key 參數' }, { status: 400 });
        const idx = adminConfig.SourceConfig.findIndex((s) => s.key === key);
        if (idx === -1)
          return NextResponse.json({ error: '源不存在' }, { status: 404 });
        const entry = adminConfig.SourceConfig[idx];
        if (entry.from === 'config') {
          return NextResponse.json({ error: '該源不可刪除' }, { status: 400 });
        }
        adminConfig.SourceConfig.splice(idx, 1);
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
        const map = new Map(adminConfig.SourceConfig.map((s) => [s.key, s]));
        const newList: typeof adminConfig.SourceConfig = [];
        order.forEach((k) => {
          const item = map.get(k);
          if (item) {
            newList.push(item);
            map.delete(k);
          }
        });
        // 未在 order 中的保持原順序
        adminConfig.SourceConfig.forEach((item) => {
          if (map.has(item.key)) newList.push(item);
        });
        adminConfig.SourceConfig = newList;
        break;
      }
      case 'batchDisable': {
        const { keys } = body as { keys?: string[] };
        if (!Array.isArray(keys) || keys.length === 0) {
          return NextResponse.json(
            { error: '缺少 keys 參數或列表為空' },
            { status: 400 }
          );
        }
        keys.forEach((key) => {
          const entry = adminConfig.SourceConfig.find((s) => s.key === key);
          if (entry) {
            entry.disabled = true;
          }
        });
        break;
      }
      case 'batchEnable': {
        const { keys } = body as { keys?: string[] };
        if (!Array.isArray(keys) || keys.length === 0) {
          return NextResponse.json(
            { error: '缺少 keys 參數或列表為空' },
            { status: 400 }
          );
        }
        keys.forEach((key) => {
          const entry = adminConfig.SourceConfig.find((s) => s.key === key);
          if (entry) {
            entry.disabled = false;
          }
        });
        break;
      }
      case 'batchDelete': {
        const { keys } = body as { keys?: string[] };
        if (!Array.isArray(keys) || keys.length === 0) {
          return NextResponse.json(
            { error: '缺少 keys 參數或列表為空' },
            { status: 400 }
          );
        }
        // 只刪除自定義源，系統默認源不可刪除
        keys.forEach((key) => {
          const idx = adminConfig.SourceConfig.findIndex((s) => s.key === key);
          if (idx !== -1) {
            const entry = adminConfig.SourceConfig[idx];
            if (entry.from !== 'config') {
              adminConfig.SourceConfig.splice(idx, 1);
            }
          }
        });
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
        error: '視頻源管理操作失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
