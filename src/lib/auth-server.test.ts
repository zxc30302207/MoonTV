/* eslint-disable @typescript-eslint/no-var-requires */

import type { NextRequest } from 'next/server';

jest.mock('./auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
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
}) {
  return {
    ...authInfo,
    signature: await generateSignature(
      getAuthSignaturePayload(authInfo),
      'test-secret'
    ),
  };
}
