/** @jest-environment node */
import { NextRequest } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { readBoundedText } from '@/lib/bounded-response';
import {
  canAccessAdultContent,
  getAvailableApiSites,
  getConfig,
} from '@/lib/config';
import { handleRoomAction } from '@/lib/watch-room/service';
import { roomTransaction } from '@/lib/watch-room/transaction';

import { POST } from '@/app/api/watch-room/route';

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init: unknown) => ({ body, ...(init as object) }),
  },
}));
jest.mock('@/lib/auth-server', () => ({ getVerifiedAuthInfo: jest.fn() }));
jest.mock('@/lib/config', () => ({
  canAccessAdultContent: jest.fn(),
  getAvailableApiSites: jest.fn(),
  getConfig: jest.fn(),
}));
jest.mock('@/lib/bounded-response', () => ({ readBoundedText: jest.fn() }));
jest.mock('@/lib/watch-room/service', () => ({ handleRoomAction: jest.fn() }));
jest.mock('@/lib/watch-room/transaction', () => ({
  roomTransaction: jest.fn(),
}));
jest.mock('@/lib/yellow', () => ({
  isYellowSearchResult: (item: { title: string }) => item.title === 'adult',
}));
const parsed = readBoundedText as jest.Mock;
function request(origin = 'https://app.test') {
  const headers = new Map([
    ['origin', origin],
    ['host', 'app.test'],
  ]);
  return {
    headers: { get: (key: string) => headers.get(key) || null },
    url: 'https://app.test/api/watch-room',
    body: null,
  } as unknown as NextRequest;
}
async function run(req = request()) {
  return (await POST(req)) as unknown as {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  };
}
describe('watch room endpoint boundary', () => {
  const originalResponse = global.Response;
  beforeAll(() => {
    global.Response = class {
      constructor(public body: unknown) {}
    } as unknown as typeof Response;
  });
  afterAll(() => {
    global.Response = originalResponse;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    (getVerifiedAuthInfo as jest.Mock).mockResolvedValue({ username: 'alice' });
    (getConfig as jest.Mock).mockResolvedValue({});
    (getAvailableApiSites as jest.Mock).mockResolvedValue([
      { key: 'normal', name: 'Normal' },
    ]);
    (canAccessAdultContent as jest.Mock).mockReturnValue(false);
    parsed.mockResolvedValue(JSON.stringify({ action: 'publicRooms' }));
    (roomTransaction as jest.Mock).mockImplementation(async (fn) => fn({}));
    (handleRoomAction as jest.Mock).mockResolvedValue({ ok: true, rooms: [] });
  });
  it('rejects unauthenticated requests before reading body', async () => {
    (getVerifiedAuthInfo as jest.Mock).mockResolvedValue(null);
    expect((await run()).status).toBe(401);
    expect(parsed).not.toHaveBeenCalled();
  });
  it('rejects cross-origin and missing origin', async () => {
    expect((await run(request('https://evil.test'))).status).toBe(403);
    expect((await run(request(''))).status).toBe(403);
    expect(roomTransaction).not.toHaveBeenCalled();
  });
  it('bounds streamed bodies and rejects malformed operations', async () => {
    parsed.mockRejectedValue(new Error('oversized'));
    expect((await run()).status).toBe(400);
    expect(parsed).toHaveBeenCalledWith(expect.anything(), 8192, 5000);
    parsed.mockResolvedValue('null');
    expect((await run()).status).toBe(400);
  });
  it('denies disallowed sources, direct URLs and adult titles', async () => {
    for (const input of [
      { playPath: '/play?source=blocked&id=1', title: 'Film' },
      { playPath: '/play?url=https://evil.test', title: 'Film' },
      { playPath: '/play?source=normal&id=1', title: 'adult' },
    ]) {
      parsed.mockResolvedValue(JSON.stringify({ action: 'create', ...input }));
      expect((await run()).status).toBe(403);
    }
    expect(roomTransaction).not.toHaveBeenCalled();
  });
  it('uses private response caching and verified identity', async () => {
    const result = await run();
    expect(result.status).toBe(200);
    expect(result.headers['Cache-Control']).toContain('private, no-store');
    expect(handleRoomAction).toHaveBeenCalledWith(
      expect.anything(),
      { name: 'alice', owner: 'alice' },
      expect.anything()
    );
  });
});
