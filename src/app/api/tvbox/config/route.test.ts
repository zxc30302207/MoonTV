/* eslint-disable @typescript-eslint/no-var-requires */

const mockGetAvailableApiSites = jest.fn();
const mockGetConfig = jest.fn();
const mockVerifyTVBoxTokenPayload = jest.fn();

const mockIsUserSessionCurrent = jest.fn();
jest.mock('@/lib/auth-server', () => ({
  isUserSessionCurrent: mockIsUserSessionCurrent,
}));

jest.mock('@/lib/config', () => ({
  getAvailableApiSites: mockGetAvailableApiSites,
  getConfig: mockGetConfig,
}));

jest.mock('@/lib/tvbox-auth', () => ({
  verifyTVBoxTokenPayload: mockVerifyTVBoxTokenPayload,
}));

describe('/api/tvbox/config', () => {
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
    mockIsUserSessionCurrent.mockResolvedValue(true);
    mockGetConfig.mockResolvedValue({
      UserConfig: {
        Users: [{ username: 'alice', role: 'user', banned: false }],
      },
      SiteConfig: {
        TVBoxEnabled: true,
        TVBoxPassword: 'tvbox-secret',
      },
    });
    mockGetAvailableApiSites.mockResolvedValue([
      {
        api: 'https://normal.example/api.php/provide/vod',
        key: 'normal',
        name: 'Normal',
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

  it('uses signed tokens to calculate user-visible sources', async () => {
    mockVerifyTVBoxTokenPayload.mockResolvedValue({
      username: 'alice',
      timestamp: 123,
    });
    const { GET } = await import('./route');

    await GET(
      new Request('http://localhost/api/tvbox/config?token=signed-token', {
        headers: { 'x-tvbox-password': 'tvbox-secret' },
      }) as Request
    );

    expect(mockGetAvailableApiSites).toHaveBeenCalledWith('alice');
  });

  it('checks the signed generation instead of granting a recreated username', async () => {
    const sessionVersion = 'a'.repeat(64);
    mockVerifyTVBoxTokenPayload.mockResolvedValue({
      username: 'alice',
      timestamp: 123,
      sessionVersion,
    });
    mockIsUserSessionCurrent.mockResolvedValue(false);
    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://localhost/api/tvbox/config?token=signed-token', {
        headers: { 'x-tvbox-password': 'tvbox-secret' },
      })
    );
    expect(mockIsUserSessionCurrent).toHaveBeenCalledWith(
      'alice',
      123,
      sessionVersion
    );
    expect(response.status).toBe(401);
    expect(mockGetAvailableApiSites).not.toHaveBeenCalled();
  });

  it('keeps legacy base64 user URLs compatible without adult/user grants', async () => {
    const legacyUn = Buffer.from('alice', 'utf8').toString('base64');
    const { GET } = await import('./route');

    await GET(
      new Request(
        `http://localhost/api/tvbox/config?un=${encodeURIComponent(legacyUn)}`,
        { headers: { 'x-tvbox-password': 'tvbox-secret' } }
      ) as Request
    );

    expect(mockVerifyTVBoxTokenPayload).not.toHaveBeenCalled();
    expect(mockGetAvailableApiSites).toHaveBeenCalledWith(undefined);
  });

  it.each(['banned', 'deleted', 'revoked'])(
    'rejects %s signed sessions without exporting sources',
    async (state) => {
      mockVerifyTVBoxTokenPayload.mockResolvedValue({
        username: 'alice',
        timestamp: 123,
      });
      if (state !== 'revoked') {
        mockGetConfig.mockResolvedValue({
          SiteConfig: { TVBoxEnabled: true, TVBoxPassword: 'tvbox-secret' },
          UserConfig: {
            Users:
              state === 'deleted'
                ? []
                : [{ username: 'alice', role: 'user', banned: true }],
          },
        });
      } else {
        mockIsUserSessionCurrent.mockResolvedValue(false);
      }
      const { GET } = await import('./route');
      const response = await GET(
        new Request('http://localhost/api/tvbox/config?token=signed-token', {
          headers: { 'x-tvbox-password': 'tvbox-secret' },
        })
      );
      expect(response.status).toBe(401);
      expect(mockGetAvailableApiSites).not.toHaveBeenCalled();
    }
  );

  it('rejects invalid signed tokens', async () => {
    mockVerifyTVBoxTokenPayload.mockResolvedValue(null);
    const { GET } = await import('./route');

    const response = await GET(
      new Request('http://localhost/api/tvbox/config?token=bad', {
        headers: { 'x-tvbox-password': 'tvbox-secret' },
      }) as Request
    );

    expect(response.status).toBe(401);
    expect(mockGetAvailableApiSites).not.toHaveBeenCalled();
  });
});

export {};
