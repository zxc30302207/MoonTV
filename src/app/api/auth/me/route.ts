import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({
    user: {
      username: authInfo.username,
      role: authInfo.role || 'user',
      mode: authInfo.mode,
    },
  });
}
