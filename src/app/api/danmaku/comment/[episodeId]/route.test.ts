/* eslint-disable @typescript-eslint/no-var-requires */

import type { NextRequest } from 'next/server';

const mockGetConfig = jest.fn();
const mockGetVerifiedAuthInfo = jest.fn();
jest.mock('@/lib/auth-server', () => ({
  getVerifiedAuthInfo: mockGetVerifiedAuthInfo,
}));

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
    mockGetVerifiedAuthInfo.mockResolvedValue({
      username: 'alice',
      role: 'user',
    });
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

  it('rejects revoked users without fetching comments', async () => {
    mockGetVerifiedAuthInfo.mockResolvedValue(null);
    global.fetch = jest.fn();
    const { GET } = await import('./route');
    const response = await GET(
      new Request(
        'http://localhost/api/danmaku/comment/123'
      ) as unknown as NextRequest,
      { params: Promise.resolve({ episodeId: '123' }) }
    );
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('handles oversized upstream comments without rejecting the route promise', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response('<i/>', {
          headers: { 'content-length': String(17 * 1024 * 1024) },
        })
    ) as unknown as typeof fetch;
    const { GET } = await import('./route');
    const response = await GET(
      new Request(
        'http://localhost/api/danmaku/comment/123'
      ) as unknown as NextRequest,
      { params: Promise.resolve({ episodeId: '123' }) }
    );
    expect(response.status).toBe(502);
  });

  it('proxies xml comment requests by episode id', async () => {
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
      'https://danmu.let.gs/api/v2/comment/123?format=xml',
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );
    const headers = (global.fetch as jest.Mock).mock.calls[0][1]
      .headers as Headers;
    expect(headers.get('Accept')).toBe('application/xml');
    expect(text).toBe('<i></i>');
  });

  it('does not require dandanplay credentials for the default upstream', async () => {
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

    expect(response.status).toBe(200);
    expect(text).toBe('<i></i>');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://danmu.let.gs/api/v2/comment/123?format=xml',
      expect.any(Object)
    );
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
