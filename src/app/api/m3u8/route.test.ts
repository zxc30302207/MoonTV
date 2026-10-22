/* eslint-disable @typescript-eslint/no-var-requires */

const mockSafeFetch = jest.fn();
const mockParseM3U8 = jest.fn();
jest.mock('@/lib/m3u8-downloader', () => ({ parseM3U8: mockParseM3U8 }));
jest.mock('@/lib/url-safety', () => ({
  assertSafeUrl: jest.fn((input: string) => new URL(input)),
  assertSafeResolvedUrl: jest.fn(),
  parseAllowedHosts: jest.fn(),
  safeFetch: mockSafeFetch,
}));
jest.mock('@/lib/rate-limit', () => ({
  getClientIp: () => 'test',
  rateLimit: () => ({ allowed: true }),
  getRateLimitHeaders: () => ({}),
}));

describe('m3u8 streamed proxy', () => {
  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });
  beforeEach(() => jest.clearAllMocks());

  it('streams validated ranges through the DNS-safe fetcher without public caching', async () => {
    const upstream = new Response('abcd', {
      status: 206,
      headers: { 'Content-Range': 'bytes 4-7/12', 'Content-Length': '4' },
    });
    Object.defineProperty(upstream, 'url', {
      value: 'https://cdn.example/final.ts',
    });
    mockSafeFetch.mockResolvedValue(upstream);
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    const request = new NextRequest(
      'https://site.example/api/m3u8?url=https://cdn.example/a.ts',
      {
        headers: { Range: 'bytes=4-7' },
      }
    );
    const response = await GET(request);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 4-7/12');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-MoonTV-Upstream-URL')).toBe(
      'https://cdn.example/final.ts'
    );
    expect(mockSafeFetch.mock.calls[0][1]).toMatchObject({
      signal: request.signal,
      headers: { Range: 'bytes=4-7', 'Accept-Encoding': 'identity' },
    });
    expect(await response.text()).toBe('abcd');
  });

  it.each(['bytes=8-4', 'bytes=0-1,4-5', 'bytes=0-9007199254740992'])(
    'rejects malformed range %s before fetching',
    async (range) => {
      const { GET } = await import('./route');
      const { NextRequest } = await import('next/server');
      const response = await GET(
        new NextRequest(
          'https://site.example/api/m3u8?url=https://cdn.example/a.ts',
          { headers: { Range: range } }
        )
      );
      expect(response.status).toBe(400);
      expect(mockSafeFetch).not.toHaveBeenCalled();
    }
  );

  it('does not serve upstream active content on the application origin', async () => {
    mockSafeFetch.mockResolvedValue(
      new Response('<script>alert(1)</script>', {
        headers: {
          'Content-Type': 'text/html',
          'Content-Encoding': 'gzip',
          'Content-Length': '99',
        },
      })
    );
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    const response = await GET(
      new NextRequest(
        'https://site.example/api/m3u8?url=https://cdn.example/a.ts'
      )
    );
    expect(response.headers.get('Content-Type')).toBe(
      'application/octet-stream'
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Length')).toBeNull();
  });

  it('preserves upstream 416 rather than returning corrupted data as 200', async () => {
    mockSafeFetch.mockResolvedValue(
      new Response(null, {
        status: 416,
        headers: { 'Content-Range': 'bytes */12' },
      })
    );
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    const response = await GET(
      new NextRequest(
        'https://site.example/api/m3u8?url=https://cdn.example/a.ts',
        { headers: { Range: 'bytes=20-30' } }
      )
    );
    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe('bytes */12');
  });
});

export {};
