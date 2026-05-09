import { NextRequest } from 'next/server';

// 從cookie獲取認證信息 (服務端使用)
export function getAuthInfoFromCookie(request: NextRequest): {
  username?: string;
  signature?: string;
  timestamp?: number;
  role?: 'owner' | 'admin' | 'user';
  mode?: 'localstorage';
} | null {
  const authCookie = request.cookies.get('auth');

  if (!authCookie) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(authCookie.value);
    const authData = JSON.parse(decoded);
    return authData;
  } catch (error) {
    return null;
  }
}
