/* eslint-disable @typescript-eslint/no-var-requires */
const mockSafeFetch = jest.fn();
const mockAuth = jest.fn();
const mockConfig = jest.fn();
jest.mock('@/lib/url-safety', () => ({ safeFetch: mockSafeFetch }));
jest.mock('@/lib/auth-server', () => ({ getVerifiedAuthInfo: mockAuth }));
jest.mock('@/lib/config', () => ({ getConfig: mockConfig }));

describe('Bangumi calendar proxy', () => {
  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ username: 'user', role: 'user' });
    mockConfig.mockResolvedValue({
      SiteConfig: {
        BangumiProxy: 'https://proxy.example',
        BangumiImageProxy: 'https://images.example',
      },
    });
  });

  it('requires verified authorization before fetching', async () => {
    mockAuth.mockResolvedValue(null);
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    const response = await GET(
      new NextRequest('https://site.example/api/bangumi/calendar')
    );
    expect(response.status).toBe(401);
    expect(mockConfig).not.toHaveBeenCalled();
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it('uses safeFetch and survives null images or incomplete image sizes', async () => {
    mockSafeFetch.mockResolvedValue(
      new Response(
        JSON.stringify([
          null,
          {
            weekday: { en: 'Monday' },
            items: [
              null,
              { id: 1, images: null },
              { id: 2, images: { large: 'https://lain.bgm.tv/pic/a.jpg' } },
            ],
          },
        ])
      )
    );
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    const response = await GET(
      new NextRequest('https://site.example/api/bangumi/calendar')
    );
    const data = await response.json();
    expect(data).toHaveLength(1);
    expect(data[0].items).toHaveLength(1);
    expect(data[0].items[0].images.large).toBe(
      'https://images.example/pic/a.jpg'
    );
    expect(data[0].items[0].images.small).toBe('');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mockSafeFetch).toHaveBeenCalledWith(
      'https://proxy.example/calendar',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('falls back to official calendar if the configured proxy is blocked', async () => {
    mockSafeFetch
      .mockRejectedValueOnce(new Error('private address blocked'))
      .mockResolvedValueOnce(new Response('[]'));
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    const response = await GET(
      new NextRequest('https://site.example/api/bangumi/calendar')
    );
    expect(response.status).toBe(200);
    expect(mockSafeFetch.mock.calls[1][0]).toBe('https://api.bgm.tv/calendar');
  });
});

export {};
