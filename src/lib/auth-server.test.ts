/* eslint-disable @typescript-eslint/no-var-requires */

import type { NextRequest } from 'next/server';

jest.mock('./auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));

const mockGetUserSessionState = jest.fn();
jest.mock('./db', () => ({
  getStorage: () => ({ getUserSessionState: mockGetUserSessionState }),
}));

jest.mock('./config', () => ({
  getConfig: jest.fn(),
}));

import { generateSignature } from './auth-crypto';
import { getAuthSignaturePayload, getVerifiedAuthInfo } from './auth-server';

const { getAuthInfoFromCookie: mockGetAuthInfoFromCookie } = jest.requireMock(
  './auth'
) as {
  getAuthInfoFromCookie: jest.Mock;
};
const { getConfig: mockGetConfig } = jest.requireMock('./config') as {
  getConfig: jest.Mock;
};

describe('getVerifiedAuthInfo', () => {
  const originalPassword = process.env.PASSWORD;
  const originalStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;

  beforeAll(() => {
    const { webcrypto } = require('crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserSessionState.mockResolvedValue({ exists: true, notBefore: 0 });
    process.env.PASSWORD = 'test-secret';
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'supabase';
    mockGetConfig.mockResolvedValue({
      UserConfig: {
        Users: [{ banned: false, role: 'user', username: 'alice' }],
      },
    });
  });

  afterEach(() => {
    if (originalPassword === undefined) {
      delete process.env.PASSWORD;
    } else {
      process.env.PASSWORD = originalPassword;
    }
    if (originalStorageType === undefined) {
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    } else {
      process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorageType;
    }
  });

  it('accepts a timestamped signed active user cookie', async () => {
    const authInfo = await signedAuthCookie({
      role: 'user',
      timestamp: Date.now(),
      username: 'alice',
    });
    mockGetAuthInfoFromCookie.mockReturnValue(authInfo);

    await expect(getVerifiedAuthInfo({} as NextRequest)).resolves.toMatchObject(
      {
        role: 'user',
        username: 'alice',
      }
    );
  });

  it('rejects a valid signed cookie issued before a password change', async () => {
    const issuedAt = Date.now() - 1_000;
    mockGetAuthInfoFromCookie.mockReturnValue(
      await signedAuthCookie({
        role: 'user',
        timestamp: issuedAt,
        username: 'alice',
      })
    );
    mockGetUserSessionState.mockResolvedValue({
      exists: true,
      notBefore: issuedAt + 1,
    });
    await expect(getVerifiedAuthInfo({} as NextRequest)).resolves.toBeNull();
  });

  it('accepts a new login after the per-user cutoff', async () => {
    const issuedAt = Date.now();
    mockGetAuthInfoFromCookie.mockReturnValue(
      await signedAuthCookie({
        role: 'user',
        timestamp: issuedAt,
        username: 'alice',
      })
    );
    mockGetUserSessionState.mockResolvedValue({
      exists: true,
      notBefore: issuedAt - 1,
    });
    await expect(getVerifiedAuthInfo({} as NextRequest)).resolves.toMatchObject(
      { username: 'alice' }
    );
  });

  it('rejects sessions issued in the same millisecond as a password change', async () => {
    const issuedAt = Date.now();
    mockGetAuthInfoFromCookie.mockReturnValue(
      await signedAuthCookie({
        role: 'user',
        timestamp: issuedAt,
        username: 'alice',
      })
    );
    mockGetUserSessionState.mockResolvedValue({
      exists: true,
      notBefore: issuedAt,
    });
    await expect(getVerifiedAuthInfo({} as NextRequest)).resolves.toBeNull();
  });

  it('does not authorize when the revocation lookup fails', async () => {
    mockGetAuthInfoFromCookie.mockReturnValue(
      await signedAuthCookie({
        role: 'user',
        timestamp: Date.now(),
        username: 'alice',
      })
    );
    mockGetUserSessionState.mockRejectedValue(
      new Error('database unavailable')
    );
    await expect(getVerifiedAuthInfo({} as NextRequest)).rejects.toThrow(
      'database unavailable'
    );
  });

  it('rejects a former account session after same-millisecond username recreation', async () => {
    const timestamp = Date.now();
    mockGetAuthInfoFromCookie.mockReturnValue(
      await signedAuthCookie({
        role: 'user',
        timestamp,
        username: 'alice',
        sessionVersion: 'a'.repeat(64),
      })
    );
    mockGetUserSessionState.mockResolvedValue({
      exists: true,
      notBefore: timestamp,
      sessionVersion: 'b'.repeat(64),
    });
    await expect(getVerifiedAuthInfo({} as NextRequest)).resolves.toBeNull();
  });

  it('accepts the exact current generation even on its creation millisecond', async () => {
    const timestamp = Date.now();
    const sessionVersion = 'b'.repeat(64);
    mockGetAuthInfoFromCookie.mockReturnValue(
      await signedAuthCookie({
        role: 'user',
        timestamp,
        username: 'alice',
        sessionVersion,
      })
    );
    mockGetUserSessionState.mockResolvedValue({
      exists: true,
      notBefore: timestamp,
      sessionVersion,
    });
    await expect(getVerifiedAuthInfo({} as NextRequest)).resolves.toMatchObject(
      { sessionVersion }
    );
  });

  it('does not upgrade a legacy cookie to a newly versioned account', async () => {
    mockGetAuthInfoFromCookie.mockReturnValue(
      await signedAuthCookie({
        role: 'user',
        timestamp: Date.now(),
        username: 'alice',
      })
    );
    mockGetUserSessionState.mockResolvedValue({
      exists: true,
      notBefore: 0,
      sessionVersion: 'b'.repeat(64),
    });
    await expect(getVerifiedAuthInfo({} as NextRequest)).resolves.toBeNull();
  });

  it('does not downgrade a versioned cookie to a legacy credential', async () => {
    mockGetAuthInfoFromCookie.mockReturnValue(
      await signedAuthCookie({
        role: 'user',
        timestamp: Date.now(),
        username: 'alice',
        sessionVersion: 'a'.repeat(64),
      })
    );
    await expect(getVerifiedAuthInfo({} as NextRequest)).resolves.toBeNull();
  });

  it('rejects generation tampering before reading the credential', async () => {
    const auth = await signedAuthCookie({
      role: 'user',
      timestamp: Date.now(),
      username: 'alice',
      sessionVersion: 'a'.repeat(64),
    });
    mockGetAuthInfoFromCookie.mockReturnValue({
      ...auth,
      sessionVersion: 'b'.repeat(64),
    });
    await expect(getVerifiedAuthInfo({} as NextRequest)).resolves.toBeNull();
    expect(mockGetUserSessionState).not.toHaveBeenCalled();
  });

  it('rejects missing credentials even if a membership record still exists', async () => {
    mockGetAuthInfoFromCookie.mockReturnValue(
      await signedAuthCookie({
        role: 'user',
        timestamp: Date.now(),
        username: 'alice',
      })
    );
    mockGetUserSessionState.mockResolvedValue({
      exists: false,
      notBefore: Infinity,
    });
    await expect(getVerifiedAuthInfo({} as NextRequest)).resolves.toBeNull();
  });

  it('rejects legacy cookies without a timestamp', async () => {
    const signature = await generateSignature('alice', 'test-secret');
    mockGetAuthInfoFromCookie.mockReturnValue({
      role: 'user',
      signature,
      username: 'alice',
    });

    await expect(getVerifiedAuthInfo({} as NextRequest)).resolves.toBeNull();
  });

  it('rejects expired cookies', async () => {
    const authInfo = await signedAuthCookie({
      role: 'user',
      timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000,
      username: 'alice',
    });
    mockGetAuthInfoFromCookie.mockReturnValue(authInfo);

    await expect(getVerifiedAuthInfo({} as NextRequest)).resolves.toBeNull();
  });

  it('rejects banned users even with a valid signature', async () => {
    const authInfo = await signedAuthCookie({
      role: 'user',
      timestamp: Date.now(),
      username: 'alice',
    });
    mockGetAuthInfoFromCookie.mockReturnValue(authInfo);
    mockGetConfig.mockResolvedValue({
      UserConfig: {
        Users: [{ banned: true, role: 'user', username: 'alice' }],
      },
    });

    await expect(getVerifiedAuthInfo({} as NextRequest)).resolves.toBeNull();
  });

  it('rejects role tampering', async () => {
    const timestamp = Date.now();
    const signature = await generateSignature(
      getAuthSignaturePayload({
        role: 'user',
        timestamp,
        username: 'alice',
      }),
      'test-secret'
    );
    mockGetAuthInfoFromCookie.mockReturnValue({
      role: 'admin',
      signature,
      timestamp,
      username: 'alice',
    });

    await expect(getVerifiedAuthInfo({} as NextRequest)).resolves.toBeNull();
  });
});

async function signedAuthCookie(authInfo: {
  role: 'owner' | 'admin' | 'user';
  timestamp: number;
  username: string;
  sessionVersion?: string;
}) {
  return {
    ...authInfo,
    signature: await generateSignature(
      getAuthSignaturePayload(authInfo),
      'test-secret'
    ),
  };
}
