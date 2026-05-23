import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites } from '@/lib/config';

export const runtime = 'nodejs';

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthInfoFromCookie(request);
    const username = auth?.username;
    const apiSites = await getAvailableApiSites(username);

    return NextResponse.json(apiSites, {
      headers: {
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: '獲取資源失敗' }, { status: 500 });
  }
}
