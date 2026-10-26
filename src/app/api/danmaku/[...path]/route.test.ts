/* eslint-disable @typescript-eslint/no-var-requires */
const mockAuth = jest.fn();
jest.mock('@/lib/auth-server', () => ({
  getVerifiedAuthInfo: mockAuth,
}));
jest.mock('@/lib/danmaku.server', () => ({
  buildDanmakuUpstreamHeaders: () => ({ 'x-test': 'signed' }),
  buildDanmakuUpstreamUrl: (_base: string, path: string, search: string) =>
    `https://danmu.example${path}${search}`,
  getDanmakuUpstreamBaseUrl: async () => 'https://danmu.example',
  getDanmakuUpstreamConfigError: () => null,
}));
beforeAll(() => {
  const { MessageChannel, MessagePort } = require('worker_threads');
  Object.assign(globalThis, { MessageChannel, MessagePort });
  const { Headers, Request, Response } = require('undici');
  const { ReadableStream } = require('stream/web');
  Object.assign(globalThis, { Headers, Request, Response, ReadableStream });
});
beforeEach(() => {
  jest.resetAllMocks();
  mockAuth.mockResolvedValue({ username: 'alice' });
  global.fetch = jest.fn().mockResolvedValue(new Response('{}'));
});
async function get(path: string[]) {
  const { GET } = await import('./route');
  return GET(
    new Request(`https://site.example/api/danmaku/${path.join('/')}`) as never,
    { params: Promise.resolve({ path }) }
  );
}
test('does not forward unapproved v2 write/admin endpoints', async () => {
  expect((await get(['api', 'v2', 'user', 'delete'])).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
test('revoked users cannot consume authenticated proxy resources', async () => {
  mockAuth.mockResolvedValue(null);
  expect((await get(['api', 'v2', 'comment', '123'])).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
test('known search routes retain signed upstream headers', async () => {
  expect((await get(['api', 'v2', 'search', 'anime'])).status).toBe(200);
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v2/search/anime'),
    expect.objectContaining({ headers: { 'x-test': 'signed' } })
  );
});
test('oversized async upstream body is caught and mapped to a bounded failure', async () => {
  (fetch as jest.Mock).mockResolvedValue(
    new Response('x', {
      headers: { 'content-length': String(17 * 1024 * 1024) },
    })
  );
  const response = await get(['api', 'v2', 'comment', '123']);
  expect(response.status).toBe(502);
  expect(await response.json()).toHaveProperty('error');
});
