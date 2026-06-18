/* eslint-disable @typescript-eslint/no-var-requires */

const mockGetAvailableApiSites = jest.fn();
const mockGetDetailFromApi = jest.fn();
const mockGetVerifiedAuthInfo = jest.fn();

jest.mock('@/lib/auth-server', () => ({
  getVerifiedAuthInfo: mockGetVerifiedAuthInfo,
}));

jest.mock('@/lib/config', () => ({
  getAvailableApiSites: mockGetAvailableApiSites,
}));

jest.mock('@/lib/downstream', () => ({
  getDetailFromApi: mockGetDetailFromApi,
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
        name: '非凡影视新接口',
        api: 'https://api.ffzyapi.com/api.php/provide/vod',
      },
    ]);
    mockGetDetailFromApi.mockResolvedValue({
      id: '97846',
      title: '铁拳教育',
      poster: '',
      episodes: [
        'https://vip.ffzy-online3.com/share/023f6fecc6b88ffa0b732dd682093b80',
        'https://vip.ffzy-online3.com/20260605/45062_023f6fec/index.m3u8',
      ],
      episodes_titles: ['第01集 share', '第01集'],
      source: 'ffzynew',
      source_name: '非凡影视新接口',
      year: '2026',
    });
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
