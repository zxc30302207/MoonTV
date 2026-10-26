/* eslint-disable @typescript-eslint/no-var-requires */
const mockRead = jest.fn();
const mockMutate = jest.fn();
jest.mock('./db', () => ({
  db: { readNamespace: mockRead, mutateNamespace: mockMutate },
}));
const epoch = '00000000-0000-4000-8000-000000000001';
const operationId = '00000000-0000-4000-8000-000000000002';
beforeAll(() => {
  const { MessageChannel, MessagePort } = require('worker_threads');
  Object.assign(globalThis, { MessageChannel, MessagePort });
  const { Headers, Request, Response } = require('undici');
  Object.assign(globalThis, { Headers, Request, Response });
});
beforeEach(() => jest.clearAllMocks());
function request(overrides: Record<string, string> = {}) {
  return {
    headers: new Headers({
      'X-MoonTV-Epoch': epoch,
      'X-MoonTV-Revision': '7',
      'X-MoonTV-Operation-Id': operationId,
      ...overrides,
    }),
  } as never;
}
test('missing precondition fails closed before any write', async () => {
  const { mutateFromRequest } = await import('./mutation-api');
  const response = await mutateFromRequest(
    { headers: new Headers() } as never,
    'alice',
    'pr',
    { action: 'clear' }
  );
  expect(response.status).toBe(428);
  expect(mockMutate).not.toHaveBeenCalled();
});
test.each(['-1', '1.5', 'NaN', '01', '1e3', '100000000000000000000'])(
  'rejects invalid revision %s',
  async (revision) => {
    const { mutateFromRequest } = await import('./mutation-api');
    const response = await mutateFromRequest(
      request({ 'X-MoonTV-Revision': revision }),
      'alice',
      'fav',
      { action: 'clear' }
    );
    expect(response.status).toBe(400);
    expect(mockMutate).not.toHaveBeenCalled();
  }
);
test('passes exact account, namespace, version and operation without refreshing the precondition', async () => {
  const { mutateFromRequest } = await import('./mutation-api');
  mockMutate.mockResolvedValue({
    version: { epoch, revision: '8' },
    duplicate: true,
  });
  const response = await mutateFromRequest(request(), 'alice', 'fav', {
    action: 'delete',
    key: 'source+1',
  });
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockMutate).toHaveBeenCalledWith('alice', 'fav', {
    action: 'delete',
    key: 'source+1',
    version: { epoch, revision: '7' },
    operationId,
  });
  expect(response.headers.get('X-MoonTV-Revision')).toBe('8');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(await response.json()).toEqual({ success: true, duplicate: true });
});
test('returns search-history result from the same mutation snapshot', async () => {
  const { mutateFromRequest } = await import('./mutation-api');
  mockMutate.mockResolvedValue({
    version: { epoch, revision: '8' },
    duplicate: false,
    data: ['word'],
  });
  const response = await mutateFromRequest(request(), 'alice', 'sh', {
    action: 'add',
    key: 'word',
  });
  expect(await response.json()).toEqual(['word']);
  expect(mockRead).not.toHaveBeenCalled();
});
test('distinguishes conflict from unavailable without leaking provider errors', async () => {
  const { namespaceError } = await import('./mutation-api');
  const conflict = new Error('private details');
  conflict.name = 'NamespaceConflictError';
  expect(namespaceError(conflict).status).toBe(409);
  const response = namespaceError(new Error('secret-url'));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('secret-url');
});

export {};
