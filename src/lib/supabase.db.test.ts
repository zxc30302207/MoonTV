import { createClient } from '@supabase/supabase-js';

import { SupabaseStorage } from './supabase.db';
import { Following, TodayUpdatedRecord } from './types';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('./password', () => ({
  hashPassword: async (password: string) => `hash:${password}`,
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
  const rpc = jest.fn();
  const version = {
    epoch: '11111111-1111-4111-8111-111111111111',
    revision: '0',
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
    rpc.mockResolvedValue({ data: { version, data: {} }, error: null });
    (createClient as jest.Mock).mockReturnValue({ from: () => query, rpc });
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
    rpc.mockResolvedValue({
      data: { version, data: { 'normal+1': following } },
      error: null,
    });
    expect(await storage.getFollowing('alice', 'normal+1')).toEqual(following);
    expect(rpc).toHaveBeenCalledWith(
      'moontv_read_namespace',
      expect.objectContaining({
        p_username: 'alice',
        p_namespace: 'followings',
      })
    );
  });

  it('passes usernames literally to the fixed namespace RPC and blocks staged deletion', async () => {
    await storage.getAllFollowings('a_b');
    expect(rpc).toHaveBeenCalledWith(
      'moontv_read_namespace',
      expect.objectContaining({ p_username: 'a_b', p_namespace: 'followings' })
    );
    await expect(storage.deleteUser('a_b')).rejects.toThrow('交易式');
    expect(query.delete).not.toHaveBeenCalled();
    expect(query.like).not.toHaveBeenCalled();
  });

  it('reads complete exports beyond a REST page in one snapshot RPC', async () => {
    const records = Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [
        `normal+${index}`,
        { ...following },
      ])
    );
    rpc.mockResolvedValue({ data: { version, data: records }, error: null });
    expect(Object.keys(await storage.getAllFollowings('alice'))).toHaveLength(
      501
    );
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(query.range).not.toHaveBeenCalled();
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

  it('refresh requires the original namespace snapshot and treats stale versions as conflicts', async () => {
    const next = { ...following, total_episodes: 13 };
    expect(
      await storage.updateFollowingIfUnchanged(
        'alice',
        'normal+1',
        following,
        next
      )
    ).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({
      data: { version, data: { 'normal+1': following } },
      error: null,
    });
    const previous = await storage.getFollowing('alice', 'normal+1');
    if (!previous) throw new Error('fixture missing');
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '40001', message: 'NAMESPACE_CONFLICT' },
    });
    expect(
      await storage.updateFollowingIfUnchanged(
        'alice',
        'normal+1',
        previous,
        next
      )
    ).toBe(false);
    rpc.mockResolvedValueOnce({
      data: {
        version: { ...version, revision: '1' },
        duplicate: false,
        data: {},
      },
      error: null,
    });
    expect(
      await storage.updateFollowingIfUnchanged(
        'alice',
        'normal+1',
        previous,
        next
      )
    ).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith(
      'moontv_mutate_namespace',
      expect.objectContaining({
        p_revision: '0',
        p_epoch: version.epoch,
        p_namespace: 'followings',
        p_action: 'set',
        p_value: next,
      })
    );
    expect(query.upsert).not.toHaveBeenCalled();
    expect(query.update).not.toHaveBeenCalled();
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
    expect(passwords.get('u:alice:pwd')).toEqual({
      hash: 'hash:first',
      revokedBefore: expect.any(Number),
    });
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
