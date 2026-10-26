import { waitFor } from '@testing-library/react';

const mockAuth = {
  current: { username: 'pending-user' } as { username: string } | null,
};
jest.mock('./auth-client', () => ({
  getCachedAuthInfo: () => mockAuth.current,
  refreshAuthInfo: async () => mockAuth.current,
}));
const ok = (value: unknown): Response =>
  ({ ok: true, json: async () => value } as Response);

describe('client write recovery', () => {
  let api: typeof import('./db.client');
  let pending: typeof import('./pending-writes');
  let fetchMock: jest.Mock;
  beforeEach(async () => {
    jest.resetModules();
    localStorage.clear();
    mockAuth.current = { username: 'pending-user' };
    Object.assign(window, { RUNTIME_CONFIG: { STORAGE_TYPE: 'supabase' } });
    global.fetch = fetchMock = jest.fn();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    api = await import('./db.client');
    pending = await import('./pending-writes');
  });
  afterEach(() => jest.restoreAllMocks());
  it('preserves an unacknowledged favorite against remote refresh, then retries only explicitly', async () => {
    const favorite = {
      title: 'Keep me',
      source_name: 'Source',
      year: '2026',
      cover: '',
      total_episodes: 1,
      save_time: 1,
    };
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(api.saveFavorite('source', '1', favorite)).rejects.toThrow(
      'offline'
    );
    expect(pending.pendingWriteCount('pending-user')).toBe(1);
    fetchMock.mockResolvedValue(ok({}));
    expect(await api.getAllFavorites()).toEqual({ 'source+1': favorite });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(
      JSON.parse(localStorage.getItem('moontv_cache_pending-user') || '{}')
        .favorites.data
    ).toEqual({ 'source+1': favorite });
    expect(await api.retryPendingDatabaseWrites()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(pending.pendingWriteCount('pending-user')).toBe(0);
  });
  it('does not retry another account pending writes and clears private intents on logout', async () => {
    pending.beginWrite('pending-user', '/api/favorites?key=s%2B1', {
      method: 'DELETE',
    });
    mockAuth.current = { username: 'other' };
    expect(await api.retryPendingDatabaseWrites()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('moontv:logout'));
    expect(pending.pendingWriteCount('pending-user')).toBe(0);
  });
  it('keeps same-title histories with distinct source/id rather than deleting them', async () => {
    const record = {
      title: 'Shared title',
      source_name: 'Source',
      year: '2026',
      cover: '',
      index: 1,
      total_episodes: 1,
      play_time: 10,
      total_time: 100,
      save_time: 1,
    };
    fetchMock.mockResolvedValue(ok({}));
    await api.savePlayRecord('a', '1', record);
    await api.savePlayRecord('b', '2', { ...record, year: '1990' });
    const cached = JSON.parse(
      localStorage.getItem('moontv_cache_pending-user') || '{}'
    ).playRecords.data;
    expect(Object.keys(cached)).toEqual(['a+1', 'b+2']);
  });
  it('serializes server writes so an older request cannot arrive after a newer acknowledged save', async () => {
    const favorite = {
      title: 'Old',
      source_name: 'Source',
      year: '2026',
      cover: '',
      total_episodes: 1,
      save_time: 1,
    };
    let finishOld!: (response: Response) => void;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          })
      )
      .mockResolvedValue(ok({}));
    const old = api.saveFavorite('source', '1', favorite);
    const newer = api.saveFavorite('source', '1', {
      ...favorite,
      title: 'New',
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    finishOld(ok({}));
    await Promise.all([old, newer]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).favorite.title).toBe(
      'New'
    );
    expect(pending.pendingWriteCount('pending-user')).toBe(0);
  });
});
