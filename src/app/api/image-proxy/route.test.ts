/* eslint-disable @typescript-eslint/no-var-requires */

const mockSafeFetch = jest.fn();
jest.mock('@/lib/url-safety', () => ({
  parseAllowedHosts: jest.fn(),
  safeFetch: mockSafeFetch,
}));
jest.mock('@/lib/rate-limit', () => ({
  getClientIp: () => 'test',
  rateLimit: () => ({ allowed: true }),
  getRateLimitHeaders: () => ({}),
}));

describe('image proxy content safety', () => {
  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });
  beforeEach(() => jest.clearAllMocks());

  it.each([
    'image/svg+xml',
    'IMAGE/SVG+XML; charset=utf-8',
    'text/html',
    'image/unknown',
  ])(
    'rejects active or unknown content type %s and cancels its body',
    async (contentType) => {
      const upstream = new Response('<svg onload="alert(1)"/>', {
        headers: { 'Content-Type': contentType },
      });
      if (!upstream.body) throw new Error('Expected upstream body');
      const cancel = jest.spyOn(upstream.body, 'cancel');
      mockSafeFetch.mockResolvedValue(upstream);
      const { GET } = await import('./route');
      const response = await GET(
        new Request(
          'https://site.example/api/image-proxy?url=https://cdn.example/image.png'
        )
      );
      expect(response.status).toBe(400);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(response.headers.get('Content-Type')).toContain(
        'application/json'
      );
    }
  );

  it.each([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/avif',
    'IMAGE/PNG; charset=utf-8',
  ])(
    'streams legitimate raster content %s with security headers',
    async (contentType) => {
      mockSafeFetch.mockResolvedValue(
        new Response('raster bytes', {
          headers: { 'Content-Type': contentType },
        })
      );
      const { GET } = await import('./route');
      const response = await GET(
        new Request(
          'https://site.example/api/image-proxy?url=https://cdn.example/image'
        )
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe(
        contentType.split(';')[0].toLowerCase()
      );
      expect(response.headers.get('Content-Security-Policy')).toBe(
        "sandbox; default-src 'none'"
      );
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(await response.text()).toBe('raster bytes');
    }
  );
});

export {};
