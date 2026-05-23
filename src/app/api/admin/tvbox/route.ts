import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';
import { createTVBoxToken } from '@/lib/tvbox-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const adminConfig = await getConfig();

  // 本地模式：不強制要求登錄，用環境變量返回只讀信息
  if (storageType === 'localstorage') {
    const base = new URL(request.url);
    base.pathname = '/api/tvbox/config';
    base.search = '';
    return NextResponse.json({
      enabled:
        process.env.TVBOX_ENABLED == null ||
        String(process.env.TVBOX_ENABLED).trim() === ''
          ? true
          : String(process.env.TVBOX_ENABLED).toLowerCase() === 'true',
      password: process.env.PASSWORD || '',
      url: base.toString(),
      localMode: true,
    });
  }

  // 非本地模式：需要已登錄用戶
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 生成接口 URL（基於請求 URL 推導）
  const base = new URL(request.url);
  base.pathname = '/api/tvbox/config';
  base.search = '';
  const token = await createTVBoxToken(authInfo.username);
  const url = `${base.toString()}?token=${encodeURIComponent(token)}`;

  const payload = {
    enabled: adminConfig.SiteConfig.TVBoxEnabled === true,
    password: adminConfig.SiteConfig.TVBoxPassword || '',
    url,
    token,
    localMode: false,
  };

  return NextResponse.json(payload);
}

export async function POST(request: NextRequest) {
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminConfig = await getConfig();
  const username = authInfo.username;
  if (username !== process.env.USERNAME) {
    const user = adminConfig.UserConfig.Users.find(
      (u) => u.username === username
    );
    if (!user || user.role !== 'admin' || user.banned) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }
  }

  const body = await request.json();
  const { enabled, password, mode } = body as {
    enabled?: boolean;
    password?: string;
    mode?: 'custom' | 'random' | 'keep';
  };

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  // localstorage 模式：開關由環境變量控制，這裡只允許返回提示，不修改
  if (storageType === 'localstorage') {
    return NextResponse.json(
      { error: '本地模式下由環境變量 TVBOX_ENABLED 控制開關，口令=PASSWORD' },
      { status: 400 }
    );
  }

  // 非本地模式：允許修改配置並持久化
  if (typeof enabled === 'boolean') {
    adminConfig.SiteConfig.TVBoxEnabled = enabled;
  }

  let finalPassword = adminConfig.SiteConfig.TVBoxPassword || '';
  if (mode === 'random') {
    // 簡單隨機口令
    const alphabet =
      'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    finalPassword = Array.from({ length: 16 })
      .map(() => alphabet[Math.floor(Math.random() * alphabet.length)])
      .join('');
  } else if (mode === 'custom' && typeof password === 'string') {
    finalPassword = password;
  }

  adminConfig.SiteConfig.TVBoxPassword = finalPassword;

  const storage = getStorage();
  if (storage && typeof storage.setAdminConfig === 'function') {
    await storage.setAdminConfig(adminConfig);
  }

  const base = new URL(request.url);
  base.pathname = '/api/tvbox/config';
  base.search = '';

  const token = await createTVBoxToken(username);
  return NextResponse.json({
    enabled: adminConfig.SiteConfig.TVBoxEnabled === true,
    password: adminConfig.SiteConfig.TVBoxPassword || '',
    token,
    url: `${base.toString()}?token=${encodeURIComponent(token)}`,
  });
}
