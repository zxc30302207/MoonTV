import { webcrypto } from 'crypto';

import type * as Client from './namespace-client';

const epoch = '11111111-1111-4111-8111-111111111111';
const path = '/api/favorites';
const options = {
  method: 'POST',
  body: JSON.stringify({
    key: 's+1',
    favorite: { title: 'Local', save_time: 1 },
  }),
};
function response(revision = '0', status = 200, customEpoch = epoch): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name === 'X-MoonTV-Epoch'
          ? customEpoch
          : name === 'X-MoonTV-Revision'
          ? revision
          : null,
    },
  } as Response;
}
describe('versioned browser mutations', () => {
  let client: typeof Client;
  let fetchMock: jest.Mock;
  const check = () => undefined;
  const prime = (username = 'alice', revision = '0') =>
    client.observeNamespaceRead(
      username,
      path,
      response(revision),
      client.namespaceReadTicket(username, path)
    );
  beforeEach(async () => {
    Object.defineProperty(global, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
    jest.resetModules();
    localStorage.clear();
    client = await import('./namespace-client');
    global.fetch = fetchMock = jest.fn();
  });
  afterEach(() => jest.restoreAllMocks());
  it('requires an observed snapshot instead of silently rebasing a cached intent', async () => {
    await expect(
      client.sendNamespaceWrite('alice', path, options, 1, check)
    ).rejects.toMatchObject({ kind: 'snapshot' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sends the observed bigint version and advances only after acknowledgement', async () => {
    prime('alice', '9007199254740993');
    fetchMock
      .mockResolvedValueOnce(response('9007199254740994'))
      .mockResolvedValueOnce(response('9007199254740995'));
    await client.sendNamespaceWrite('alice', path, options, 1, check);
    await client.sendNamespaceWrite('alice', path, options, 2, check);
    expect(fetchMock.mock.calls[0][1].headers['X-MoonTV-Revision']).toBe(
      '9007199254740993'
    );
    expect(fetchMock.mock.calls[1][1].headers['X-MoonTV-Revision']).toBe(
      '9007199254740994'
    );
    expect(
      fetchMock.mock.calls[0][1].headers['X-MoonTV-Operation-Id']
    ).not.toBe(fetchMock.mock.calls[1][1].headers['X-MoonTV-Operation-Id']);
  });
  it('serializes overlapping same-namespace operations and chains own revisions', async () => {
    prime();
    let finish!: (value: Response) => void;
    fetchMock
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        })
      )
      .mockResolvedValueOnce(response('2'));
    const first = client.sendNamespaceWrite('alice', path, options, 1, check);
    const second = client.sendNamespaceWrite('alice', path, options, 2, check);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(response('1'));
    await Promise.all([first, second]);
    expect(fetchMock.mock.calls[1][1].headers['X-MoonTV-Revision']).toBe('1');
  });
  it('does not let a GET that raced a write replace its acknowledged revision', async () => {
    prime();
    const ticket = client.namespaceReadTicket('alice', path);
    fetchMock
      .mockResolvedValueOnce(response('1'))
      .mockResolvedValueOnce(response('2'));
    await client.sendNamespaceWrite('alice', path, options, 1, check);
    client.observeNamespaceRead('alice', path, response('0'), ticket);
    await client.sendNamespaceWrite('alice', path, options, 2, check);
    expect(fetchMock.mock.calls[1][1].headers['X-MoonTV-Revision']).toBe('1');
  });
  it('retains unknown outcome, blocks newer writes, and retries identical metadata', async () => {
    prime();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(
      client.sendNamespaceWrite('alice', path, options, 17, check)
    ).rejects.toThrow('offline');
    const original = fetchMock.mock.calls[0][1];
    await expect(
      client.sendNamespaceWrite(
        'alice',
        path,
        { ...options, body: 'new' },
        18,
        check
      )
    ).rejects.toMatchObject({ kind: 'unknown' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response('1'));
    const acknowledge = jest.fn();
    await client.retryNamespaceWrites('alice', check, acknowledge);
    expect(fetchMock.mock.calls[1][1]).toEqual(original);
    expect(acknowledge).toHaveBeenCalledWith(17, path, options);
    expect(client.namespaceProblems('alice')).toEqual([]);
  });
  it('keeps exact pending operation across reload and isolates accounts', async () => {
    prime();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(
      client.sendNamespaceWrite('alice', path, options, 17, check)
    ).rejects.toThrow();
    const original = fetchMock.mock.calls[0][1];
    jest.resetModules();
    client = await import('./namespace-client');
    global.fetch = fetchMock = jest.fn();
    await client.retryNamespaceWrites('bob', check, jest.fn());
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(response('1'));
    await client.retryNamespaceWrites('alice', check, jest.fn());
    expect(fetchMock.mock.calls[0][1]).toEqual(original);
  });
  it('does not automatically replay or rebase a conflict, including after a newer GET', async () => {
    prime();
    fetchMock.mockResolvedValueOnce(response('1', 409));
    await expect(
      client.sendNamespaceWrite('alice', path, options, 1, check)
    ).rejects.toMatchObject({ kind: 'conflict' });
    prime('alice', '9');
    await client.retryNamespaceWrites('alice', check, jest.fn());
    await expect(
      client.sendNamespaceWrite('alice', path, options, 2, check)
    ).rejects.toMatchObject({ kind: 'conflict' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    client.discardNamespaceConflict('alice', path);
    expect(client.hasNamespaceSnapshot('alice', path)).toBe(false);
  });
  it('does not discard an unknown operation to create a new id', async () => {
    prime();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(
      client.sendNamespaceWrite('alice', path, options, 1, check)
    ).rejects.toThrow();
    expect(() => client.discardNamespaceConflict('alice', path)).toThrow(
      '結果未明'
    );
  });
  it('keeps successful response without version headers unknown', async () => {
    prime();
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 });
    await expect(
      client.sendNamespaceWrite('alice', path, options, 1, check)
    ).rejects.toMatchObject({ kind: 'unknown' });
    expect(client.namespaceProblems('alice')[0].status).toBe('unknown');
  });
  it('never sends a mutation if durable intent storage fails', async () => {
    prime();
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await expect(
      client.sendNamespaceWrite('alice', path, options, 1, check)
    ).rejects.toThrow('quota');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not restore private pending state after logout, even if same username logs in', async () => {
    prime();
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const write = client.sendNamespaceWrite('alice', path, options, 1, check);
    window.dispatchEvent(new Event('moontv:logout'));
    finish(response('1'));
    await expect(write).rejects.toThrow('登入狀態已變更');
    expect(
      Object.keys(localStorage).filter((key) =>
        key.startsWith('moontv_namespace_')
      )
    ).toEqual([]);
    expect(client.namespaceProblems('alice')).toEqual([]);
    expect(client.hasNamespaceSnapshot('alice', path)).toBe(false);
  });
  it('acknowledging one tab operation never erases a different tab pending ledger entry', async () => {
    prime();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(
      client.sendNamespaceWrite('alice', path, options, 1, check)
    ).rejects.toThrow();
    const key = Object.keys(localStorage)[0];
    const original = JSON.parse(localStorage.getItem(key) || '{}');
    const otherId = '22222222-2222-4222-8222-222222222222';
    const otherKey = key.replace(original.operationId, otherId);
    localStorage.setItem(
      otherKey,
      JSON.stringify({
        ...original,
        operationId: otherId,
        intentRevision: 2,
        status: 'conflict',
      })
    );
    fetchMock.mockResolvedValueOnce(response('1'));
    await client.retryNamespaceWrites('alice', check, jest.fn());
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(otherKey)).not.toBeNull();
    expect(client.namespaceProblems('alice')).toHaveLength(1);
  });
  it('ignores forged cached requests outside the same-origin managed namespace', async () => {
    const op = '22222222-2222-4222-8222-222222222222';
    localStorage.setItem(
      `moontv_namespace_v1_alice_${encodeURIComponent(path)}_${op}`,
      JSON.stringify({
        url: 'https://evil.example/api/favorites',
        method: 'POST',
        version: { epoch, revision: '0' },
        operationId: op,
        intentRevision: 1,
        status: 'unknown',
      })
    );
    await client.retryNamespaceWrites('alice', check, jest.fn());
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('cannot attach a newer GET version to an unversioned local intent without confirmation', async () => {
    await expect(
      client.sendNamespaceWrite('alice', path, options, 1, check)
    ).rejects.toMatchObject({ kind: 'snapshot' });
    prime('alice', '5');
    expect(client.hasNamespaceSnapshot('alice', path)).toBe(false);
    await expect(
      client.sendNamespaceWrite('alice', path, options, 2, check)
    ).rejects.toMatchObject({ kind: 'snapshot' });
    expect(fetchMock).not.toHaveBeenCalled();
    client.discardNamespaceConflict('alice', path);
    prime('alice', '5');
    fetchMock.mockResolvedValueOnce(response('6'));
    await client.sendNamespaceWrite('alice', path, options, 3, check);
    expect(fetchMock.mock.calls[0][1].headers['X-MoonTV-Revision']).toBe('5');
  });
  it('retries unknown ledger entries even when an older conflict is present', async () => {
    prime();
    fetchMock.mockResolvedValueOnce(response('1', 409));
    await expect(
      client.sendNamespaceWrite('alice', path, options, 1, check)
    ).rejects.toMatchObject({ kind: 'conflict' });
    const key = Object.keys(localStorage)[0];
    const original = JSON.parse(localStorage.getItem(key) || '{}');
    const otherId = '33333333-3333-4333-8333-333333333333';
    const otherKey = key.replace(original.operationId, otherId);
    localStorage.setItem(
      otherKey,
      JSON.stringify({
        ...original,
        operationId: otherId,
        intentRevision: 2,
        status: 'unknown',
      })
    );
    fetchMock.mockResolvedValueOnce(response('1'));
    await client.retryNamespaceWrites('alice', check, jest.fn());
    expect(fetchMock.mock.calls[1][1].headers['X-MoonTV-Operation-Id']).toBe(
      otherId
    );
    expect(localStorage.getItem(otherKey)).toBeNull();
    expect(localStorage.getItem(key)).not.toBeNull();
  });
  it('does not replay a queued old-session retry after logout and same-name login', async () => {
    prime();
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const write = client.sendNamespaceWrite('alice', path, options, 1, check);
    const retry = client.retryNamespaceWrites('alice', check, jest.fn());
    window.dispatchEvent(new Event('moontv:logout'));
    finish(response('1'));
    await expect(write).rejects.toThrow('登入狀態已變更');
    await expect(retry).rejects.toThrow('登入狀態已變更');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(localStorage).filter((key) =>
        key.startsWith('moontv_namespace_')
      )
    ).toEqual([]);
  });
});
