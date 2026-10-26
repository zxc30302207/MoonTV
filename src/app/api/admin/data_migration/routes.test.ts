/* eslint-disable @typescript-eslint/no-var-requires */
import { deflate, inflate } from 'pako';

const mockAuth = jest.fn();
const mockDb = {
  snapshotAllData: jest.fn(),
  restoreAllData: jest.fn(),
  clearAllData: jest.fn(),
  saveAdminConfig: jest.fn(),
  getAdminConfig: jest.fn(),
  getAllUsers: jest.fn(),
  getUserPassword: jest.fn(),
  getAllPlayRecords: jest.fn(),
  getAllFavorites: jest.fn(),
  getAllFollowings: jest.fn(),
  getTodayUpdated: jest.fn(),
  getSearchHistory: jest.fn(),
  getAllSkipConfigs: jest.fn(),
};

jest.mock('@/lib/auth-server', () => ({ getVerifiedAuthInfo: mockAuth }));
jest.mock('@/lib/db', () => ({ db: mockDb, getStorage: () => mockDb }));
jest.mock('@/lib/config', () => ({
  configSelfCheck: (config: unknown) => config,
  setCachedConfig: jest.fn(),
}));
jest.mock('@/lib/crypto', () => ({
  SimpleCrypto: {
    encrypt: (data: string) => data,
    decrypt: (data: string) => data,
  },
}));
jest.mock('@/lib/password', () => ({
  normalizePasswordForStorage: async (value: string) =>
    value.startsWith('hashed:') ? value : `hashed:${value}`,
  hashPassword: async (value: string) => `hashed:${value}`,
  isPasswordHash: (value: string) => value.startsWith('hashed:'),
}));
jest.mock('@/lib/version', () => ({ CURRENT_VERSION: 'test' }));

describe('owner-only migration routes', () => {
  const original = {
    owner: process.env.USERNAME,
    password: process.env.PASSWORD,
    storage: process.env.NEXT_PUBLIC_STORAGE_TYPE,
  };

  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    const { ReadableStream } = require('stream/web');
    Object.assign(globalThis, { Headers, Request, Response, ReadableStream });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USERNAME = 'owner';
    process.env.PASSWORD = 'owner-placeholder';
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'supabase';
    mockAuth.mockResolvedValue({ username: 'owner', role: 'owner' });
  });

  afterAll(() => {
    for (const [key, value] of Object.entries({
      USERNAME: original.owner,
      PASSWORD: original.password,
      NEXT_PUBLIC_STORAGE_TYPE: original.storage,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('rejects unauthenticated import without deleting data', async () => {
    mockAuth.mockResolvedValue(null);
    const { POST } = await import('./import/route');
    const response = await POST({} as never);
    expect(response.status).toBe(401);
    expect(mockDb.clearAllData).not.toHaveBeenCalled();
  });

  it('rejects a verified non-owner for export', async () => {
    mockAuth.mockResolvedValue({ username: 'admin', role: 'admin' });
    const { POST } = await import('./export/route');
    expect((await POST({} as never)).status).toBe(401);
    expect(mockDb.getAdminConfig).not.toHaveBeenCalled();
  });

  it('validates decrypted backups before deleting data', async () => {
    const encrypted = Buffer.from(
      deflate(JSON.stringify({ data: { adminConfig: {}, userData: {} } }))
    ).toString('base64');
    const form = new Map<string, unknown>([
      ['file', { size: encrypted.length, text: async () => encrypted }],
      ['password', 'backup-placeholder'],
    ]);
    const { POST } = await import('./import/route');
    expect((await POST({ formData: async () => form } as never)).status).toBe(
      400
    );
    expect(mockDb.clearAllData).not.toHaveBeenCalled();
  });

  it('exports SSE with following data and hashed owner password only', async () => {
    mockDb.snapshotAllData.mockResolvedValue([
      {
        key: 'admin:config',
        value: {
          ConfigFile: '{}',
          SiteConfig: { SiteName: 'Custom', DisableYellowFilter: false },
          UserConfig: { AllowRegister: false, Users: [] },
          SourceConfig: [],
          CustomCategories: [],
        },
      },
      {
        key: 'u:owner:following:normal+1',
        value: {
          title: 'Show',
          source_name: 'Normal',
          year: '',
          cover: '',
          search_title: 'Show',
          total_episodes: 1,
          watched_episodes: 0,
          save_time: 1,
        },
      },
    ]);
    mockDb.getAdminConfig.mockResolvedValue({
      SiteConfig: { SiteName: 'Custom' },
    });
    mockDb.getAllUsers.mockResolvedValue([]);
    mockDb.getUserPassword.mockResolvedValue(null);
    mockDb.getAllPlayRecords.mockResolvedValue({});
    mockDb.getAllFavorites.mockResolvedValue({});
    mockDb.getAllFollowings.mockResolvedValue({
      'normal+1': { title: 'Show' },
    });
    mockDb.getTodayUpdated.mockResolvedValue({ date: '2026-10-06', items: [] });
    mockDb.getSearchHistory.mockResolvedValue([]);
    mockDb.getAllSkipConfigs.mockResolvedValue({});
    const { POST } = await import('./export/route');
    const response = await POST({
      json: async () => ({ password: 'backup-placeholder' }),
    } as never);
    const events = (await response.text())
      .trim()
      .split('\n\n')
      .map((line) => JSON.parse(line.slice(6)));
    const encrypted = events
      .filter((event) => event.type === 'chunk')
      .map((event) => event.data)
      .join('');
    const backup = JSON.parse(
      new TextDecoder().decode(inflate(Buffer.from(encrypted, 'base64')))
    );
    expect(backup.data.userData.owner.password).toBe(
      'hashed:owner-placeholder'
    );
    expect(backup.data.userData.owner.followings).toEqual({
      'normal+1': expect.objectContaining({ title: 'Show' }),
    });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(events.at(-1).type).toBe('done');
  });
  it('restores once atomically; missing RPC does not clear data or publish done', async () => {
    const config = {
      ConfigFile: '{}',
      SiteConfig: { SiteName: 'Test', DisableYellowFilter: false },
      UserConfig: { AllowRegister: false, Users: [] },
      SourceConfig: [],
      CustomCategories: [],
    };
    const encrypted = Buffer.from(
      deflate(JSON.stringify({ data: { adminConfig: config, userData: {} } }))
    ).toString('base64');
    const form = new Map<string, unknown>([
      ['file', { size: encrypted.length, text: async () => encrypted }],
      ['password', 'backup'],
    ]);
    mockDb.restoreAllData.mockRejectedValueOnce(
      new Error('002_atomic_kv required')
    );
    const { POST } = await import('./import/route');
    const failure = await POST({ formData: async () => form } as never);
    expect(await failure.text()).toContain('002_atomic_kv');
    expect(mockDb.clearAllData).not.toHaveBeenCalled();
    expect(mockDb.restoreAllData).toHaveBeenCalledTimes(1);
    mockDb.restoreAllData.mockResolvedValueOnce(undefined);
    const success = await POST({ formData: async () => form } as never);
    const text = await success.text();
    expect(text).toContain('"type":"done"');
    expect(mockDb.restoreAllData).toHaveBeenCalledWith([
      { key: 'admin:config', value: config },
    ]);
  });
});
