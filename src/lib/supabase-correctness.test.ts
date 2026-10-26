import { createClient } from '@supabase/supabase-js';

import type { AdminConfig } from './admin.types';
import { cloneConfigSnapshot, ConfigConflictError } from './config-snapshot';
import { verifyPassword } from './password';
import { SupabaseStorage } from './supabase.db';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('./password', () => ({
  hashPassword: async (password: string) => `hash:${password}`,
  normalizePasswordForStorage: async (p: string) => `hash:${p}`,
  verifyPassword: jest.fn(),
}));

const rows = new Map<string, unknown>();
let writes: string[] = [];
const rpc = jest.fn();
function query() {
  let op = 'select';
  let value: unknown;
  let key = '';
  let expected: string | undefined;
  const q = {
    select: () => q,
    update: (row: { value: unknown }) => {
      op = 'update';
      value = row.value;
      return q;
    },
    insert: (row: { key: string; value: unknown }) => {
      op = 'insert';
      key = row.key;
      value = row.value;
      return q;
    },
    upsert: (row: { key: string; value: unknown }) => {
      op = 'upsert';
      key = row.key;
      value = row.value;
      return q;
    },
    eq: (field: string, v: string) => {
      if (field === 'key') key = v;
      else expected = v;
      return q;
    },
    maybeSingle: async () => ({
      data: rows.has(key)
        ? { value: JSON.parse(JSON.stringify(rows.get(key))) }
        : null,
      error: null,
    }),
    then: (resolve: (result: unknown) => unknown) => {
      if (op === 'insert' && rows.has(key))
        return Promise.resolve(resolve({ data: [], error: { code: '23505' } }));
      if (
        op === 'update' &&
        (!rows.has(key) || JSON.stringify(rows.get(key)) !== expected)
      )
        return Promise.resolve(resolve({ data: [], error: null }));
      rows.set(key, JSON.parse(JSON.stringify(value)));
      writes.push(key);
      return Promise.resolve(resolve({ data: [{ key }], error: null }));
    },
  };
  return q;
}

beforeEach(() => {
  rows.clear();
  writes = [];
  jest.clearAllMocks();
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-placeholder';
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for('__MOONTV_SUPABASE_CLIENT__')
  ];
  (createClient as jest.Mock).mockReturnValue({ from: query, rpc });
});

test('stale site update cannot undo a concurrent ban, and snapshots survive spreads/clones', async () => {
  const original = {
    UserConfig: { Users: [{ username: 'alice', banned: false }] },
    SiteConfig: { SiteName: 'old' },
  } as AdminConfig;
  rows.set('admin:config', original);
  const db = new SupabaseStorage();
  const a = cloneConfigSnapshot((await db.getAdminConfig()) as AdminConfig);
  const b = { ...((await db.getAdminConfig()) as AdminConfig) };
  a.UserConfig.Users[0].banned = true;
  await db.setAdminConfig(a);
  b.SiteConfig.SiteName = 'new';
  await expect(db.setAdminConfig(b)).rejects.toBeInstanceOf(
    ConfigConflictError
  );
  expect(
    (rows.get('admin:config') as AdminConfig).UserConfig.Users[0].banned
  ).toBe(true);
  await expect(db.setAdminConfig(original)).rejects.toBeInstanceOf(
    ConfigConflictError
  );
});

test('legacy rehash CAS does not overwrite a new password or resurrect a deletion', async () => {
  for (const concurrent of ['hash:new', null]) {
    rows.set('u:alice:pwd', 'legacy');
    (verifyPassword as jest.Mock).mockImplementationOnce(async () => {
      if (concurrent) rows.set('u:alice:pwd', concurrent);
      else rows.delete('u:alice:pwd');
      return { valid: true, upgradedHash: 'hash:legacy' };
    });
    expect(await new SupabaseStorage().verifyUser('alice', 'legacy')).toBe(
      false
    );
    expect(rows.get('u:alice:pwd')).toBe(concurrent || undefined);
  }
});

