/* eslint-disable @typescript-eslint/no-var-requires */

const mockGetAvailableApiSites = jest.fn();
const mockGetDetailFromApi = jest.fn();
const mockGetVerifiedAuthInfo = jest.fn();
const mockFetchBangumiSubjectDetail = jest.fn();
const mockFetchDoubanData = jest.fn();
const mockSearchFromApiStream = jest.fn();

jest.mock('@/lib/bangumi', () => ({
  fetchBangumiSubjectDetail: mockFetchBangumiSubjectDetail,
}));
jest.mock('@/lib/douban', () => ({ fetchDoubanData: mockFetchDoubanData }));

jest.mock('@/lib/auth-server', () => ({
  getVerifiedAuthInfo: mockGetVerifiedAuthInfo,
}));

jest.mock('@/lib/config', () => ({
  getAvailableApiSites: mockGetAvailableApiSites,
}));

jest.mock('@/lib/downstream', () => ({
  getDetailFromApi: mockGetDetailFromApi,
  searchFromApiStream: mockSearchFromApiStream,
}));

describe('/api/detail', () => {
  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetVerifiedAuthInfo.mockResolvedValue({
      username: 'alice',
      role: 'user',
      timestamp: Date.now(),
    });
    mockGetAvailableApiSites.mockResolvedValue([
      {
        key: 'ffzynew',
        name: '非凡影視新接口',
        api: 'https://api.ffzyapi.com/api.php/provide/vod',
      },
    ]);
    mockGetDetailFromApi.mockResolvedValue({
      id: '97846',
      title: '鐵拳教育',
      poster: '',
      episodes: [
        'https://vip.ffzy-online3.com/share/023f6fecc6b88ffa0b732dd682093b80',
        'https://vip.ffzy-online3.com/20260605/45062_023f6fec/index.m3u8',
      ],
      episodes_titles: ['第01集 share', '第01集'],
      source: 'ffzynew',
      source_name: '非凡影視新接口',
      year: '2026',
    });
  });

  it.each(['vod', 'douban', 'bangumi'])(
    'requires signed login for %s descriptions',
    async (provider) => {
      mockGetVerifiedAuthInfo.mockResolvedValue(null);
      const { GET } = await import('./route');
      const response = await GET(
        new Request(
          `http://localhost/api/detail?provider=${provider}&fields=desc&id=1&source=ffzynew`
        ) as never
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(mockFetchDoubanData).not.toHaveBeenCalled();
      expect(mockFetchBangumiSubjectDetail).not.toHaveBeenCalled();
      expect(mockGetAvailableApiSites).not.toHaveBeenCalled();
    }
  );

  it.each(['douban', 'bangumi'])(
    'returns %s descriptions without shared caching',
    async (provider) => {
      mockFetchDoubanData.mockResolvedValue({ intro: '簡介' });
      mockFetchBangumiSubjectDetail.mockResolvedValue({ summary: '簡介' });
      const { GET } = await import('./route');
      const response = await GET(
        new Request(
          `http://localhost/api/detail?provider=${provider}&fields=desc&id=1`
        ) as never
      );
      expect(await response.json()).toEqual({ desc: '簡介' });
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Vary')).toBe('Cookie');
      expect(response.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
    }
  );

  it('checks user source access before description lookup', async () => {
    mockGetAvailableApiSites.mockResolvedValue([]);
    const { GET } = await import('./route');
    const response = await GET(
      new Request(
        'http://localhost/api/detail?fields=desc&id=1&source=blocked&title=test'
      ) as never
    );
    expect(response.status).toBe(400);
    expect(mockGetAvailableApiSites).toHaveBeenCalledWith('alice');
    expect(mockSearchFromApiStream).not.toHaveBeenCalled();
  });

  it('uses matching search description and falls back to detail when missing', async () => {
    mockSearchFromApiStream.mockImplementation(async function* () {
      yield [{ id: '1', desc: '搜尋簡介' }];
    });
    const { GET } = await import('./route');
    const request = () =>
      new Request(
        'http://localhost/api/detail?fields=desc&id=1&source=ffzynew&title=test'
      ) as never;
    expect(await (await GET(request())).json()).toEqual({ desc: '搜尋簡介' });
    expect(mockGetDetailFromApi).not.toHaveBeenCalled();
    mockSearchFromApiStream.mockImplementation(async function* () {
      yield [];
    });
    mockGetDetailFromApi.mockResolvedValue({ desc: '詳情簡介' });
    expect(await (await GET(request())).json()).toEqual({ desc: '詳情簡介' });
  });

  it('aborts a slow search after 5 seconds and leaves a bounded detail fallback', async () => {
    jest.useFakeTimers('legacy');
    try {
      mockSearchFromApiStream.mockImplementation(async function* (
        _site,
        _title,
        _parallel,
        _timeout,
        signal
      ) {
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        );
        yield [];
      });
      mockGetDetailFromApi.mockResolvedValue({ desc: 'fallback' });
      const { GET } = await import('./route');
      const pending = GET(
        new Request(
          'http://localhost/api/detail?fields=desc&id=1&source=ffzynew&title=test'
        ) as never
      );
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
      expect(mockSearchFromApiStream).toHaveBeenCalled();
      jest.advanceTimersByTime(5000);
      const response = await pending;
      jest.useRealTimers();
      expect(await response.json()).toEqual({ desc: 'fallback' });
      expect(mockGetDetailFromApi).toHaveBeenCalledWith(
        expect.anything(),
        '1',
        expect.objectContaining({ timeout: 7000, signal: expect.anything() })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not launch description requests after the caller disconnects', async () => {
    const controller = new AbortController();
    controller.abort();
    const { GET } = await import('./route');
    const response = await GET(
      new Request(
        'http://localhost/api/detail?fields=desc&id=1&source=ffzynew&title=test',
        { signal: controller.signal }
      ) as never
    );
    expect(await response.json()).toEqual({ desc: '' });
    expect(mockSearchFromApiStream).not.toHaveBeenCalled();
    expect(mockGetDetailFromApi).not.toHaveBeenCalled();
  });

  it('removes web player URLs before returning detail data', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      new Request(
        'http://localhost/api/detail?source=ffzynew&id=97846'
      ) as never
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.episodes).toEqual([
      'https://vip.ffzy-online3.com/20260605/45062_023f6fec/index.m3u8',
    ]);
    expect(data.episodes_titles).toEqual(['第01集']);
  });
});

export {};
