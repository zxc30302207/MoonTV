/* eslint-disable @typescript-eslint/no-var-requires */
import { ConfigConflictError } from '@/lib/config-snapshot';

let config: {
  UserConfig: {
    Users: Array<{
      username: string;
      role: string;
      banned?: boolean;
      deletionPending?: boolean;
    }>;
  };
};
const mockSave = jest.fn();
const mockDelete = jest.fn();
const mockCredential = jest.fn();
const mockChange = jest.fn();
const mockRegister = jest.fn();
jest.mock('@/lib/auth-server', () => ({
  getVerifiedAuthInfo: async () => ({ username: 'owner', role: 'owner' }),
}));
jest.mock('@/lib/config', () => ({
  getConfig: async () => JSON.parse(JSON.stringify(config)),
}));
jest.mock('@/lib/db', () => ({
  getStorage: () => ({
    setAdminConfig: mockSave,
    deleteUser: jest.fn(),
    deleteUserAtomic: mockDelete,
    getUserCredentialSnapshot: mockCredential,
    changePassword: mockChange,
    registerUserAtomic: mockRegister,
    registerUser: jest.fn(),
  }),
}));
beforeAll(() => {
  const { MessageChannel, MessagePort } = require('worker_threads');
  Object.assign(globalThis, { MessageChannel, MessagePort });
  const { Headers, Request, Response } = require('undici');
  Object.assign(globalThis, { Headers, Request, Response });
});
beforeEach(() => {
  jest.resetAllMocks();
  process.env.USERNAME = 'owner';
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'supabase';
  config = {
    UserConfig: {
      Users: [
        { username: 'owner', role: 'owner' },
        { username: 'alice', role: 'user' },
      ],
    },
  };
  mockCredential.mockResolvedValue({
    hash: 'old-generation',
    revokedBefore: 1,
  });
  mockSave.mockImplementation(async (next) => {
    config = JSON.parse(JSON.stringify(next));
  });
});
async function post(action: string, targetUsername = 'alice') {
  const { POST } = await import('./route');
  return POST(
    new Request('https://site.example/api/admin/user', {
      method: 'POST',
      body: JSON.stringify({
        action,
        targetUsername,
        targetPassword: 'new-secret',
      }),
      headers: { 'Content-Type': 'application/json' },
    }) as never
  );
}

test('stale config/generation conflict leaves all deletion to the conditional RPC', async () => {
  mockDelete.mockRejectedValueOnce(new ConfigConflictError());
  expect((await post('deleteUser')).status).toBe(409);
  expect(mockSave).not.toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledWith('alice', expect.any(Object), {
    hash: 'old-generation',
    revokedBefore: 1,
  });
});
test('unknown delete result is not retried or followed by independent cleanup', async () => {
  mockDelete.mockRejectedValueOnce(new Error('network unknown commit'));
  expect((await post('deleteUser')).status).toBe(500);
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(mockSave).not.toHaveBeenCalled();
});
test('password-only change does not make a stale config write after success', async () => {
  expect((await post('changePassword')).status).toBe(200);
  expect(mockChange).toHaveBeenCalled();
  expect(mockSave).not.toHaveBeenCalled();
});
test('new usernames are canonicalized before atomic registration', async () => {
  expect((await post('add', ' Bob ')).status).toBe(200);
  expect(mockRegister).toHaveBeenCalledWith(
    'Bob',
    'new-secret',
    expect.any(Object),
    expect.any(Object)
  );
});
