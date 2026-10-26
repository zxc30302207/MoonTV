/* eslint-disable @typescript-eslint/no-var-requires */
const mockRead = jest.fn();
const mockMutate = jest.fn();
const mockAuth = jest.fn();
jest.mock('@/lib/db', () => ({
  db: { readNamespace: mockRead, mutateNamespace: mockMutate },
}));
jest.mock('@/lib/auth-server', () => ({ getVerifiedAuthInfo: mockAuth }));
jest.mock('@/lib/config', () => ({
  getConfig: async () => ({ UserConfig: { Users: [{ username: 'alice' }] } }),
}));
const epoch = '00000000-0000-4000-8000-000000000001';
const operationId = '00000000-0000-4000-8000-000000000002';
beforeAll(() => {
  const { MessageChannel, MessagePort } = require('worker_threads');
  Object.assign(globalThis, { MessageChannel, MessagePort });
  const { Headers, Request, Response } = require('undici');
  Object.assign(globalThis, { Headers, Request, Response });
});
beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ username: 'alice' });
  mockRead.mockResolvedValue({ data: {}, version: { epoch, revision: '7' } });
  mockMutate.mockResolvedValue({
    data: {},
    version: { epoch, revision: '8' },
    duplicate: false,
  });
});
async function route(path: string) {
  if (path === 'playrecords') return import('./playrecords/route');
  if (path === 'favorites') return import('./favorites/route');
  return import('./searchhistory/route');
}
async function request(path: string, headers = true) {
  const { NextRequest } = await import('next/server');
  return new NextRequest(`http://localhost/api/${path}`, {
    headers: headers
      ? {
          'X-MoonTV-Epoch': epoch,
          'X-MoonTV-Revision': '7',
          'X-MoonTV-Operation-Id': operationId,
        }
      : {},
  });
}
test.each([
  ['playrecords', 'pr'],
  ['favorites', 'fav'],
  ['searchhistory', 'sh'],
])(
  '%s GET keeps payload and snapshot headers together',
  async (path, namespace) => {
    const data =
      path === 'searchhistory' ? ['title'] : { 'source+1': { title: 'title' } };
    mockRead.mockResolvedValue({ data, version: { epoch, revision: '7' } });
    const response = await (await route(path)).GET(await request(path));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(data);
    expect(response.headers.get('X-MoonTV-Epoch')).toBe(epoch);
    expect(response.headers.get('X-MoonTV-Revision')).toBe('7');
    expect(mockRead).toHaveBeenCalledWith('alice', namespace);
  }
);
test.each([
  ['playrecords', 'pr'],
  ['favorites', 'fav'],
  ['searchhistory', 'sh'],
])(
  '%s clear is one guarded operation, not a list/delete loop',
  async (path, namespace) => {
    const response = await (await route(path)).DELETE(await request(path));
    expect(response.status).toBe(200);
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith('alice', namespace, {
      action: 'clear',
      version: { epoch, revision: '7' },
      operationId,
    });
  }
);
test.each(['playrecords', 'favorites', 'searchhistory'])(
  '%s rejects legacy writes before storage',
  async (path) => {
    const response = await (
      await route(path)
    ).DELETE(await request(path, false));
    expect(response.status).toBe(428);
    expect(mockMutate).not.toHaveBeenCalled();
  }
);
test.each(['playrecords?key=', 'favorites?key=', 'searchhistory?keyword='])(
  '%s empty identity cannot accidentally clear all data',
  async (path) => {
    const response = await (
      await route(path.split('?')[0])
    ).DELETE(await request(path));
    expect(response.status).toBe(400);
    expect(mockMutate).not.toHaveBeenCalled();
  }
);
test.each(['playrecords', 'favorites', 'searchhistory'])(
  '%s returns conflict instead of an unhandled promise rejection',
  async (path) => {
    const error = new Error('private details');
    error.name = 'NamespaceConflictError';
    mockMutate.mockRejectedValue(error);
    const response = await (await route(path)).DELETE(await request(path));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain('private details');
  }
);
test('does not read or mutate another account when authentication fails', async () => {
  mockAuth.mockResolvedValue(null);
  const routes = await route('playrecords');
  expect((await routes.GET(await request('playrecords'))).status).toBe(401);
  expect((await routes.DELETE(await request('playrecords'))).status).toBe(401);
  expect(mockRead).not.toHaveBeenCalled();
  expect(mockMutate).not.toHaveBeenCalled();
});
export {};
