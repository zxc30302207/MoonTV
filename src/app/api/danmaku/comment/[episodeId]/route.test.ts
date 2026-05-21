/* eslint-disable @typescript-eslint/no-var-requires */

import type { NextRequest } from 'next/server';

const mockGetConfig = jest.fn();

jest.mock('@/lib/config', () => ({
  getConfig: mockGetConfig,
}));

describe('/api/danmaku/comment/[episodeId]', () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfig.mockResolvedValue({
      SiteConfig: {
        DanmakuApiBaseUrl: '',
      },
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
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
      'https://api.dandanplay.net/api/v2/comment/123?format=xml',
      expect.objectContaining({
        headers: {
          Accept: 'application/xml',
        },
      })
    );
    expect(text).toBe('<i></i>');
  });

  it('sanitizes unsupported formats', async () => {
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
      'https://api.dandanplay.net/api/v2/comment/456?format=xml',
      expect.any(Object)
    );
  });
});
