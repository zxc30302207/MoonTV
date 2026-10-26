/* eslint-disable @typescript-eslint/no-var-requires */
const mockSave = jest.fn();
jest.mock('@/lib/auth-server', () => ({
  getVerifiedAuthInfo: async () => ({ username: 'alice', role: 'user' }),
}));
jest.mock('@/lib/config', () => ({
  getConfig: async () => ({ UserConfig: { Users: [{ username: 'alice' }] } }),
}));
jest.mock('@/lib/db', () => ({ db: { savePlayRecord: mockSave } }));
beforeAll(() => {
  const { MessageChannel, MessagePort } = require('worker_threads');
  Object.assign(globalThis, { MessageChannel, MessagePort });
  const { Headers, Request, Response } = require('undici');
  Object.assign(globalThis, { Headers, Request, Response });
});
const valid = {
  title: 'Show',
  source_name: 'Source',
  cover: '',
  year: '2026',
  index: 1,
  total_episodes: 2,
  play_time: 0,
  total_time: 100,
  save_time: 1,
  search_title: 'Show',
};
async function post(key: unknown, record: unknown) {
  const { POST } = await import('./route');
  return POST({ json: async () => ({ key, record }) } as never);
}
beforeEach(() => jest.clearAllMocks());
test.each([
  { ...valid, total_time: NaN },
  { ...valid, index: 1.5 },
  { ...valid, total_episodes: -1 },
  { ...valid, year: undefined },
])('rejects incomplete/invalid record before persistence', async (record) => {
  expect((await post('source+1', record)).status).toBe(400);
  expect(mockSave).not.toHaveBeenCalled();
});
test.each(['source+id+ambiguous', 5, '+id'])(
  'rejects ambiguous or non-string identity %p',
  async (key) => {
    expect((await post(key, valid)).status).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
  }
);
test('writes a schema-valid record without changing its identity', async () => {
  expect((await post('source+1', valid)).status).toBe(200);
  expect(mockSave).toHaveBeenCalledWith('alice', 'source', '1', valid);
});
