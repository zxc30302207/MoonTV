/* eslint-disable @typescript-eslint/no-var-requires */
const mockAuth = jest.fn();
const mockConfig = jest.fn();
const mockUpdate = jest.fn();
const mockSetConfig = jest.fn();
jest.mock('@/lib/auth-server', () => ({ getVerifiedAuthInfo: mockAuth }));
jest.mock('@/lib/config', () => ({ getConfig: mockConfig }));
jest.mock('@/lib/db', () => ({
  getStorage: () => ({
    updateUserLastOnline: mockUpdate,
    setAdminConfig: mockSetConfig,
  }),
}));

describe('online heartbeat', () => {
  const originalStorage = process.env.NEXT_PUBLIC_STORAGE_TYPE;
  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'supabase';
    mockAuth.mockResolvedValue({ username: 'alice' });
    mockConfig.mockResolvedValue({
      UserConfig: { Users: [{ username: 'alice' }] },
    });
  });
  afterAll(() => {
    if (originalStorage === undefined)
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    else process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorage;
  });
  it('uses atomic presence update rather than saving its stale configuration snapshot', async () => {
    mockUpdate.mockResolvedValue(true);
    const { POST } = await import('./route');
    const { NextRequest } = await import('next/server');
    const response = await POST(
      new NextRequest('https://site.example/api/user/online', {
        method: 'POST',
      })
    );
    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith('alice', expect.any(Number));
    expect(mockSetConfig).not.toHaveBeenCalled();
  });
  it('rejects a user banned or deleted while the heartbeat was pending', async () => {
    mockUpdate.mockResolvedValue(false);
    const { POST } = await import('./route');
    const { NextRequest } = await import('next/server');
    const response = await POST(
      new NextRequest('https://site.example/api/user/online', {
        method: 'POST',
      })
    );
    expect(response.status).toBe(401);
    expect(mockSetConfig).not.toHaveBeenCalled();
  });
});
export {};
