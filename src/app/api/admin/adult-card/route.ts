import { NextRequest, NextResponse } from 'next/server';

import {
  createAdultAuthCard,
  deleteAdultAuthCard,
  isAdminUser,
  isAdultAuthDuration,
  setAdultAuthCardDisabled,
} from '@/lib/adult-authorization';
import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';

export const runtime = 'nodejs';

const ACTIONS = ['create', 'disable', 'enable', 'delete'] as const;

export async function POST(request: NextRequest) {
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: (typeof ACTIONS)[number];
    duration?: string;
    code?: string;
  };

  if (!body.action || !ACTIONS.includes(body.action)) {
    return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
  }

  const config = await getConfig();
  if (!isAdminUser(config, authInfo.username)) {
    return NextResponse.json({ error: '權限不足' }, { status: 401 });
  }

  const storage = getStorage();
  if (!storage || typeof storage.setAdminConfig !== 'function') {
    return NextResponse.json(
      { error: '目前儲存後端不支援成人授權卡管理' },
      { status: 500 }
    );
  }

  try {
    let card = null;
    switch (body.action) {
      case 'create': {
        if (!body.duration || !isAdultAuthDuration(body.duration)) {
          return NextResponse.json(
            { error: '請選擇有效的授權期限' },
            { status: 400 }
          );
        }
        card = createAdultAuthCard(config, body.duration, authInfo.username);
        break;
      }
      case 'disable': {
        if (!body.code) {
          return NextResponse.json({ error: '缺少授權卡號' }, { status: 400 });
        }
        card = setAdultAuthCardDisabled(config, body.code, true);
        break;
      }
      case 'enable': {
        if (!body.code) {
          return NextResponse.json({ error: '缺少授權卡號' }, { status: 400 });
        }
        card = setAdultAuthCardDisabled(config, body.code, false);
        break;
      }
      case 'delete': {
        if (!body.code) {
          return NextResponse.json({ error: '缺少授權卡號' }, { status: 400 });
        }
        deleteAdultAuthCard(config, body.code);
        break;
      }
    }

    await storage.setAdminConfig(config);
    return NextResponse.json(
      { ok: true, card },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '操作失敗' },
      { status: 400 }
    );
  }
}
