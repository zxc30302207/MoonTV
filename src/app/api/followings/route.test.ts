/* eslint-disable @typescript-eslint/no-var-requires */

const mockAuth = jest.fn();
const mockSites = jest.fn();
const mockCanAdult = jest.fn();
const mockDb = {
  readNamespace: jest.fn(),
  mutateNamespace: jest.fn(),
  getAllFollowings: jest.fn(),
  getFollowing: jest.fn(),
  saveFollowing: jest.fn(),
  updateFollowingIfUnchanged: jest.fn(),
  deleteFollowing: jest.fn(),
  getTodayUpdated: jest.fn(),
  setTodayUpdated: jest.fn(),
};
const mockDetail = jest.fn();

jest.mock('@/lib/auth-server', () => ({ getVerifiedAuthInfo: mockAuth }));
jest.mock('@/lib/config', () => ({
  getConfig: async () => ({}),
  getAvailableApiSites: mockSites,
  canAccessAdultContent: mockCanAdult,
  ADULT_SOURCE_KEYS: new Set(['adult']),
}));
jest.mock('@/lib/db', () => ({ db: mockDb }));
jest.mock('@/lib/fetchVideoDetail', () => ({ fetchVideoDetail: mockDetail }));

const item = {
  title: 'Show',
  source_name: 'Normal',
  year: '2026',
  cover: '',
  search_title: 'Show',
  total_episodes: 2,
  watched_episodes: 1,
  save_time: 1,
};

