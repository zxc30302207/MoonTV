import { waitFor } from '@testing-library/react';
import { webcrypto } from 'crypto';

const mockAuth = {
  current: { username: 'pending-user' } as { username: string } | null,
};
jest.mock('./auth-client', () => ({
  getCachedAuthInfo: () => mockAuth.current,
  refreshAuthInfo: async () => mockAuth.current,
}));
const ok = (value: unknown): Response =>
  ({
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name === 'X-MoonTV-Epoch'
          ? '11111111-1111-4111-8111-111111111111'
          : name === 'X-MoonTV-Revision'
          ? '1'
          : null,
    },
    json: async () => value,
    clone: () => ok(value),
  } as Response);

describe('client write recovery', () => {
  let api: typeof import('./db.client');
  let pending: typeof import('./pending-writes');
  let fetchMock: jest.Mock;
  beforeEach(async () => {
    Object.defineProperty(global, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
    jest.resetModules();
    localStorage.clear();
    mockAuth.current = { username: 'pending-user' };
    Object.assign(window, { RUNTIME_CONFIG: { STORAGE_TYPE: 'supabase' } });
    global.fetch = fetchMock = jest.fn();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    api = await import('./db.client');
    const versions = await import('./namespace-client');
    for (const path of [
      '/api/favorites',
      '/api/followings',
      '/api/playrecords',
      '/api/searchhistory',
    ])
      versions.observeNamespaceRead(
        'pending-user',
        path,
        ok({}),
        versions.namespaceReadTicket('pending-user', path)
      );
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
  it('retries an unknown clear exactly and acknowledges it without re-clearing current data', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(api.clearAllFavorites()).rejects.toThrow('offline');
    const original = fetchMock.mock.calls[0][1];
    fetchMock.mockResolvedValueOnce(ok({ success: true }));
    expect(await api.retryPendingDatabaseWrites()).toBe(0);
    expect(fetchMock.mock.calls[1][1]).toEqual(original);
  });
  it('lets the user resolve a clear-only conflict without ever replaying clear', async () => {
    fetchMock.mockResolvedValueOnce({ ...ok({}), ok: false, status: 409 });
    await expect(api.clearAllFavorites()).rejects.toMatchObject({
      kind: 'conflict',
    });
    fetchMock.mockResolvedValue(ok({}));
    const confirm = jest.fn(() => true);
    expect(await api.reconfirmPendingDatabaseWrites(confirm)).toBe(0);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === 'DELETE')
    ).toHaveLength(1);
    await api.saveFavorite('s', '1', {
      title: 'New',
      source_name: 'Source',
      year: '2026',
      cover: '',
      total_episodes: 1,
      save_time: 1,
    });
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')
    ).toHaveLength(1);
  });
  it('does not acknowledge a different payload with a colliding local revision', () => {
    const ack = pending.beginWrite('pending-user', '/api/favorites', {
      method: 'POST',
      body: JSON.stringify({ key: 'a+1', favorite: { title: 'Local' } }),
    });
    if (!ack) throw new Error('Expected pending intent');
    pending.acknowledgeWriteRevision(
      'pending-user',
      ack.revision,
      '/api/favorites',
      {
        method: 'POST',
        body: JSON.stringify({ key: 'b+1', favorite: { title: 'Foreign' } }),
      }
    );
    expect(pending.pendingWriteCount('pending-user')).toBe(1);
  });
  it('reads a fresh snapshot instead of displaying a versionless cache on a new session', async () => {
    mockAuth.current = { username: 'fresh-user' };
    localStorage.setItem(
      'moontv_cache_fresh-user',
      JSON.stringify({
        favorites: {
          data: { 's+old': { title: 'Old' } },
          timestamp: Date.now(),
          version: '1.0',
        },
      })
    );
    fetchMock.mockResolvedValueOnce(ok({ 's+fresh': { title: 'Fresh' } }));
    expect(await api.getAllFavorites()).toEqual({
      's+fresh': { title: 'Fresh' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not silently rebase a versionless pending intent after a later GET', async () => {
    mockAuth.current = { username: 'unprimed' };
    const favorite = {
      title: 'Old local',
      source_name: 'Source',
      year: '2026',
      cover: '',
      total_episodes: 1,
      save_time: 1,
    };
    await expect(api.saveFavorite('s', '1', favorite)).rejects.toMatchObject({
      kind: 'snapshot',
    });
    fetchMock.mockResolvedValue(
      ok({ 's+1': { ...favorite, title: 'New remote' } })
    );
    expect(await api.getAllFavorites()).toEqual({ 's+1': favorite });
    await expect(api.saveFavorite('s', '1', favorite)).rejects.toMatchObject({
      kind: 'snapshot',
    });
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')
    ).toHaveLength(0);
    const confirm = jest.fn(() => true);
    expect(await api.reconfirmPendingDatabaseWrites(confirm)).toBe(0);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === 'POST')
    ).toHaveLength(1);
  });
});
