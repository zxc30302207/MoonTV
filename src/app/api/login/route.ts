import { NextRequest, NextResponse } from 'next/server';

import { generateSignature } from '@/lib/auth-crypto';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getClientIp, getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';

export const runtime = 'edge';

// 读取存储类型环境变量，默认 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | undefined) || 'localstorage';

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

// 生成认证Cookie（带签名）
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
        { error: '请求过于频繁，请稍后再试' },
        {
          status: 429,
          headers: getRateLimitHeaders(rateLimitResult),
        }
      );
    }

    // 本地 / localStorage 模式——仅校验固定密码
    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = process.env.PASSWORD;

      // 未配置 PASSWORD 时直接放行
      if (!envPassword) {
        const response = NextResponse.json({ ok: true });

        // 清除可能存在的认证cookie
        response.cookies.set(
          'auth',
          '',
          getCookieOptions(req, new Date(0))
        );

        return response;
      }

      const { password } = await req.json();
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
      }

      if (password !== envPassword) {
        return NextResponse.json(
          { ok: false, error: '密码错误' },
          { status: 401 }
        );
      }

      // 验证成功，设置认证cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(req, {
        role: 'user',
        mode: 'localstorage',
      });
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天过期

      response.cookies.set('auth', cookieValue, getCookieOptions(req, expires));

      return response;
    }

    // 数据库 / redis 模式——校验用户名并尝试连接数据库
    const { username, password } = await req.json();

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    // 可能是站长，直接读环境变量
    if (
      username === process.env.USERNAME &&
      password === process.env.PASSWORD
    ) {
      // 验证成功，设置认证cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(req, {
        username,
        role: 'owner',
      });
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天过期

      response.cookies.set('auth', cookieValue, getCookieOptions(req, expires));

      return response;
    } else if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    const config = await getConfig();
    const user = config.UserConfig.Users.find((u) => u.username === username);
    if (user && user.banned) {
      return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
    }

    // 校验用户密码
    try {
      const pass = await db.verifyUser(username, password);
      if (!pass) {
        return NextResponse.json(
          { error: '用户名或密码错误' },
          { status: 401 }
        );
      }

      // 验证成功，设置认证cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(req, {
        username,
        role: user?.role || 'user',
      });
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天过期

      response.cookies.set('auth', cookieValue, getCookieOptions(req, expires));

      return response;
    } catch (err) {
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
