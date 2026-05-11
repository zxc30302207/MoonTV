import { NextRequest, NextResponse } from 'next/server';

import {
  getAdultAuthorizationStatus,
  redeemAdultAuthCard,
} from '@/lib/adult-authorization';
import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo?.username) {
    return NextResponse.json({ authorized: false }, { status: 401 });
  }

  const config = await getConfig();
  const status = getAdultAuthorizationStatus(config, authInfo.username);

  return NextResponse.json(
    {
      authorized: status.authorized,
      reason: status.reason,
      expiresAt: status.expiresAt ?? null,
    },
    { headers: noStoreHeaders() }
  );
}

export async function POST(request: NextRequest) {
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo?.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
  };
  if (!body.code || typeof body.code !== 'string') {
    return NextResponse.json({ error: '請輸入授權卡號' }, { status: 400 });
  }

  const config = await getConfig();
  const storage = getStorage();
  if (!storage || typeof storage.setAdminConfig !== 'function') {
    return NextResponse.json(
      { error: '目前儲存後端不支援成人授權' },
      { status: 500 }
    );
  }

  try {
    const grant = redeemAdultAuthCard(config, authInfo.username, body.code);
    await storage.setAdminConfig(config);

    return NextResponse.json(
      {
        ok: true,
        authorized: true,
        expiresAt: grant.expiresAt,
      },
      { headers: noStoreHeaders() }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '授權卡號不可用' },
      { status: 400 }
    );
  }
}

function noStoreHeaders() {
  return {
    'Cache-Control': 'private, no-store',
  };
}
