import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const sourceCode = searchParams.get('source');
  const auth = getAuthInfoFromCookie(request);
  const username = auth?.username;

  if (!id || !sourceCode) {
    return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
  }

  if (!/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: '無效的視頻ID格式' }, { status: 400 });
  }

  try {
    const apiSites = await getAvailableApiSites(username);
    const apiSite = apiSites.find((site) => site.key === sourceCode);

    if (!apiSite) {
      return NextResponse.json(
        { error: '無效的API來源' },
        { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const result = await getDetailFromApi(apiSite, id);

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
