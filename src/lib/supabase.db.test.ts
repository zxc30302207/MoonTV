import { createClient } from '@supabase/supabase-js';

import { SupabaseStorage } from './supabase.db';
import { Following, TodayUpdatedRecord } from './types';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('./password', () => ({
  normalizePasswordForStorage: jest.fn(
    async (password: string) => `hash:${password}`
  ),
}));

const following: Following = {
  title: 'Test',
  source_name: 'Normal',
  year: '2026',
  cover: '',
  search_title: 'Test',
  total_episodes: 12,
  watched_episodes: 3,
  save_time: 1,
};

const today: TodayUpdatedRecord = { date: '2026-10-06', items: [] };

describe('Supabase following persistence', () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let updatedRows: Array<{ key: string }> = [];
  const query = {
    select: jest.fn(),
    update: jest.fn(),
    eq: jest.fn(),
    like: jest.fn(),
    order: jest.fn(),
    delete: jest.fn(),
    upsert: jest.fn(),
    insert: jest.fn(),
    range: jest.fn(),
    maybeSingle: jest.fn(),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(resolve({ error: null, data: updatedRows })),
  };
  let storage: SupabaseStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    delete (globalThis as Record<symbol, unknown>)[
      Symbol.for('__MOONTV_SUPABASE_CLIENT__')
    ];
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-placeholder';
    for (const method of [
      query.select,
      query.eq,
      query.like,
      query.order,
      query.delete,
    ])
      method.mockReturnValue(query);
    updatedRows = [];
    query.update.mockReturnValue(query);
    query.upsert.mockResolvedValue({ error: null });
    query.range.mockResolvedValue({ data: [], error: null });
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    (createClient as jest.Mock).mockReturnValue({ from: () => query });
    storage = new SupabaseStorage();
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalSecret === undefined)
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalSecret;
    delete (globalThis as Record<symbol, unknown>)[
      Symbol.for('__MOONTV_SUPABASE_CLIENT__')
    ];
  });

  it('uses distinct per-user keys for following and today-updated records', async () => {
    await storage.setFollowing('alice', 'normal+1', following);
    await storage.setTodayUpdated('bob', today);
    expect(query.upsert.mock.calls[0][0]).toMatchObject({
      key: 'u:alice:following:normal+1',
      value: following,
    });
    expect(query.upsert.mock.calls[1][0]).toMatchObject({
      key: 'u:bob:today-updated',
      value: today,
    });
    query.maybeSingle.mockResolvedValue({
      data: { value: following },
      error: null,
    });
    expect(await storage.getFollowing('alice', 'normal+1')).toEqual(following);
    expect(query.eq).toHaveBeenCalledWith('key', 'u:alice:following:normal+1');
  });

  it('escapes underscores in list/delete prefixes so usernames cannot match others', async () => {
    await storage.getAllFollowings('a_b');
    await storage.deleteUser('a_b');
    expect(query.like).toHaveBeenCalledWith('key', 'u:a\\_b:following:%');
    expect(query.eq).toHaveBeenCalledWith('key', 'u:a_b:today-updated');
  });

  it('paginates complete exports beyond a single Supabase page', async () => {
    const page = Array.from({ length: 500 }, (_, index) => ({
      key: `u:alice:following:normal+${index}`,
      value: following,
    }));
    query.range
      .mockResolvedValueOnce({ data: page, error: null })
      .mockResolvedValueOnce({
        data: [{ key: 'u:alice:following:normal+500', value: following }],
        error: null,
      });
    expect(Object.keys(await storage.getAllFollowings('alice'))).toHaveLength(
      501
    );
    expect(query.range).toHaveBeenNthCalledWith(2, 500, 999);
  });

  it('imports followings in bounded batches and reports persisted progress', async () => {
    const entries: Array<[string, Following]> = Array.from(
      { length: 101 },
      (_, index) => [`normal+${index}`, following]
    );
    const progress = jest.fn();
    await storage.batchImportFollowings('alice', entries, progress);
    expect(query.upsert.mock.calls.map(([rows]) => rows.length)).toEqual([
      100, 1,
    ]);
    expect(progress.mock.calls).toEqual([
      [100, 101],
      [101, 101],
    ]);
  });

  it('updates only an existing row whose value still matches, without an upsert', async () => {
    const next = { ...following, total_episodes: 13 };
    expect(
      await storage.updateFollowingIfUnchanged(
        'alice',
        'normal+1',
        following,
        next
      )
    ).toBe(false);
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({ value: next })
    );
    expect(query.eq).toHaveBeenCalledWith('key', 'u:alice:following:normal+1');
    expect(query.eq).toHaveBeenCalledWith('value', JSON.stringify(following));
    expect(query.upsert).not.toHaveBeenCalled();
    updatedRows = [{ key: 'u:alice:following:normal+1' }];
    expect(
      await storage.updateFollowingIfUnchanged(
        'alice',
        'normal+1',
        following,
        next
      )
    ).toBe(true);
  });

  it('inserts passwords once so competing registrations cannot overwrite the winner', async () => {
    const passwords = new Map<string, string>();
    query.insert.mockImplementation(
      async (row: { key: string; value: string }) => {
        if (passwords.has(row.key)) return { error: { code: '23505' } };
        passwords.set(row.key, row.value);
        return { error: null };
      }
    );
    const results = await Promise.allSettled([
      storage.registerUser('alice', 'first'),
      storage.registerUser('alice', 'second'),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(passwords.get('u:alice:pwd')).toBe('hash:first');
    expect(query.upsert).not.toHaveBeenCalled();
  });

  it('retries heartbeats against the latest config without reverting concurrent settings', async () => {
    const original = {
      UserConfig: { Users: [{ username: 'alice', banned: false }] },
      SiteConfig: { SiteName: 'old' },
    };
    const edited = { ...original, SiteConfig: { SiteName: 'new' } };
    query.maybeSingle
      .mockResolvedValueOnce({ data: { value: original }, error: null })
      .mockResolvedValueOnce({ data: { value: edited }, error: null });
    query.select.mockImplementation(() => {
      if (query.update.mock.calls.length === 2)
        updatedRows = [{ key: 'admin:config' }];
      return query;
    });
    expect(await storage.updateUserLastOnline('alice', 100)).toBe(true);
    expect(query.update).toHaveBeenCalledTimes(2);
    expect(query.eq).toHaveBeenCalledWith('value', JSON.stringify(original));
    expect(query.eq).toHaveBeenCalledWith('value', JSON.stringify(edited));
    expect(query.update.mock.calls[1][0].value).toEqual({
      ...edited,
      UserConfig: {
        Users: [{ username: 'alice', banned: false, lastOnline: 100 }],
      },
    });
    expect(original.UserConfig.Users[0]).not.toHaveProperty('lastOnline');
    expect(query.upsert).not.toHaveBeenCalled();
  });

  it('preserves another registration when appending a user races on admin config', async () => {
    const original = {
      UserConfig: { AllowRegister: true, Users: [] },
      SiteConfig: { SiteName: 'site' },
    };
    const withBob = {
      ...original,
      UserConfig: {
        AllowRegister: true,
        Users: [{ username: 'bob', role: 'user' }],
      },
    };
    query.maybeSingle
      .mockResolvedValueOnce({ data: { value: original }, error: null })
      .mockResolvedValueOnce({ data: { value: withBob }, error: null });
    query.select.mockImplementation(() => {
      if (query.update.mock.calls.length === 2)
        updatedRows = [{ key: 'admin:config' }];
      return query;
    });
    const config = await storage.appendRegisteredUser('alice');
    expect(config.UserConfig.Users.map((user) => user.username)).toEqual([
      'bob',
      'alice',
    ]);
    expect(query.eq).toHaveBeenCalledWith('value', JSON.stringify(withBob));
    expect(query.upsert).not.toHaveBeenCalled();
  });

  it('does not append after registration closes or overwrite an existing configured user', async () => {
    query.maybeSingle.mockResolvedValue({
      data: { value: { UserConfig: { AllowRegister: false, Users: [] } } },
      error: null,
    });
    await expect(storage.appendRegisteredUser('alice')).rejects.toThrow(
      'closed'
    );
    query.maybeSingle.mockResolvedValue({
      data: {
        value: {
          UserConfig: {
            AllowRegister: true,
            Users: [{ username: 'alice', role: 'admin' }],
          },
        },
      },
      error: null,
    });
    await expect(storage.appendRegisteredUser('alice')).rejects.toThrow(
      'already configured'
    );
    expect(query.update).not.toHaveBeenCalled();
  });

  it('preserves legacy env-enabled registration when the stored flag is absent', async () => {
    const previousEnv = process.env.NEXT_PUBLIC_ENABLE_REGISTER;
    process.env.NEXT_PUBLIC_ENABLE_REGISTER = 'true';
    try {
      query.maybeSingle.mockResolvedValue({
        data: { value: { UserConfig: { Users: [] } } },
        error: null,
      });
      updatedRows = [{ key: 'admin:config' }];
      expect(
        (await storage.appendRegisteredUser('alice')).UserConfig.Users[0]
          .username
      ).toBe('alice');
    } finally {
      if (previousEnv === undefined)
        delete process.env.NEXT_PUBLIC_ENABLE_REGISTER;
      else process.env.NEXT_PUBLIC_ENABLE_REGISTER = previousEnv;
    }
  });

  it('does not undo a ban committed between heartbeat read and write', async () => {
    query.maybeSingle
      .mockResolvedValueOnce({
        data: { value: { UserConfig: { Users: [{ username: 'alice' }] } } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          value: {
            UserConfig: { Users: [{ username: 'alice', banned: true }] },
          },
        },
        error: null,
      });
    expect(await storage.updateUserLastOnline('alice', 100)).toBe(false);
    expect(query.update).toHaveBeenCalledTimes(1);
    expect(query.upsert).not.toHaveBeenCalled();
  });

  it('does not recreate a deleted config/user and bounds contention retries', async () => {
    expect(await storage.updateUserLastOnline('alice', 100)).toBe(false);
    expect(query.update).not.toHaveBeenCalled();
    query.maybeSingle.mockResolvedValue({
      data: {
        value: {
          UserConfig: { Users: [{ username: 'alice', lastOnline: 200 }] },
        },
      },
      error: null,
    });
    await expect(storage.updateUserLastOnline('alice', 100)).rejects.toThrow(
      'Concurrent'
    );
    expect(query.update).toHaveBeenCalledTimes(5);
    expect(
      query.update.mock.calls[0][0].value.UserConfig.Users[0].lastOnline
    ).toBe(200);
  });

  it('preserves search-history order in a single write', async () => {
    await storage.batchImportSearchHistory('alice', ['new', 'old', 'new']);
    expect(query.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'u:alice:sh', value: ['new', 'old'] }),
      { onConflict: 'key' }
    );
  });
});
