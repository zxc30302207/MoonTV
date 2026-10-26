/* eslint-disable @typescript-eslint/no-var-requires */
const mockUsers = jest.fn();
const mockRecords = jest.fn();
const mockFavorites = jest.fn();
const mockRelease = jest.fn();
const mockLease = jest.fn();
const mockFetch = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    getAllUsers: mockUsers,
    getAllPlayRecords: mockRecords,
    getAllFavorites: mockFavorites,
  },
  getStorage: () => ({
    acquireLease: mockLease,
    updatePlayRecordIfUnchanged: mockUpdate,
    updateFavoriteIfUnchanged: mockUpdate,
  }),
}));
jest.mock('@/lib/fetchVideoDetail', () => ({ fetchVideoDetail: mockFetch }));
let handleCronRequest: typeof import('./cron').handleCronRequest;

beforeAll(async () => {
  const { MessageChannel, MessagePort } = require('worker_threads');
  Object.assign(globalThis, { MessageChannel, MessagePort });
  const { Headers, Request, Response } = require('undici');
  Object.assign(globalThis, { Headers, Request, Response });
  handleCronRequest = (await import('./cron')).handleCronRequest;
});
beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'supabase';
  delete process.env.USERNAME;
  mockLease.mockResolvedValue(mockRelease);
  mockUsers.mockResolvedValue(['alice']);
  mockRecords.mockResolvedValue({});
  mockFavorites.mockResolvedValue({});
  mockRelease.mockResolvedValue(undefined);
});
const request = () =>
  ({
    headers: new Headers({ authorization: 'Bearer test-secret' }),
    nextUrl: new URL('https://site.example/api/cron'),
  } as never);

test('does not claim completion before durable work settles and always releases lease', async () => {
  let resolve: (v: unknown) => void = () => undefined;
  mockUsers.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  let settled = false;
  const response = handleCronRequest(request()).then((r) => {
    settled = true;
    return r;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  resolve([]);
  expect((await response).status).toBe(200);
  expect(mockRelease).toHaveBeenCalledTimes(1);
});
test('reports database/downstream failure instead of false success', async () => {
  mockUsers.mockRejectedValueOnce(new Error('database unavailable'));
  expect((await handleCronRequest(request())).status).toBe(500);
  expect(mockRelease).toHaveBeenCalledTimes(1);
});
test('returns conflict for an active distributed lease without doing work', async () => {
  mockLease.mockResolvedValueOnce(null);
  expect((await handleCronRequest(request())).status).toBe(409);
  expect(mockUsers).not.toHaveBeenCalled();
});
