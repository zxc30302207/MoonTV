/* eslint-disable @typescript-eslint/no-var-requires */
import type { NextRequest } from 'next/server';

const mockGetVerifiedAuthInfo = jest.fn();
const mockGetConfig = jest.fn();
const mockCreateTVBoxToken = jest.fn();
const mockSetAdminConfig = jest.fn();
jest.mock('@/lib/auth-server', () => ({
  getVerifiedAuthInfo: mockGetVerifiedAuthInfo,
}));
jest.mock('@/lib/config', () => ({ getConfig: mockGetConfig }));
jest.mock('@/lib/db', () => ({
  getStorage: () => ({ setAdminConfig: mockSetAdminConfig }),
}));
jest.mock('@/lib/tvbox-auth', () => ({
  createTVBoxToken: mockCreateTVBoxToken,
}));
jest.mock('@/lib/request-origin', () => ({
  getRequestOrigin: () => 'https://site.example',
}));

describe('TVBox token issuance generation', () => {
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
    mockGetVerifiedAuthInfo.mockResolvedValue({
      username: 'alice',
      role: 'admin',
      sessionVersion: 'a'.repeat(64),
    });
    mockGetConfig.mockResolvedValue({
      SiteConfig: { TVBoxEnabled: true, TVBoxPassword: 'shared-test' },
      UserConfig: { Users: [{ username: 'alice', role: 'admin' }] },
    });
    mockCreateTVBoxToken.mockResolvedValue('signed-token');
    mockSetAdminConfig.mockResolvedValue(undefined);
  });
  afterEach(() => {
    if (originalStorage === undefined)
      delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    else process.env.NEXT_PUBLIC_STORAGE_TYPE = originalStorage;
  });

  it.each(['GET', 'POST'])(
    '%s inherits the already validated cookie generation, never a later credential',
    async (method) => {
      const route = await import('./route');
      const request = new Request('https://site.example/api/admin/tvbox', {
        method,
        ...(method === 'POST'
          ? { body: JSON.stringify({ mode: 'keep' }) }
          : {}),
      }) as unknown as NextRequest;
      const response =
        method === 'GET' ? await route.GET(request) : await route.POST(request);
      expect(response.status).toBe(200);
      expect(mockCreateTVBoxToken).toHaveBeenCalledWith(
        'alice',
        expect.any(Number),
        'a'.repeat(64)
      );
    }
  );
});
export {};
