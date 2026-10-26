import { createClient } from '@supabase/supabase-js';

import { NamespaceConflictError } from './mutation-protocol';
import { SupabaseStorage } from './supabase.db';
import { PlayRecord } from './types';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
const rpc = jest.fn();
const version = {
  epoch: '11111111-1111-4111-8111-111111111111',
  revision: '0',
};
let storage: SupabaseStorage;
beforeEach(() => {
  rpc.mockReset();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key';
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for('__MOONTV_SUPABASE_CLIENT__')
  ];
  (createClient as jest.Mock).mockReturnValue({ rpc });
  storage = new SupabaseStorage();
});
afterAll(() => {
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for('__MOONTV_SUPABASE_CLIENT__')
  ];
});
it('passes exact client version/id and never retries unknown commit results', async () => {
  rpc.mockResolvedValue({ error: { message: 'network timeout' }, data: null });
  const mutation = {
    version,
    operationId: '22222222-2222-4222-8222-222222222222',
    action: 'set' as const,
    key: 's+1',
    value: { index: 1 },
  };
  await expect(
    storage.mutateNamespace('alice', 'pr', mutation)
  ).rejects.toThrow('network timeout');
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith(
    'moontv_mutate_namespace',
    expect.objectContaining({
      p_epoch: version.epoch,
      p_revision: '0',
      p_operation: mutation.operationId,
      p_is_owner: false,
    })
  );
});
it('maps stale versions to a distinguishable conflict, not a blind fallback', async () => {
  rpc.mockResolvedValue({
    error: { code: '40001', message: 'NAMESPACE_CONFLICT' },
    data: null,
  });
  await expect(
    storage.mutateNamespace('alice', 'fav', {
      version,
      operationId: 'id',
      action: 'clear',
    })
  ).rejects.toBeInstanceOf(NamespaceConflictError);
  expect(rpc).toHaveBeenCalledTimes(1);
});
it('only exact configured environment owner receives credential exemption', async () => {
  const previous = process.env.USERNAME;
  process.env.USERNAME = 'owner';
  try {
    rpc.mockResolvedValue({ error: null, data: { version, data: {} } });
    await storage.readNamespace('owner', 'pr');
    expect(rpc).toHaveBeenLastCalledWith(
      'moontv_read_namespace',
      expect.objectContaining({ p_is_owner: true })
    );
    await storage.readNamespace('owner2', 'pr');
    expect(rpc).toHaveBeenLastCalledWith(
      'moontv_read_namespace',
      expect.objectContaining({ p_is_owner: false })
    );
  } finally {
    if (previous === undefined) delete process.env.USERNAME;
    else process.env.USERNAME = previous;
  }
});
it('maintenance binds the original read to user/namespace/key and consumes a successful token', async () => {
  const a = { title: 'A', index: 1 } as PlayRecord;
  const b = { title: 'B', index: 1 } as PlayRecord;
  rpc.mockResolvedValueOnce({
    error: null,
    data: { version, data: { 's+a': a, 's+b': b } },
  });
  await storage.getAllPlayRecords('alice');
  expect(await storage.updatePlayRecordIfUnchanged('bob', 's+a', a, a)).toBe(
    false
  );
  expect(await storage.updatePlayRecordIfUnchanged('alice', 's+b', a, a)).toBe(
    false
  );
  expect(rpc).toHaveBeenCalledTimes(1);
  rpc.mockResolvedValue({
    error: null,
    data: {
      version: { ...version, revision: '1' },
      data: {},
      duplicate: false,
    },
  });
  expect(
    await storage.updatePlayRecordIfUnchanged('alice', 's+a', a, {
      ...a,
      index: 2,
    })
  ).toBe(true);
  expect(await storage.updatePlayRecordIfUnchanged('alice', 's+a', a, a)).toBe(
    false
  );
  expect(
    await storage.updatePlayRecordIfUnchanged('alice', 's+b', b, {
      ...b,
      index: 2,
    })
  ).toBe(true);
  expect(rpc).toHaveBeenLastCalledWith(
    'moontv_mutate_namespace',
    expect.objectContaining({ p_revision: '1', p_key: 's+b' })
  );
});
it('missing migration and dormant protocol are explicit failures', async () => {
  for (const code of ['55000', 'PGRST202']) {
    rpc.mockResolvedValue({
      error: { code, message: 'not ready' },
      data: null,
    });
    await expect(storage.readNamespace('alice', 'pr')).rejects.toMatchObject({
      code: 'NAMESPACE_UNAVAILABLE',
    });
  }
});
it('staged destructive legacy operations refuse before any database call', async () => {
  await expect(storage.deleteUser('alice')).rejects.toThrow('交易式');
  await expect(storage.clearAllData()).rejects.toThrow('交易式');
  expect(rpc).not.toHaveBeenCalled();
});
