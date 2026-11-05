import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { readBoundedText } from '@/lib/bounded-response';
import {
  canAccessAdultContent,
  getAvailableApiSites,
  getConfig,
} from '@/lib/config';
import { getRequestOrigin } from '@/lib/request-origin';
import { SearchResult } from '@/lib/types';
import { accessibleStore, validPlayPath } from '@/lib/watch-room/access';
import { handleRoomAction } from '@/lib/watch-room/service';
import { roomTransaction } from '@/lib/watch-room/transaction';
import {
  cleanText,
  MAX_NAME_LENGTH,
  RoomRequest,
} from '@/lib/watch-room/types';
import { isYellowSearchResult } from '@/lib/yellow';

export const runtime = 'nodejs';
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie',
};
const MAX_BODY_BYTES = 8 * 1024;
const ACTIONS = new Set([
  'create',
  'myRooms',
  'publicRooms',
  'setPublic',
  'close',
  'delete',
  'enterOwned',
  'activateOwned',
  'hasPersistentRoom',
  'join',
  'sync',
  'setSyncMode',
  'control',
  'chat',
  'leave',
]);
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export async function POST(request: NextRequest) {
  const auth = await getVerifiedAuthInfo(request);
  if (!auth?.username) return json({ ok: false, error: '請先登入' }, 401);
  const origin = request.headers.get('origin');
  if (!origin || origin !== getRequestOrigin(request))
    return json({ ok: false, error: '不允許跨站請求' }, 403);
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES)
    return json({ ok: false, error: '請求過大' }, 413);
  let input: RoomRequest;
  try {
    const body = JSON.parse(
      await readBoundedText(new Response(request.body), MAX_BODY_BYTES, 5000)
    );
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !ACTIONS.has(body.action)
    )
      return json({ ok: false, error: '操作無效' }, 400);
    input = body;
  } catch {
    return json({ ok: false, error: '請求格式無效或超過大小限制' }, 400);
  }
  try {
    const [config, sites] = await Promise.all([
      getConfig(),
      getAvailableApiSites(auth.username),
    ]);
    const allowAdult = canAccessAdultContent(config, auth.username);
    const canAccess = (path: string, title: string) => {
      if (!validPlayPath(path)) return false;
      const params = new URL(path, 'https://moontv.invalid').searchParams;
      if (params.has('url')) return false;
      const source = params.get('source');
      // Empty rooms can be created from the lobby before choosing a film.
      if (!source) return !params.has('id') && !params.size;
      const site = sites.find((item) => item.key === source);
      return (
        !!site &&
        (allowAdult ||
          !isYellowSearchResult({
            source,
            source_name: site.name,
            title,
          } as SearchResult))
      );
    };
    if (
      (input.action === 'create' || input.action === 'sync') &&
      input.playPath &&
      !canAccess(input.playPath, input.title || '')
    )
      return json({ ok: false, error: '播放來源未授權' }, 403);
    const identity = {
      name: cleanText(auth.username, MAX_NAME_LENGTH),
      owner: auth.username,
    };
    const result = await roomTransaction((store) =>
      handleRoomAction(input, identity, accessibleStore(store, canAccess))
    );
    return json(result, result.ok ? 200 : 400);
  } catch {
    return json({ ok: false, error: '觀影室暫時無法使用，請稍後重試' }, 503);
  }
}
