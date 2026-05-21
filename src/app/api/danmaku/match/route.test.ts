/* eslint-disable @typescript-eslint/no-var-requires */

import type { NextRequest } from 'next/server';

const mockGetConfig = jest.fn();

jest.mock('@/lib/config', () => ({
  getConfig: mockGetConfig,
}));

describe('/api/danmaku/match', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env;

  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.DANDANPLAY_APP_ID;
    delete process.env.DANDANPLAY_APP_SECRET;
    mockGetConfig.mockResolvedValue({
      SiteConfig: {
        DanmakuApiBaseUrl: '',
      },
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('proxies match requests to the default danmu upstream', async () => {
    global.fetch = jest.fn(async () => {
      return new Response(JSON.stringify({ matches: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const { POST } = await import('./route');
    const response = await POST(
      new Request('http://localhost/api/danmaku/match', {
        method: 'POST',
        body: JSON.stringify({ fileName: '波波 S01E01 @bilibili1' }),
      }) as unknown as NextRequest
    );
    const json = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://danmu.let.gs/api/v2/match',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ fileName: '波波 S01E01 @bilibili1' }),
      })
    );
    expect(json).toEqual({ matches: [] });
  });

  it('does not require dandanplay credentials for the default upstream', async () => {
    global.fetch = jest.fn(async () => {
      return new Response(JSON.stringify({ matches: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const { POST } = await import('./route');
    const response = await POST(
      new Request('http://localhost/api/danmaku/match', {
        method: 'POST',
        body: JSON.stringify({ fileName: '波波 S01E01' }),
      }) as unknown as NextRequest
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ matches: [] });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://danmu.let.gs/api/v2/match',
      expect.any(Object)
    );
  });

  it('uses a configured upstream when one is saved', async () => {
    mockGetConfig.mockResolvedValue({
      SiteConfig: {
        DanmakuApiBaseUrl: 'https://danmu.example',
      },
    });
    global.fetch = jest.fn(async () => {
      return new Response(JSON.stringify({ data: [] }));
    }) as unknown as typeof fetch;

    const { POST } = await import('./route');
    await POST(
      new Request('http://localhost/api/danmaku/match', {
        method: 'POST',
        body: JSON.stringify({ fileName: '測試 第1集' }),
      }) as unknown as NextRequest
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://danmu.example/api/v2/match',
      expect.any(Object)
    );
  });

  it('preserves token path prefixes in configured upstreams', async () => {
    mockGetConfig.mockResolvedValue({
      SiteConfig: {
        DanmakuApiBaseUrl: 'https://danmu.example/token',
      },
    });
    global.fetch = jest.fn(async () => {
      return new Response(JSON.stringify({ data: [] }));
    }) as unknown as typeof fetch;

    const { POST } = await import('./route');
    await POST(
      new Request('http://localhost/api/danmaku/match', {
        method: 'POST',
        body: JSON.stringify({ fileName: '測試 第1集' }),
      }) as unknown as NextRequest
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://danmu.example/token/api/v2/match',
      expect.any(Object)
    );
  });
});
