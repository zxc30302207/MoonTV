/* eslint-disable @typescript-eslint/no-var-requires */
const mockGetConfig = jest.fn();
const mockSetCachedConfig = jest.fn();
const mockRegister = jest.fn();
const mockAppend = jest.fn();
const mockSave = jest.fn();
jest.mock('@/lib/config', () => ({
  getConfig: mockGetConfig,
  setCachedConfig: mockSetCachedConfig,
}));
jest.mock('@/lib/db', () => ({
  db: {
    checkUserExist: async () => false,
    registerUser: mockRegister,
    saveAdminConfig: mockSave,
  },
  getStorage: () => ({ appendRegisteredUser: mockAppend }),
}));
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

describe('registration concurrency', () => {
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
    mockRegister.mockReset();
    mockAppend.mockReset();
    mockAppend.mockResolvedValue({
      UserConfig: { AllowRegister: true, Users: [{ username: 'alice' }] },
    });
    mockGetConfig.mockResolvedValue({
      UserConfig: { AllowRegister: true, Users: [] },
    });
  });
  afterAll(() => {
    if (originalStorage === undefined)
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    else process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorage;
  });
  async function register() {
    const { POST } = await import('./route');
    const { NextRequest } = await import('next/server');
    return POST(
      new NextRequest('https://site.example/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'test-password' }),
      })
    );
  }
  it('atomically appends and refreshes the local view instead of replacing a stale config', async () => {
    const config = {
      UserConfig: {
        AllowRegister: true,
        Users: [{ username: 'bob' }, { username: 'alice' }],
      },
    };
    mockAppend.mockResolvedValue(config);
    expect((await register()).status).toBe(200);
    expect(mockAppend).toHaveBeenCalledWith('alice');
    expect(mockAppend.mock.invocationCallOrder[0]).toBeLessThan(
      mockRegister.mock.invocationCallOrder[0]
    );
    expect(mockSetCachedConfig).toHaveBeenCalledWith(config);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('returns conflict for a concurrent registration winning the password insert', async () => {
    mockRegister.mockRejectedValue({ code: '23505' });
    expect((await register()).status).toBe(409);
    expect(mockAppend).toHaveBeenCalledWith('alice');
    expect(mockSetCachedConfig).not.toHaveBeenCalled();
  });
  it('never creates credentials when config append fails or registration closes', async () => {
    mockAppend.mockRejectedValue(new Error('Registration is closed'));
    const response = await register();
    expect(response.status).toBe(500);
    expect(mockRegister).not.toHaveBeenCalled();
    expect(response.cookies.get('auth')).toBeUndefined();
  });
  it('issues no cookie after an uncertain credential insert outcome', async () => {
    mockRegister.mockRejectedValue(new Error('network failure after insert'));
    const response = await register();
    expect(response.status).toBe(500);
    expect(response.cookies.get('auth')).toBeUndefined();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('does not claim a configured account whose password row is missing', async () => {
    mockGetConfig.mockResolvedValue({
      UserConfig: {
        AllowRegister: true,
        Users: [{ username: 'alice', role: 'admin' }],
      },
    });
    expect((await register()).status).toBe(400);
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
export {};
