import { NextRequest, NextResponse } from 'next/server';

import { generateSignature } from '@/lib/auth-crypto';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getClientIp, getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

// 读取存储类型环境变量，默认 localstorage
const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | undefined) || 'localstorage';

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

// 生成认证Cookie（带签名）
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
      `${username}:${authData.timestamp}`,
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
        { error: '请求过于频繁，请稍后再试' },
        {
          status: 429,
          headers: getRateLimitHeaders(rateLimitResult),
        }
      );
    }

    // localstorage 模式下不支持注册
    if (STORAGE_TYPE === 'localstorage') {
      return NextResponse.json(
        { error: '当前模式不支持注册' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    // 校验是否开放注册
    if (!config.UserConfig.AllowRegister) {
      return NextResponse.json({ error: '当前未开放注册' }, { status: 400 });
    }

    const { username, password } = await req.json();

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    // 检查是否和管理员重复
    if (username === process.env.USERNAME) {
      return NextResponse.json({ error: '用户已存在' }, { status: 400 });
    }

    try {
      // 检查用户是否已存在
      const exist = await db.checkUserExist(username);
      if (exist) {
        return NextResponse.json({ error: '用户已存在' }, { status: 400 });
      }

      await db.registerUser(username, password);

      // 添加到配置中并保存
      config.UserConfig.Users.push({
        username,
        role: 'user',
      });
      await db.saveAdminConfig(config);

      // 注册成功，设置认证cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(req, username);
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
