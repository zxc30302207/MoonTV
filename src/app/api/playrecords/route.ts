import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  mutateFromRequest,
  namespaceError,
  namespaceJson,
} from '@/lib/mutation-api';
import { PlayRecord } from '@/lib/types';

import {
  playRecordSchema,
  storageKeySchema,
} from '@/app/api/admin/data_migration/validation';

export const runtime = 'nodejs';

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

    const snapshot = await db.readNamespace(authInfo.username, 'pr');
    return namespaceJson(snapshot.data, snapshot.version);
  } catch (err) {
    return namespaceError(err);
  }
}

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
    const { key, record }: { key: string; record: PlayRecord } = body;

    if (!storageKeySchema.safeParse(key).success || !record) {
      return NextResponse.json(
        { error: 'Missing key or record' },
        { status: 400 }
      );
    }

    // 驗證播放記錄數據
    if (
      !playRecordSchema.safeParse({
        ...record,
        save_time: record.save_time,
      }).success ||
      record.index < 1 ||
      !Number.isInteger(record.index)
    ) {
      return NextResponse.json(
        { error: 'Invalid record data' },
        { status: 400 }
      );
    }

    // 從key中解析source和id
    const [source, id] = key.split('+');
    if (!source || !id || key.split('+').length !== 2) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 }
      );
    }

    const finalRecord = {
      ...record,
      save_time: record.save_time,
    } as PlayRecord;

    return await mutateFromRequest(request, authInfo.username, 'pr', {
      action: 'set',
      key,
      value: finalRecord,
    });
  } catch (err) {
    return namespaceError(err);
  }
}

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

    const username = authInfo.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key !== null) {
      // 如果提供了 key，刪除單條播放記錄
      const [source, id] = key.split('+');
      if (!source || !id || key.split('+').length !== 2) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }
    }
    return await mutateFromRequest(request, username, 'pr', {
      action: key !== null ? 'delete' : 'clear',
      ...(key !== null ? { key } : {}),
    });
  } catch (err) {
    return namespaceError(err);
  }
}
