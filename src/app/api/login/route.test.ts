/* eslint-disable @typescript-eslint/no-var-requires */
const mockConfig = jest.fn();
const mockVerify = jest.fn();
const mockIsUserSessionCurrent = jest.fn();
jest.mock('@/lib/config', () => ({ getConfig: mockConfig }));
jest.mock('@/lib/db', () => ({
  getStorage: () => ({ verifyUserSession: mockVerify }),
}));
jest.mock('@/lib/auth-crypto', () => ({
  generateSignature: async () => 'signature',
}));
jest.mock('@/lib/auth-server', () => ({
  getAuthSignaturePayload: () => 'payload',
  isUserSessionCurrent: mockIsUserSessionCurrent,
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
    mockVerify.mockResolvedValue({ valid: true });
    mockIsUserSessionCurrent.mockResolvedValue(true);
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
  it('rejects a login attempt revoked while password verification was pending', async () => {
    mockConfig.mockResolvedValue({
      UserConfig: { Users: [{ username: 'alice', role: 'user' }] },
    });
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      mockVerify.mockImplementation(async () => {
        clock.mockReturnValue(2000);
        return { valid: true };
      });
      mockIsUserSessionCurrent.mockImplementation(
        async (_username, issuedAt) => issuedAt > 1500
      );
      const response = await login();
      expect(response.status).toBe(401);
      expect(mockIsUserSessionCurrent).toHaveBeenCalledWith(
        'alice',
        1000,
        undefined
      );
      expect(response.cookies.get('auth')).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  });

  it('does not timestamp a successful cookie after delayed verification', async () => {
    mockConfig.mockResolvedValue({
      UserConfig: { Users: [{ username: 'alice', role: 'user' }] },
    });
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      mockVerify.mockImplementation(async () => {
        clock.mockReturnValue(2000);
        return { valid: true };
      });
      const response = await login();
      expect(response.status).toBe(200);
      const auth = JSON.parse(
        decodeURIComponent(response.cookies.get('auth')?.value || '{}')
      );
      expect(auth.timestamp).toBe(1000);
    } finally {
      clock.mockRestore();
    }
  });

  it('binds a cookie to the exact verified credential generation', async () => {
    mockConfig.mockResolvedValue({
      UserConfig: { Users: [{ username: 'alice', role: 'user' }] },
    });
    const sessionVersion = 'a'.repeat(64);
    mockVerify.mockResolvedValue({ valid: true, sessionVersion });
    const response = await login();
    expect(response.status).toBe(200);
    const auth = JSON.parse(
      decodeURIComponent(response.cookies.get('auth')?.value || '{}')
    );
    expect(auth.sessionVersion).toBe(sessionVersion);
    expect(mockIsUserSessionCurrent).toHaveBeenCalledWith(
      'alice',
      expect.any(Number),
      sessionVersion
    );
  });

  it('rejects a credential generation changed after password verification', async () => {
    mockConfig.mockResolvedValue({
      UserConfig: { Users: [{ username: 'alice', role: 'user' }] },
    });
    mockVerify.mockResolvedValue({
      valid: true,
      sessionVersion: 'a'.repeat(64),
    });
    mockIsUserSessionCurrent.mockResolvedValue(false);
    const response = await login();
    expect(response.status).toBe(401);
    expect(response.cookies.get('auth')).toBeUndefined();
  });

  it('does not issue a cookie for a reserved account without credentials', async () => {
    mockConfig.mockResolvedValue({
      UserConfig: { Users: [{ username: 'alice', role: 'user' }] },
    });
    mockVerify.mockResolvedValue({ valid: false });
    const response = await login();
    expect(response.status).toBe(401);
    expect(response.cookies.get('auth')).toBeUndefined();
  });
});
export {};
