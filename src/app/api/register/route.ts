import { NextRequest, NextResponse } from 'next/server';

import { generateSignature } from '@/lib/auth-crypto';
import { getAuthSignaturePayload } from '@/lib/auth-server';
import { getConfig, setCachedConfig } from '@/lib/config';
import { db, getStorage } from '@/lib/db';
import { getClientIp, getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';
import { normalizeUsername } from '@/lib/username';

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
  sessionVersion?: string;
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
  username: string,
  sessionVersion: string
): Promise<string> {
  const authData: AuthCookieData = {
    role: 'user',
    username,
    sessionVersion,
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
    const rateLimitResult = await rateLimit(getClientIp(req), {
      limit: 5,
      windowMs: 60_000,
      prefix: 'register',
    });
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: rateLimitResult.unavailable
            ? '服務暫時無法使用，請稍後再試'
            : '請求過於頻繁，請稍後再試',
        },
        {
          status: rateLimitResult.unavailable ? 503 : 429,
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

    const body = await req.json();
    const username = normalizeUsername(body.username);
    const { password } = body;

    if (!username) {
      return NextResponse.json({ error: '用戶名格式無效' }, { status: 400 });
    }
    if (!password || typeof password !== 'string' || password.length > 256) {
      return NextResponse.json({ error: '密碼格式無效' }, { status: 400 });
    }

    // 檢查是否和管理員重復
    if (
      username === process.env.USERNAME ||
      config.UserConfig.Users.some((user) => user.username === username)
    ) {
      return NextResponse.json({ error: '用戶已存在' }, { status: 400 });
    }

    try {
      // 檢查用戶是否已存在
      const exist = await db.checkUserExist(username);
      if (exist) {
        return NextResponse.json({ error: '用戶已存在' }, { status: 400 });
      }

      const storage = getStorage();
      if (!storage) throw new Error('Storage unavailable');
      const registeredConfig = {
        ...config,
        UserConfig: {
          ...config.UserConfig,
          Users: [
            ...config.UserConfig.Users,
            { username, role: 'user' as const },
          ],
        },
      };
      const sessionVersion = await storage.registerUserAtomic(
        username,
        password,
        config,
        registeredConfig
      );
      await setCachedConfig(registeredConfig);

      // 註冊成功，設置認證cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(
        req,
        username,
        sessionVersion
      );
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天過期

      response.cookies.set('auth', cookieValue, getCookieOptions(req, expires));

      return response;
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === '23505'
      ) {
        return NextResponse.json({ error: '用戶已存在' }, { status: 409 });
      }
      return NextResponse.json(
        { error: err instanceof Error ? err.message : '數據庫錯誤' },
        { status: 503 }
      );
    }
  } catch (error) {
    return NextResponse.json({ error: '服務器錯誤' }, { status: 500 });
  }
}
