/* eslint-disable @typescript-eslint/no-var-requires */

import type { NextRequest } from 'next/server';

const mockGetConfig = jest.fn();

jest.mock('@/lib/config', () => ({
  getConfig: mockGetConfig,
}));

describe('/api/server-config', () => {
  const originalStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;

  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'supabase';
    mockGetConfig.mockResolvedValue({
      SiteConfig: {
        SiteName: 'MoonTV Test',
      },
      UserConfig: {
        AllowRegister: true,
      },
    });
  });

  afterEach(() => {
    if (originalStorageType === undefined) {
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    } else {
      process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorageType;
    }
  });

  it('returns live registration settings without shared caching', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      new Request(
        'http://localhost/api/server-config'
      ) as unknown as NextRequest
    );
    const json = await response.json();

    expect(json).toEqual({
      SiteName: 'MoonTV Test',
      StorageType: 'supabase',
      EnableRegister: true,
    });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});

export {};
