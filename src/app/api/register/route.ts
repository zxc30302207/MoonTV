import { NextRequest, NextResponse } from 'next/server';

import { generateSignature } from '@/lib/auth-crypto';
import { getAuthSignaturePayload } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getClientIp, getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// 讀取存儲類型環境變量，默認 localstorage
const STORAGE_TYPE =
  process.env.NEXT_PUBLIC_STORAGE_TYPE === 'supabase'
    ? 'supabase'
    : 'localstorage';

type AuthCookieData = {
  role: 'user';
  username: string;
  timestamp: number;
  signature?: string;
};

function getCookieOptions(request: NextRequest, expires: Date) {
  return {
    path: '/',
    expires,
    sameSite: 'lax' as const,
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
  };
}

// 生成認證Cookie（帶簽名）
async function generateAuthCookie(
  request: NextRequest,
  username: string
): Promise<string> {
  const authData: AuthCookieData = {
    role: 'user',
    username,
    timestamp: Date.now(),
  };

  const signingKey = process.env.PASSWORD || '';
  if (signingKey) {
    const signature = await generateSignature(
      getAuthSignaturePayload(authData),
      signingKey
    );
    authData.signature = signature;
  }

  return encodeURIComponent(JSON.stringify(authData));
}

export async function POST(req: NextRequest) {
  try {
    const rateLimitResult = rateLimit(getClientIp(req), {
      limit: 5,
      windowMs: 60_000,
      prefix: 'register',
    });
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: '請求過於頻繁，請稍後再試' },
        {
          status: 429,
          headers: getRateLimitHeaders(rateLimitResult),
        }
      );
    }

    // localstorage 模式下不支持註冊
    if (STORAGE_TYPE === 'localstorage') {
      return NextResponse.json(
        { error: '當前模式不支持註冊' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    // 校驗是否開放註冊
    if (!config.UserConfig.AllowRegister) {
      return NextResponse.json({ error: '當前未開放註冊' }, { status: 400 });
    }

    const { username, password } = await req.json();

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用戶名不能為空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密碼不能為空' }, { status: 400 });
    }

    // 檢查是否和管理員重復
    if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用戶已存在' }, { status: 400 });
    }

    try {
      // 檢查用戶是否已存在
      const exist = await db.checkUserExist(username);
      if (exist) {
        return NextResponse.json({ error: '用戶已存在' }, { status: 400 });
      }

      await db.registerUser(username, password);

      // 添加到配置中並保存
      config.UserConfig.Users.push({
        username,
        role: 'user',
      });
      await db.saveAdminConfig(config);

      // 註冊成功，設置認證cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(req, username);
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天過期

      response.cookies.set('auth', cookieValue, getCookieOptions(req, expires));

      return response;
    } catch (err) {
      return NextResponse.json({ error: '數據庫錯誤' }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json({ error: '服務器錯誤' }, { status: 500 });
  }
}
