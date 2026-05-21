import { NextRequest, NextResponse } from 'next/server';

import { generateSignature } from '@/lib/auth-crypto';
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
  role: 'owner' | 'admin' | 'user';
  username?: string;
  signature?: string;
  timestamp?: number;
  mode?: 'localstorage';
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
  options: {
    username?: string;
    role?: 'owner' | 'admin' | 'user';
    mode?: 'localstorage';
  }
): Promise<string> {
  const authData: AuthCookieData = {
    role: options.role || 'user',
    username: options.username,
    mode: options.mode,
    timestamp: Date.now(),
  };

  const secret = process.env.PASSWORD || '';
  if (secret) {
    const dataToSign =
      options.mode === 'localstorage'
        ? `localstorage:${authData.timestamp}`
        : authData.username
        ? `${authData.username}:${authData.timestamp}`
        : '';
    if (dataToSign) {
      authData.signature = await generateSignature(dataToSign, secret);
    }
  }

  return encodeURIComponent(JSON.stringify(authData));
}

export async function POST(req: NextRequest) {
  try {
    const rateLimitResult = rateLimit(getClientIp(req), {
      limit: 10,
      windowMs: 60_000,
      prefix: 'login',
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

    // 本地 / localStorage 模式——僅校驗固定密碼
    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = process.env.PASSWORD;

      // 未配置 PASSWORD 時直接放行
      if (!envPassword) {
        const response = NextResponse.json({ ok: true });

        // 清除可能存在的認證cookie
        response.cookies.set('auth', '', getCookieOptions(req, new Date(0)));

        return response;
      }

      const { password } = await req.json();
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密碼不能為空' }, { status: 400 });
      }

      if (password !== envPassword) {
        return NextResponse.json(
          { ok: false, error: '密碼錯誤' },
          { status: 401 }
        );
      }

      // 驗證成功，設置認證cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(req, {
        role: 'user',
        mode: 'localstorage',
      });
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天過期

      response.cookies.set('auth', cookieValue, getCookieOptions(req, expires));

      return response;
    }

    // 數據庫模式——校驗用戶名並嘗試連接數據庫
    const { username, password } = await req.json();

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用戶名不能為空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密碼不能為空' }, { status: 400 });
    }

    // 可能是站長，直接讀環境變量
    if (
      username === process.env.USERNAME &&
      password === process.env.PASSWORD
    ) {
      // 驗證成功，設置認證cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(req, {
        username,
        role: 'owner',
      });
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天過期

      response.cookies.set('auth', cookieValue, getCookieOptions(req, expires));

      return response;
    } else if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用戶名或密碼錯誤' }, { status: 401 });
    }

    const config = await getConfig();
    const user = config.UserConfig.Users.find((u) => u.username === username);
    if (user && user.banned) {
      return NextResponse.json({ error: '用戶被封禁' }, { status: 401 });
    }

    // 校驗用戶密碼
    try {
      const pass = await db.verifyUser(username, password);
      if (!pass) {
        return NextResponse.json(
          { error: '用戶名或密碼錯誤' },
          { status: 401 }
        );
      }

      // 驗證成功，設置認證cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(req, {
        username,
        role: user?.role || 'user',
      });
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
