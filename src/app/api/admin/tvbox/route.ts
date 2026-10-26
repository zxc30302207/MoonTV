import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { ConfigConflictError } from '@/lib/config-snapshot';
import { getStorage } from '@/lib/db';
import { getRequestOrigin } from '@/lib/request-origin';
import { createTVBoxToken } from '@/lib/tvbox-auth';

export const runtime = 'nodejs';

function buildTvboxConfigUrl(request: NextRequest) {
  const origin = getRequestOrigin(request);
  return `${origin}/api/tvbox/config`;
}

export async function GET(request: NextRequest) {
  const issuanceTime = Date.now();
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const adminConfig = await getConfig();

  // 本地模式：不強制要求登錄，用環境變量返回只讀信息
  if (storageType === 'localstorage') {
    const baseUrl = buildTvboxConfigUrl(request);
    return NextResponse.json({
      enabled:
        process.env.TVBOX_ENABLED == null ||
        String(process.env.TVBOX_ENABLED).trim() === ''
          ? true
          : String(process.env.TVBOX_ENABLED).toLowerCase() === 'true',
      password: process.env.PASSWORD || '',
      url: baseUrl,
      localMode: true,
    });
  }

  // 非本地模式：需要已登錄用戶
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 生成接口 URL（基於請求 URL 推導）
  const baseUrl = buildTvboxConfigUrl(request);
  const token = await createTVBoxToken(
    authInfo.username,
    issuanceTime,
    authInfo.sessionVersion
  );
  const url = `${baseUrl}?token=${encodeURIComponent(token)}`;

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
  const issuanceTime = Date.now();
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
    try {
      await storage.setAdminConfig(adminConfig);
    } catch (error) {
      if (error instanceof ConfigConflictError)
        return NextResponse.json({ error: error.message }, { status: 409 });
      throw error;
    }
  }

  const baseUrl = buildTvboxConfigUrl(request);

  const token = await createTVBoxToken(
    username,
    issuanceTime,
    authInfo.sessionVersion
  );
  return NextResponse.json({
    enabled: adminConfig.SiteConfig.TVBoxEnabled === true,
    password: adminConfig.SiteConfig.TVBoxPassword || '',
    token,
    url: `${baseUrl}?token=${encodeURIComponent(token)}`,
  });
}