describe('private following routes', () => {
  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    const { ReadableStream } = require('stream/web');
    Object.assign(globalThis, { Headers, Request, Response, ReadableStream });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'supabase';
    mockAuth.mockResolvedValue({ username: 'alice', role: 'user' });
    mockSites.mockResolvedValue([{ key: 'normal' }]);
    mockCanAdult.mockReturnValue(false);
    mockDb.getFollowing.mockResolvedValue(item);
    mockDb.readNamespace.mockImplementation(async () => ({
      data: await mockDb.getAllFollowings(),
      version: { epoch: '00000000-0000-4000-8000-000000000001', revision: '0' },
    }));
    mockDb.mutateNamespace.mockResolvedValue({
      version: { epoch: '00000000-0000-4000-8000-000000000001', revision: '1' },
      duplicate: false,
    });
    mockDb.updateFollowingIfUnchanged.mockResolvedValue(true);
    mockDb.getAllFollowings.mockResolvedValue({
      'normal+1': item,
      'adult+2': item,
      'normal+3': { ...item, title: '成人内容' },
    });
  });

  async function request(path: string, body?: unknown) {
    const { NextRequest } = await import('next/server');
    return new NextRequest(
      `http://localhost/api/${path}`,
      body === undefined
        ? {
            headers: {
              'X-MoonTV-Epoch': '00000000-0000-4000-8000-000000000001',
              'X-MoonTV-Revision': '0',
              'X-MoonTV-Operation-Id': '00000000-0000-4000-8000-000000000002',
            },
          }
        : {
            method: 'POST',
            body: JSON.stringify(body),
            headers: {
              'Content-Type': 'application/json',
              'X-MoonTV-Epoch': '00000000-0000-4000-8000-000000000001',
              'X-MoonTV-Revision': '0',
              'X-MoonTV-Operation-Id': '00000000-0000-4000-8000-000000000002',
            },
          }
    );
  }

  it('requires verified authentication before reading private records', async () => {
    mockAuth.mockResolvedValue(null);
    const { GET } = await import('./route');
    const response = await GET(await request('followings'));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mockDb.getAllFollowings).not.toHaveBeenCalled();
  });

  it('filters unavailable sources and adult titles and disables response caching', async () => {
    const { GET } = await import('./route');
    const response = await GET(await request('followings'));
    expect(await response.json()).toEqual({ 'normal+1': item });
    expect(mockSites).toHaveBeenCalledWith('alice');
    expect(response.headers.get('cache-control')).toContain('private');
  });

  it('rejects restricted writes and malformed composite keys', async () => {
    const { POST } = await import('./route');
    expect(
      (
        await POST(
          await request('followings', { key: 'adult+1', following: item })
        )
      ).status
    ).toBe(403);
    expect(
      (
        await POST(
          await request('followings', { key: 'normal+1+2', following: item })
        )
      ).status
    ).toBe(400);
    expect(mockDb.saveFollowing).not.toHaveBeenCalled();
  });

  it('refreshes authorized stored data without accepting client progress changes', async () => {
    mockDetail.mockResolvedValue({
      title: 'Show',
      source: 'normal',
      source_name: 'Normal',
      episodes: ['a', 'b', 'c'],
    });
    const { POST } = await import('./refresh/route');
    const response = await POST(
      await request('followings/refresh', {
        followings: {
          'normal+1': { ...item, watched_episodes: 999 },
          'adult+2': item,
        },
      })
    );
    const events = await response.text();
    expect(mockDetail).toHaveBeenCalledTimes(1);
    expect(mockDetail).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'alice', source: 'normal', id: '1' })
    );
    expect(mockDb.updateFollowingIfUnchanged).toHaveBeenCalledWith(
      'alice',
      'normal',
      '1',
      item,
      expect.objectContaining({ watched_episodes: 1, total_episodes: 3 })
    );
    expect(events).toContain('"type":"complete"');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('does not recreate an entry unfollowed while its detail request is pending', async () => {
    let finishDetail!: (detail: unknown) => void;
    mockDetail.mockReturnValue(
      new Promise((resolve) => {
        finishDetail = resolve;
      })
    );
    const { POST } = await import('./refresh/route');
    const response = await POST(
      await request('followings/refresh', { followings: { 'normal+1': item } })
    );
    expect(mockDetail).toHaveBeenCalledTimes(1);
    // The unfollow completes before the source responds.
    mockDb.mutateNamespace.mockImplementationOnce(async () => {
      mockDb.getFollowing.mockResolvedValue(null);
      return {
        version: {
          epoch: '00000000-0000-4000-8000-000000000001',
          revision: '1',
        },
        duplicate: false,
      };
    });
    const { DELETE } = await import('./route');
    expect(
      (await DELETE(await request('followings?key=normal%2B1'))).status
    ).toBe(200);
    finishDetail({
      title: 'Show',
      source: 'normal',
      source_name: 'Normal',
      episodes: ['a', 'b', 'c'],
    });
    const events = await response.text();
    expect(events).toContain('"type":"item_removed"');
    expect(events).not.toContain('"type":"item_result"');
    expect(mockDb.updateFollowingIfUnchanged).not.toHaveBeenCalled();
    expect(mockDb.saveFollowing).not.toHaveBeenCalled();
  });

  it('retries a concurrent progress edit against its latest value', async () => {
    const latest = { ...item, watched_episodes: 2, save_time: 99 };
    mockDb.getFollowing
      .mockResolvedValueOnce(item)
      .mockResolvedValueOnce(latest);
    mockDb.updateFollowingIfUnchanged
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    mockDetail.mockResolvedValue({
      title: 'Show',
      source: 'normal',
      source_name: 'Normal',
      episodes: ['a', 'b', 'c'],
    });
    const { POST } = await import('./refresh/route');
    const response = await POST(
      await request('followings/refresh', { followings: { 'normal+1': item } })
    );
    await response.text();
    expect(mockDb.updateFollowingIfUnchanged).toHaveBeenNthCalledWith(
      2,
      'alice',
      'normal',
      '1',
      latest,
      expect.objectContaining({
        watched_episodes: 2,
        save_time: 99,
        total_episodes: 3,
      })
    );
    expect(mockDb.saveFollowing).not.toHaveBeenCalled();
  });

  it('does not resurrect an entry deleted between the re-read and conditional update', async () => {
    mockDb.getFollowing.mockResolvedValueOnce(item).mockResolvedValueOnce(null);
    mockDb.updateFollowingIfUnchanged.mockResolvedValueOnce(false);
    mockDetail.mockResolvedValue({
      title: 'Show',
      source: 'normal',
      source_name: 'Normal',
      episodes: ['a', 'b', 'c'],
    });
    const { POST } = await import('./refresh/route');
    const response = await POST(
      await request('followings/refresh', { followings: { 'normal+1': item } })
    );
    expect(await response.text()).toContain('"type":"item_removed"');
    expect(mockDb.updateFollowingIfUnchanged).toHaveBeenCalledTimes(1);
    expect(mockDb.saveFollowing).not.toHaveBeenCalled();
  });

  it('does not save or return adult detail results to unauthorized users', async () => {
    mockDetail.mockResolvedValue({
      title: '成人内容',
      source: 'normal',
      source_name: 'Normal',
      episodes: ['a'],
    });
    const { POST } = await import('./refresh/route');
    const response = await POST(await request('followings/refresh', {}));
    expect(await response.text()).not.toContain('"type":"item_result"');
    expect(mockDb.saveFollowing).not.toHaveBeenCalled();
  });

  it('filters today-updated records using the same source permissions', async () => {
    mockDb.getTodayUpdated.mockResolvedValue({
      date: '2026-10-06',
      items: [
        { ...item, source: 'normal', id: '1' },
        { ...item, source: 'adult', id: '2' },
      ],
    });
    const { GET } = await import('../today-updated/route');
    const response = await GET(await request('today-updated'));
    expect((await response.json()).items).toHaveLength(1);
  });
});

export {};
