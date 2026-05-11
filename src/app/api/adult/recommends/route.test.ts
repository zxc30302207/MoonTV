/* eslint-disable @typescript-eslint/no-var-requires */

import type { NextRequest } from 'next/server';

const mockGetConfig = jest.fn();
const mockGetAvailableApiSites = jest.fn();
const mockGetVerifiedAuthInfo = jest.fn();

jest.mock('@/lib/config', () => ({
  ADULT_SOURCE_KEYS: new Set(['dnzzy', 'ckzy']),
  API_CONFIG: {
    search: {
      headers: {
        Accept: 'application/json',
      },
    },
  },
  getAvailableApiSites: mockGetAvailableApiSites,
  getConfig: mockGetConfig,
}));

jest.mock('@/lib/auth-server', () => ({
  getVerifiedAuthInfo: mockGetVerifiedAuthInfo,
}));

describe('/api/adult/recommends', () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetVerifiedAuthInfo.mockResolvedValue({
      username: 'adult-user',
      role: 'user',
    });
    mockGetAvailableApiSites.mockResolvedValue([
      {
        key: 'dnzzy',
        name: 'DNZ資源',
        api: 'https://dnz.example/api',
      },
      {
        key: 'ckzy',
        name: 'CK資源',
        api: 'https://ck.example/api',
      },
      {
        key: 'normal',
        name: '普通源',
        api: 'https://normal.example/api',
      },
    ]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns an empty list when adult access is disabled', async () => {
    mockGetConfig.mockResolvedValue(createConfig(false));

    const { GET } = await import('./route');
    const response = await GET(
      new Request(
        'http://localhost/api/adult/recommends?page=2&limit=12'
      ) as unknown as NextRequest
    );
    const json = await response.json();

    expect(json).toEqual({
      code: 200,
      message: 'Adult recommendations are disabled',
      list: [],
      page: 2,
      limit: 12,
      hasMore: false,
      sources: [],
    });
  });

  it('loads a selected adult source with the requested page', async () => {
    mockGetConfig.mockResolvedValue(createConfig(true));
    global.fetch = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          pagecount: 3,
          list: [
            {
              vod_id: 'abc-1',
              vod_name: 'Example Title',
              vod_pic: 'https://img.example/poster.jpg',
              vod_year: '2026-05-11',
              vod_content: '<p>desc</p>',
            },
          ],
        })
      );
    }) as unknown as typeof fetch;

    const { GET } = await import('./route');
    const response = await GET(
      new Request(
        'http://localhost/api/adult/recommends?source=dnzzy&page=2&limit=3'
      ) as unknown as NextRequest
    );
    const json = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://dnz.example/api?ac=videolist&pg=2',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
        },
      })
    );
    expect(json).toMatchObject({
      code: 200,
      message: 'success',
      page: 2,
      limit: 3,
      hasMore: true,
      adultAuthorized: true,
    });
    expect(json.list).toEqual([
      expect.objectContaining({
        id: 'abc-1',
        title: 'Example Title',
        source: 'dnzzy',
        source_name: 'DNZ資源',
        year: '2026',
        desc: 'desc',
      }),
    ]);
  });

  it('does not fetch adult sources without an adult authorization grant', async () => {
    mockGetConfig.mockResolvedValue({
      ...createConfig(true),
      AdultAuthConfig: {
        cards: [],
        grants: [],
      },
    });
    global.fetch = jest.fn() as unknown as typeof fetch;

    const { GET } = await import('./route');
    const response = await GET(
      new Request(
        'http://localhost/api/adult/recommends'
      ) as unknown as NextRequest
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json).toMatchObject({
      code: 200,
      message: 'Adult authorization required',
      list: [],
      adultAuthorized: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockGetAvailableApiSites).not.toHaveBeenCalled();
  });

  it('round-robins all adult sources and deduplicates source ids', async () => {
    const { fetchAdultRecommendations } = await import(
      '@/lib/adult-recommendations'
    );
    const fetcher = jest.fn(async (url: string) => {
      const isDnz = url.includes('dnz.example');
      return new Response(
        JSON.stringify({
          pagecount: 1,
          list: isDnz
            ? [
                { vod_id: '1', vod_name: 'DNZ 1' },
                { vod_id: '2', vod_name: 'DNZ 2' },
              ]
            : [
                { vod_id: '1', vod_name: 'CK 1' },
                { vod_id: '2', vod_name: 'CK 2' },
              ],
        })
      );
    }) as unknown as typeof fetch;

    const result = await fetchAdultRecommendations(
      [
        {
          key: 'dnzzy',
          name: 'DNZ資源',
          api: 'https://dnz.example/api',
        },
        {
          key: 'ckzy',
          name: 'CK資源',
          api: 'https://ck.example/api',
        },
      ],
      { page: 1, limit: 3 },
      fetcher
    );

    expect(result.list.map((item) => `${item.source}:${item.id}`)).toEqual([
      'dnzzy:1',
      'ckzy:1',
      'dnzzy:2',
    ]);
    expect(result.hasMore).toBe(false);
  });

  it('rotates all-source recommendations by Taipei date seed', async () => {
    const { fetchAdultRecommendations, getDailyAdultRefreshKey } = await import(
      '@/lib/adult-recommendations'
    );
    const sources = [
      {
        key: 'dnzzy',
        name: 'DNZ璩囨簮',
        api: 'https://dnz.example/api',
      },
      {
        key: 'ckzy',
        name: 'CK璩囨簮',
        api: 'https://ck.example/api',
      },
    ];
    const createFetcher = () =>
      jest.fn(async (url: string) => {
        return new Response(
          JSON.stringify({
            pagecount: 10,
            list: [
              {
                vod_id: url,
                vod_name: url,
              },
            ],
          })
        );
      }) as unknown as jest.MockedFunction<typeof fetch>;

    const todayFetcher = createFetcher();
    const tomorrowFetcher = createFetcher();

    await fetchAdultRecommendations(
      sources,
      {
        page: 1,
        limit: 4,
        rotationSeed: '2026-05-11',
        dailyPageWindow: 5,
      },
      todayFetcher
    );
    await fetchAdultRecommendations(
      sources,
      {
        page: 1,
        limit: 4,
        rotationSeed: '2026-05-12',
        dailyPageWindow: 5,
      },
      tomorrowFetcher
    );

    const todayUrls = todayFetcher.mock.calls.map(([url]) => String(url));
    const tomorrowUrls = tomorrowFetcher.mock.calls.map(([url]) => String(url));

    expect(getDailyAdultRefreshKey(new Date('2026-05-10T16:30:00Z'))).toBe(
      '2026-05-11'
    );
    expect(todayUrls).not.toEqual(tomorrowUrls);
    expect(todayUrls.every((url) => /pg=[1-5]$/.test(url))).toBe(true);
    expect(tomorrowUrls.every((url) => /pg=[1-5]$/.test(url))).toBe(true);
  });

  it('keeps loading when a source omits pagecount but returns items', async () => {
    const { fetchAdultRecommendations } = await import(
      '@/lib/adult-recommendations'
    );
    const fetcher = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          list: [{ vod_id: '1', vod_name: 'No Pagecount' }],
        })
      );
    }) as unknown as typeof fetch;

    const result = await fetchAdultRecommendations(
      [
        {
          key: 'dnzzy',
          name: 'DNZ資源',
          api: 'https://dnz.example/api',
        },
      ],
      { page: 5, limit: 3 },
      fetcher
    );

    expect(result.hasMore).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      'https://dnz.example/api?ac=videolist&pg=5',
      expect.any(Object)
    );
  });
});

function createConfig(adultEnabled: boolean) {
  return {
    SiteConfig: {
      DisableYellowFilter: adultEnabled,
    },
    UserConfig: {
      Users: [{ username: 'adult-user', role: 'user' }],
    },
    AdultAuthConfig: {
      cards: [],
      grants: [
        {
          username: 'adult-user',
          cardCode: 'ADULT-TEST',
          grantedAt: 1,
          grantedBy: 'admin',
          expiresAt: Date.now() + 60_000,
        },
      ],
    },
  };
}

export {};
