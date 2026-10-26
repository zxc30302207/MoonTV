const mockAuth = { current: null as { username: string } | null };
const mockRefreshAuth = jest.fn();

jest.mock('./auth-client', () => ({
  getCachedAuthInfo: () => mockAuth.current,
  refreshAuthInfo: mockRefreshAuth,
}));

function response(value: unknown): Response {
  return { ok: true, json: async () => value } as Response;
}

describe('following client session isolation', () => {
  let api: typeof import('./db.client');
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    localStorage.clear();
    mockAuth.current = { username: 'alice' };
    mockRefreshAuth.mockReset();
    Object.assign(window, { RUNTIME_CONFIG: { STORAGE_TYPE: 'supabase' } });
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    api = await import('./db.client');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('waits for initial auth bootstrap before loading account data', async () => {
    mockAuth.current = null;
    mockRefreshAuth.mockImplementation(async () => {
      mockAuth.current = { username: 'alice' };
      return mockAuth.current;
    });
    fetchMock.mockResolvedValue(response({}));
    await api.getAllFollowings();
    expect(mockRefreshAuth).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/followings',
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(localStorage.getItem('moontv_cache_alice')).not.toBeNull();
  });

  it('does not deduplicate pending reads across accounts or cache old responses', async () => {
    let resolveAlice!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveAlice = resolve;
      })
    );
    const aliceRequest = api.getAllFollowings();
    mockAuth.current = { username: 'bob' };
    fetchMock.mockResolvedValueOnce(
      response({ 'normal+bob': { title: 'Bob' } })
    );
    expect(await api.getAllFollowings()).toEqual({
      'normal+bob': { title: 'Bob' },
    });
    resolveAlice(response({ 'normal+alice': { title: 'Alice' } }));
    expect(await aliceRequest).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('moontv_cache_bob')).not.toContain('Alice');
    expect(localStorage.getItem('moontv_cache_alice')).toBeNull();
  });

  it.each([true, false])(
    'does not restore an unfollowed card after refresh (episodes changed: %s)',
    async (updated) => {
      const following = {
        title: 'Show',
        source_name: 'Normal',
        year: '2026',
        cover: '',
        search_title: 'Show',
        total_episodes: 2,
        watched_episodes: 1,
        save_time: 1,
      };
      let finishRead!: (value: { done: boolean; value: Uint8Array }) => void;
      const reader = {
        read: jest
          .fn()
          .mockReturnValueOnce(
            new Promise((resolve) => {
              finishRead = resolve;
            })
          )
          .mockResolvedValueOnce({ done: true }),
        cancel: jest.fn(),
      };
      fetchMock.mockImplementation(
        async (url: string, options?: RequestInit) => {
          if (url === '/api/followings/refresh')
            return { ...response({}), body: { getReader: () => reader } };
          if (options?.method === 'POST' || options?.method === 'DELETE')
            return response({ success: true });
          // Even a read racing a pending DELETE must not undo the local unfollow.
          return response({ 'normal+1': following });
        }
      );
      await api.saveFollowing('normal', '1', following);
      const onItemResult = jest.fn();
      const events: unknown[] = [];
      const listener = (event: Event) =>
        events.push((event as CustomEvent).detail);
      window.addEventListener('followingsUpdated', listener);
      try {
        const pending = api.refreshFollowingsStream(
          { 'normal+1': following },
          { onItemResult }
        );
        await api.deleteFollowing('normal', '1');
        finishRead({
          done: false,
          value: new TextEncoder().encode(
            `data: ${JSON.stringify({
              type: 'item_result',
              key: 'normal+1',
              source: 'normal',
              id: '1',
              title: 'Show',
              total_episodes: updated ? 3 : 2,
              updated,
            })}\n\n` +
              'data: {"type":"item_removed","key":"normal+1"}\n\ndata: {"type":"complete","total":1}\n\n'
          ),
        });
        expect(await pending).toEqual({});
        expect(onItemResult).not.toHaveBeenCalled();
        expect(
          events.every(
            (value) => !Object.prototype.hasOwnProperty.call(value, 'normal+1')
          )
        ).toBe(true);
        expect(
          JSON.parse(localStorage.getItem('moontv_cache_alice') || '{}')
            .followings.data
        ).toEqual({});
      } finally {
        window.removeEventListener('followingsUpdated', listener);
      }
    }
  );

  it('uses a fresh server list to remove a card unfollowed on another device', async () => {
    const following = {
      title: 'Show',
      source_name: 'Normal',
      year: '2026',
      cover: '',
      search_title: 'Show',
      total_episodes: 2,
      watched_episodes: 1,
      save_time: 1,
    };
    fetchMock
      .mockResolvedValueOnce({
        ...response({}),
        body: {
          getReader: () => ({
            read: jest
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(
                  'data: {"type":"item_removed","key":"normal+1"}\n\ndata: {"type":"complete","total":1}\n\n'
                ),
              })
              .mockResolvedValueOnce({ done: true }),
          }),
        },
      })
      .mockResolvedValueOnce(response({}));
    expect(
      await api.refreshFollowingsStream({ 'normal+1': following })
    ).toEqual({});
    expect(
      JSON.parse(localStorage.getItem('moontv_cache_alice') || '{}').followings
        .data
    ).toEqual({});
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/followings',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('discards today-updated reads when the account changes', async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
    );
    const pending = api.getTodayUpdated();
    mockAuth.current = { username: 'bob' };
    finish(response({ date: '2026-10-06', items: [{ title: 'Private' }] }));
    expect(await pending).toBeNull();
    expect(localStorage.getItem('moontv_cache_bob')).toBeNull();
  });
  it('rejects an interrupted refresh instead of returning a successful cached result', async () => {
    fetchMock.mockResolvedValueOnce({
      ...response({}),
      body: { getReader: () => ({ read: async () => ({ done: true }) }) },
    });
    await expect(api.refreshFollowingsStream({})).rejects.toThrow(
      '追更刷新連線中斷'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('preserves successful streamed updates over an older cache when the stream breaks', async () => {
    const item = {
      title: 'Show',
      search_title: 'Show',
      source_name: 'Normal',
      year: '2026',
      cover: '',
      total_episodes: 2,
      watched_episodes: 1,
      save_time: 1,
    };
    fetchMock.mockResolvedValueOnce(response({}));
    await api.saveFollowing('normal', '1', item);
    fetchMock.mockResolvedValueOnce({
      ...response({}),
      body: {
        getReader: () => ({
          read: jest
            .fn()
            .mockResolvedValueOnce({
              done: false,
              value: new TextEncoder().encode(
                'data: {"type":"item_result","key":"normal+1","source":"normal","id":"1","total_episodes":9}\n\n'
              ),
            })
            .mockRejectedValueOnce(new Error('broken')),
        }),
      },
    });
    await expect(
      api.refreshFollowingsStream({ 'normal+1': item })
    ).rejects.toThrow('broken');
    expect(
      JSON.parse(localStorage.getItem('moontv_cache_alice') || '{}').followings
        .data['normal+1'].total_episodes
    ).toBe(9);
  });
  it('counts a removed item as processed without claiming it was refreshed', async () => {
    const onComplete = jest.fn();
    const onItemRemoved = jest.fn();
    fetchMock
      .mockResolvedValueOnce({
        ...response({}),
        body: {
          getReader: () => ({
            read: jest
              .fn()
              .mockResolvedValueOnce({
                done: false,
                value: new TextEncoder().encode(
                  'data: {"type":"item_removed","key":"normal+1"}\n\ndata: {"type":"complete","total":1,"successCount":0}\n\n'
                ),
              })
              .mockResolvedValueOnce({ done: true }),
          }),
        },
      })
      .mockResolvedValueOnce(response({}));
    await api.refreshFollowingsStream({}, { onComplete, onItemRemoved });
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        processedCount: 1,
        removedCount: 1,
        successCount: 0,
        total: 1,
      })
    );
    expect(onItemRemoved).toHaveBeenCalledWith('normal+1');
  });
});

export {};