test('password change atomically writes cutoff while legacy sessions retain zero cutoff', async () => {
  rows.set('u:alice:pwd', 'legacy');
  const db = new SupabaseStorage();
  expect(await db.getUserSessionNotBefore('alice')).toBe(0);
  const before = Date.now();
  await db.changePassword('alice', 'new');
  expect(rows.get('u:alice:pwd')).toEqual({
    hash: 'hash:new',
    revokedBefore: expect.any(Number),
  });
  expect(await db.getUserSessionNotBefore('alice')).toBeGreaterThanOrEqual(
    before
  );
  expect(await db.getUserPassword('alice')).toBe('hash:new');
  expect(await db.getUserSessionNotBefore('deleted')).toBe(Infinity);
});

test('progress writes only one key, preserving same-title remakes and avoiding full scans', async () => {
  rows.set('u:alice:pr:a+1', { title: 'Same', year: '1990' });
  await new SupabaseStorage().setPlayRecord('alice', 'b+1', {
    title: 'Same',
    year: '2026',
  } as never);
  expect(writes).toEqual(['u:alice:pr:b+1']);
  expect(rows.has('u:alice:pr:a+1')).toBe(true);
});

test('RPC missing/failure never falls back to clearing or retrying restore', async () => {
  rows.set('admin:config', { old: true });
  rpc.mockResolvedValue({
    data: null,
    error: { code: 'PGRST202', message: 'missing' },
  });
  await expect(
    new SupabaseStorage().restoreAllData([
      { key: 'admin:config', value: { new: true } },
    ])
  ).rejects.toThrow('002_atomic_kv');
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(writes).toEqual([]);
  expect(rows.get('admin:config')).toEqual({ old: true });
});

test('generation is opaque and binds same-millisecond re-registration and restored hashes', async () => {
  const db = new SupabaseStorage();
  rows.set('u:alice:pwd', { hash: 'salted:first', revokedBefore: 100 });
  const first = await db.getUserSessionState('alice');
  rows.set('u:alice:pwd', { hash: 'salted:second', revokedBefore: 100 });
  const second = await db.getUserSessionState('alice');
  expect(second.sessionVersion).not.toBe(first.sessionVersion);
  expect(second.sessionVersion).toMatch(/^[0-9a-f]{64}$/);
  rows.set('u:alice:pwd', {
    hash: 'salted:first',
    revokedBefore: 100,
    generation: 'restore-new-nonce',
  });
  expect((await db.getUserSessionState('alice')).sessionVersion).not.toBe(
    first.sessionVersion
  );
  rows.delete('u:alice:pwd');
  expect((await db.getUserSessionState('alice')).exists).toBe(false);
});

test('login receipt binds the verified credential, never a later password reset', async () => {
  rows.set('u:alice:pwd', { hash: 'old', revokedBefore: 100 });
  const db = new SupabaseStorage();
  const original = await db.getUserSessionState('alice');
  (verifyPassword as jest.Mock).mockImplementationOnce(async () => {
    rows.set('u:alice:pwd', { hash: 'new', revokedBefore: 100 });
    return { valid: true };
  });
  const receipt = await db.verifyUserSession('alice', 'old-password');
  expect(receipt.sessionVersion).toBe(original.sessionVersion);
  expect(receipt.sessionVersion).not.toBe(
    (await db.getUserSessionState('alice')).sessionVersion
  );
});

test('atomic delete uses supplied authorization/credential snapshots without adopting a new account', async () => {
  rows.set('admin:config', {
    UserConfig: { Users: [{ username: 'alice', role: 'user' }] },
  });
  rows.set('u:alice:pwd', { hash: 'old', revokedBefore: 100 });
  const db = new SupabaseStorage();
  const credential = await db.getUserCredentialSnapshot('alice');
  const config = await db.getAdminConfig();
  rows.set('u:alice:pwd', { hash: 'new', revokedBefore: 100 });
  rpc.mockResolvedValue({ data: false, error: null });
  await expect(
    db.deleteUserAtomic('alice', config as AdminConfig, credential)
  ).rejects.toBeInstanceOf(ConfigConflictError);
  expect(rpc).toHaveBeenCalledWith(
    'moontv_delete_user',
    expect.objectContaining({ p_expected_credential: credential })
  );
  expect(rows.get('u:alice:pwd')).toEqual({ hash: 'new', revokedBefore: 100 });
});
