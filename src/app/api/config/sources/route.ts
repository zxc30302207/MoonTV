import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getAvailableApiSites } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const auth = await getVerifiedAuthInfo(request);
    const username = auth?.username;
    const sites = await getAvailableApiSites(username);
    return NextResponse.json(sites, {
      headers: {
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: '獲取視頻源失敗' }, { status: 500 });
  }
}
