/* eslint-disable @typescript-eslint/no-var-requires */

import type { NextRequest } from 'next/server';

const mockCanAccessAdultContent = jest.fn();
const mockGetAvailableApiSites = jest.fn();
const mockGetConfig = jest.fn();
const mockGetVerifiedAuthInfo = jest.fn();
const mockSearchFromApiStream = jest.fn();

jest.mock('@/lib/auth-server', () => ({
  getVerifiedAuthInfo: mockGetVerifiedAuthInfo,
}));

jest.mock('@/lib/config', () => ({
  canAccessAdultContent: mockCanAccessAdultContent,
  getAvailableApiSites: mockGetAvailableApiSites,
  getConfig: mockGetConfig,
}));

jest.mock('@/lib/downstream', () => ({
  searchFromApiStream: mockSearchFromApiStream,
}));

jest.mock('@/lib/yellow', () => ({
  isYellowSearchResult: jest.fn((result) => result.title.includes('Adult')),
}));

jest.mock('@/lib/zh', () => ({
  toSimplified: jest.fn((value) => value),
}));

describe('/api/search', () => {
  const originalStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;

  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchFromApiStream.mockReset();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'supabase';
    mockGetVerifiedAuthInfo.mockResolvedValue({
      role: 'user',
      timestamp: Date.now(),
      username: 'alice',
    });
    mockGetConfig.mockResolvedValue({
      SiteConfig: {
        DisableYellowFilter: true,
      },
    });
    mockCanAccessAdultContent.mockReturnValue(false);
    mockGetAvailableApiSites.mockResolvedValue([
      {
        key: 'normal',
        name: 'Normal Source',
        api: 'https://normal.example/api.php/provide/vod',
      },
    ]);
  });

  afterEach(() => {
    if (originalStorageType === undefined) {
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    } else {
      process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorageType;
    }
  });

  it('does not call a requested adult source when it is unavailable to the user', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      new Request(
        'http://localhost/api/search?q=NBA&sources=ckzy&stream=0'
      ) as unknown as NextRequest
    );
    const json = await response.json();

    expect(mockGetAvailableApiSites).toHaveBeenCalledWith('alice');
    expect(mockSearchFromApiStream).not.toHaveBeenCalled();
    expect(json).toEqual({
      results: [],
      failedSources: [],
    });
    expect(response.headers.get('Cache-Control')).toBe(
      'no-store, no-cache, must-revalidate'
    );
  });

  it('filters yellow results from allowed non-adult sources without adult authorization', async () => {
    mockSearchFromApiStream.mockImplementation(async function* () {
      yield [
        {
          id: '1',
          title: 'NBA Highlights',
          poster: '',
          episodes: [],
          episodes_titles: [],
          source: 'normal',
          source_name: 'Normal Source',
          year: '2026',
        },
        {
          id: '2',
          title: 'Adult NBA',
          poster: '',
          episodes: [],
          episodes_titles: [],
          source: 'normal',
          source_name: 'Normal Source',
          year: '2026',
        },
      ];
    });

    const { GET } = await import('./route');

    const response = await GET(
      new Request(
        'http://localhost/api/search?q=NBA&stream=0'
      ) as unknown as NextRequest
    );
    const json = await response.json();

    expect(json.results).toEqual([
      expect.objectContaining({
        id: '1',
        title: 'NBA Highlights',
      }),
    ]);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});

export {};
