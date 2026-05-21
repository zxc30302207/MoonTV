/* eslint-disable @typescript-eslint/no-var-requires */

import type { NextRequest } from 'next/server';

const mockGetConfig = jest.fn();

jest.mock('@/lib/config', () => ({
  getConfig: mockGetConfig,
}));

describe('/api/danmaku/comment/[episodeId]', () => {
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

  it('proxies xml comment requests by episode id', async () => {
    process.env.DANDANPLAY_APP_ID = 'test-app';
    process.env.DANDANPLAY_APP_SECRET = 'test-secret';
    jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    global.fetch = jest.fn(async () => {
      return new Response('<i></i>', {
        headers: { 'content-type': 'application/xml' },
      });
    }) as unknown as typeof fetch;

    const { GET } = await import('./route');
    const response = await GET(
      new Request(
        'http://localhost/api/danmaku/comment/123?format=xml'
      ) as unknown as NextRequest,
      { params: Promise.resolve({ episodeId: '123' }) }
    );
    const text = await response.text();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.dandanplay.net/api/v2/comment/123?format=xml',
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );
    const headers = (global.fetch as jest.Mock).mock.calls[0][1]
      .headers as Headers;
    expect(headers.get('Accept')).toBe('application/xml');
    expect(headers.get('X-AppId')).toBe('test-app');
    expect(headers.get('X-Timestamp')).toBe('1700000000');
    expect(headers.get('X-Signature')).toBeTruthy();
    expect(text).toBe('<i></i>');
  });

  it('returns a clear config error for default dandanplay without credentials', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;

    const { GET } = await import('./route');
    const response = await GET(
      new Request(
        'http://localhost/api/danmaku/comment/123?format=xml'
      ) as unknown as NextRequest,
      { params: Promise.resolve({ episodeId: '123' }) }
    );
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.code).toBe('DANMAKU_UPSTREAM_AUTH_REQUIRED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sanitizes unsupported formats', async () => {
    mockGetConfig.mockResolvedValue({
      SiteConfig: {
        DanmakuApiBaseUrl: 'https://danmu.example/token',
      },
    });
    global.fetch = jest.fn(async () => {
      return new Response('<i></i>');
    }) as unknown as typeof fetch;

    const { GET } = await import('./route');
    await GET(
      new Request(
        'http://localhost/api/danmaku/comment/456?format=html'
      ) as unknown as NextRequest,
      { params: Promise.resolve({ episodeId: '456' }) }
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'https://danmu.example/token/api/v2/comment/456?format=xml',
      expect.any(Object)
    );
  });
});
