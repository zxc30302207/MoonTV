/* eslint-disable @typescript-eslint/no-var-requires */
const mockConfig = jest.fn();
jest.mock('@/lib/config', () => ({ getConfig: mockConfig }));

describe('TVBox categories upstream compatibility', () => {
  const originalEnv = { ...process.env };
  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';
    process.env.PASSWORD = 'test-password';
    delete process.env.TVBOX_ALLOW_QUERY_PASSWORD;
    mockConfig.mockResolvedValue({ SiteConfig: {}, CustomCategories: [] });
    global.fetch = jest.fn();
  });
  afterAll(() => {
    process.env = originalEnv;
  });
  it('does not grant access using an implicit server password', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://site.example/api/tvbox/categories')
    );
    expect(response.status).toBe(401);
  });
  it('retains query-password opt-in', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://site.example/api/tvbox/categories?pwd=test-password')
    );
    expect(response.status).toBe(401);
  });
  it('normalizes malformed upstream items without losing private caching', async () => {
    (fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({ list: [null, 3, { id: 1, title: '影片' }] })
      )
    );
    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://site.example/api/tvbox/categories?t=1', {
        headers: { 'x-tvbox-password': 'test-password' },
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await response.json()).list).toEqual([
      {
        vod_id: '1',
        vod_name: '影片',
        vod_pic: '',
        vod_year: '',
        vod_remarks: '',
      },
    ]);
  });
});
