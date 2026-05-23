import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest) {
  const config = await getConfig();
  const result = {
    SiteName: config.SiteConfig.SiteName,
    StorageType: process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage',
    EnableRegister: config.UserConfig.AllowRegister,
  };
  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'private, no-store',
    },
  });
}
