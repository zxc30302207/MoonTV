describe('/api/douban/comments', () => {
  it('returns 400 when id is missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/douban/comments?start=0&limit=20')
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing douban ID',
    });
  });
});

export {};
