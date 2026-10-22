import {
  clearAuthInfoCache,
  clearPrivateClientState,
  getCachedAuthInfo,
  refreshAuthInfo,
} from './auth-client';

const mockStop = jest.fn(async (): Promise<void> => undefined);
const mockClear = jest.fn(async (): Promise<void> => undefined);
jest.mock('./video-prefetcher', () => ({
  getVideoPrefetcher: () => ({ stopAndWait: mockStop }),
  getNextEpisodePrefetcher: () => ({ stopAndWait: mockStop }),
}));
jest.mock('./video-cache', () => ({ clearVideoCache: () => mockClear() }));

describe('private session cleanup', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearAuthInfoCache();
    jest.clearAllMocks();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('ignores an authentication response that arrives after logout', async () => {
    let complete: (value: unknown) => void = () => undefined;
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    ) as jest.Mock;
    const request = refreshAuthInfo();
    await clearPrivateClientState();
    complete({
      ok: true,
      json: async () => ({ user: { username: 'old-user', role: 'user' } }),
    });
    await expect(request).resolves.toBeNull();
    expect(getCachedAuthInfo()).toBeNull();
  });
  it('waits for both prefetch queues to finish pending writes before clearing media', async () => {
    let finishCurrent!: () => void;
    let finishNext!: () => void;
    mockStop.mockImplementationOnce(() => new Promise<void>((resolve) => { finishCurrent = resolve; }));
    mockStop.mockImplementationOnce(() => new Promise<void>((resolve) => { finishNext = resolve; }));
    const cleanup = clearPrivateClientState();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(mockStop).toHaveBeenCalledTimes(2);
    expect(mockClear).not.toHaveBeenCalled();
    finishCurrent();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(mockClear).not.toHaveBeenCalled();
    finishNext();
    await cleanup;
    expect(mockClear).toHaveBeenCalledTimes(1);
  });
  it('clears private viewing state while retaining display preferences', async () => {
    localStorage.setItem('moontv_cache_alice_followings', '{}');
    localStorage.setItem('danmakuSource:movie', '{}');
    localStorage.setItem('downloadTaskStates', '{}');
    localStorage.setItem('danmaku_settings', '{"fontSize":25}');
    localStorage.setItem('video_cache_settings', '{"enabled":false}');
    const event = jest.fn();
    window.addEventListener('moontv:logout', event);
    await clearPrivateClientState();
    expect(localStorage.getItem('moontv_cache_alice_followings')).toBeNull();
    expect(localStorage.getItem('danmakuSource:movie')).toBeNull();
    expect(localStorage.getItem('downloadTaskStates')).toBeNull();
    expect(localStorage.getItem('danmaku_settings')).not.toBeNull();
    expect(localStorage.getItem('video_cache_settings')).not.toBeNull();
    expect(event).toHaveBeenCalledTimes(1);
    expect(mockStop).toHaveBeenCalledTimes(2);
    expect(mockClear).toHaveBeenCalledTimes(1);
    window.removeEventListener('moontv:logout', event);
  });
});
