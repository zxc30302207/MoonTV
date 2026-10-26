/* eslint-disable @typescript-eslint/no-var-requires */

const mockGetVerifiedAuthInfo = jest.fn();
const mockGetAvailableApiSites = jest.fn();
jest.mock('@/lib/auth-server', () => ({
  getVerifiedAuthInfo: mockGetVerifiedAuthInfo,
}));
jest.mock('@/lib/config', () => ({
  getAvailableApiSites: mockGetAvailableApiSites,
}));

describe('/api/search/resources active authorization', () => {
  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails closed when active-user validation rejects a signed cookie', async () => {
    mockGetVerifiedAuthInfo.mockResolvedValue(null);
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    const response = await GET(
      new NextRequest('http://localhost/api/search/resources')
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mockGetAvailableApiSites).not.toHaveBeenCalled();
  });

  it('preserves current-user filtering and private response caching', async () => {
    mockGetVerifiedAuthInfo.mockResolvedValue({
      username: 'alice',
      role: 'user',
    });
    mockGetAvailableApiSites.mockResolvedValue([{ key: 'allowed' }]);
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    const response = await GET(
      new NextRequest('http://localhost/api/search/resources')
    );
    expect(response.status).toBe(200);
    expect(mockGetAvailableApiSites).toHaveBeenCalledWith('alice');
    expect(await response.json()).toEqual([{ key: 'allowed' }]);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('preserves authenticated local-mode access without inventing an identity', async () => {
    mockGetVerifiedAuthInfo.mockResolvedValue({
      mode: 'localstorage',
      role: 'user',
    });
    mockGetAvailableApiSites.mockResolvedValue([]);
    const { GET } = await import('./route');
    const { NextRequest } = await import('next/server');
    expect(
      (await GET(new NextRequest('http://localhost/api/search/resources')))
        .status
    ).toBe(200);
    expect(mockGetAvailableApiSites).toHaveBeenCalledWith(undefined);
  });
});

export {};
