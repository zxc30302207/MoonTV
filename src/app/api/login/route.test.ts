/* eslint-disable @typescript-eslint/no-var-requires */
const mockConfig = jest.fn();
const mockVerify = jest.fn();
jest.mock('@/lib/config', () => ({ getConfig: mockConfig }));
jest.mock('@/lib/db', () => ({ db: { verifyUser: mockVerify } }));
jest.mock('@/lib/auth-crypto', () => ({
  generateSignature: async () => 'signature',
}));
jest.mock('@/lib/auth-server', () => ({
  getAuthSignaturePayload: () => 'payload',
}));
jest.mock('@/lib/rate-limit', () => ({
  getClientIp: () => 'test',
  rateLimit: () => ({ allowed: true }),
  getRateLimitHeaders: () => ({}),
}));

describe('login membership requirement', () => {
  const originalStorage = process.env.NEXT_PUBLIC_STORAGE_TYPE;
  beforeAll(() => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'supabase';
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerify.mockResolvedValue(true);
  });
  afterAll(() => {
    if (originalStorage === undefined)
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    else process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorage;
  });
  async function login() {
    const { POST } = await import('./route');
    const { NextRequest } = await import('next/server');
    return POST(
      new NextRequest('https://site.example/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'test-password' }),
      })
    );
  }
  it('does not issue a cookie for a password-only account', async () => {
    mockConfig.mockResolvedValue({ UserConfig: { Users: [] } });
    const response = await login();
    expect(response.status).toBe(401);
    expect(response.cookies.get('auth')).toBeUndefined();
    expect(mockVerify).not.toHaveBeenCalled();
  });
  it('does not issue a cookie for a configured but banned account', async () => {
    mockConfig.mockResolvedValue({
      UserConfig: {
        Users: [{ username: 'alice', role: 'user', banned: true }],
      },
    });
    const response = await login();
    expect(response.status).toBe(401);
    expect(response.cookies.get('auth')).toBeUndefined();
    expect(mockVerify).not.toHaveBeenCalled();
  });
  it('preserves login for a configured active legacy user', async () => {
    mockConfig.mockResolvedValue({
      UserConfig: { Users: [{ username: 'alice', role: 'user' }] },
    });
    const response = await login();
    expect(response.status).toBe(200);
    expect(response.cookies.get('auth')).toBeDefined();
  });
  it('does not issue a cookie for a reserved account without credentials', async () => {
    mockConfig.mockResolvedValue({
      UserConfig: { Users: [{ username: 'alice', role: 'user' }] },
    });
    mockVerify.mockResolvedValue(false);
    const response = await login();
    expect(response.status).toBe(401);
    expect(response.cookies.get('auth')).toBeUndefined();
  });
});
export {};
