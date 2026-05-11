/* eslint-disable @typescript-eslint/no-var-requires */

const mockGetConfig = jest.fn();
const mockGetAvailableApiSites = jest.fn();
const mockGetCacheTime = jest.fn();

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
  getCacheTime: mockGetCacheTime,
  getConfig: mockGetConfig,
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
    mockGetCacheTime.mockResolvedValue(60);
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
    mockGetConfig.mockResolvedValue({
      SiteConfig: {
        DisableYellowFilter: false,
      },
    });

    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/adult/recommends?page=2&limit=12')
    );
    const json = await response.json();

    expect(json).toEqual({
      code: 200,
      message: 'Adult recommendations are disabled',
      list: [],
      page: 2,
      limit: 12,
      hasMore: false,
      sources: [
        { key: 'dnzzy', name: 'DNZ資源' },
        { key: 'ckzy', name: 'CK資源' },
      ],
    });
  });

  it('loads a selected adult source with the requested page', async () => {
    mockGetConfig.mockResolvedValue({
      SiteConfig: {
        DisableYellowFilter: true,
      },
    });
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
      )
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

export {};
