/* eslint-disable @typescript-eslint/no-var-requires */

import { NextRequest } from 'next/server';

const mockGetVerifiedAuthInfo = jest.fn();
const mockVerifyUser = jest.fn();
const mockChangePassword = jest.fn();

jest.mock('@/lib/auth-server', () => ({
  getVerifiedAuthInfo: mockGetVerifiedAuthInfo,
}));

jest.mock('@/lib/db', () => ({
  db: {
    verifyUser: mockVerifyUser,
  },
  getStorage: jest.fn(() => ({
    changePassword: mockChangePassword,
  })),
}));

describe('/api/change-password', () => {
  const originalStorageType = process.env.NEXT_PUBLIC_STORAGE_TYPE;
  const originalUsername = process.env.USERNAME;

  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'supabase';
    process.env.USERNAME = 'owner';
    mockGetVerifiedAuthInfo.mockResolvedValue({ username: 'alice' });
    mockVerifyUser.mockResolvedValue(true);
  });

  afterEach(() => {
    if (originalStorageType === undefined) {
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    } else {
      process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorageType;
    }
    if (originalUsername === undefined) {
      delete process.env.USERNAME;
    } else {
      process.env.USERNAME = originalUsername;
    }
  });

  it('requires the current password', async () => {
    const { POST } = await import('./route');

    const response = await POST(requestWithBody({ newPassword: 'new-secret' }));

    expect(response.status).toBe(400);
    expect(mockVerifyUser).not.toHaveBeenCalled();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('rejects an incorrect current password', async () => {
    mockVerifyUser.mockResolvedValue(false);
    const { POST } = await import('./route');

    const response = await POST(
      requestWithBody({
        currentPassword: 'wrong',
        newPassword: 'new-secret',
      })
    );

    expect(response.status).toBe(401);
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('changes a normal user password after verifying the current password', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      requestWithBody({
        currentPassword: 'old-secret',
        newPassword: 'new-secret',
      })
    );

    expect(response.status).toBe(200);
    expect(mockVerifyUser).toHaveBeenCalledWith('alice', 'old-secret');
    expect(mockChangePassword).toHaveBeenCalledWith('alice', 'new-secret');
  });

  it('does not allow the owner to change the env password through self-service', async () => {
    mockGetVerifiedAuthInfo.mockResolvedValue({ username: 'owner' });
    const { POST } = await import('./route');

    const response = await POST(
      requestWithBody({
        currentPassword: 'old-secret',
        newPassword: 'new-secret',
      })
    );

    expect(response.status).toBe(403);
    expect(mockChangePassword).not.toHaveBeenCalled();
  });
});

function requestWithBody(body: unknown): NextRequest {
  return new Request('http://localhost/api/change-password', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }) as unknown as NextRequest;
}
