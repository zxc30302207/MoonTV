import type { AdminConfig } from './admin.types';
import { backupToRows, snapshotToBackup } from './backup-kv';

jest.mock('./password', () => ({
  normalizePasswordForStorage: async (s: string) =>
    s.startsWith('hash:') ? s : `hash:${s}`,
}));
const config = {
  ConfigFile: '{}',
  SiteConfig: { SiteName: 'Test', DisableYellowFilter: false },
  UserConfig: { AllowRegister: false, Users: [] },
  SourceConfig: [],
  CustomCategories: [],
} as unknown as AdminConfig;

test('single snapshot round trip preserves all namespaces, duplicate titles, future fields and opaque rows', async () => {
  const rows = [
    { key: 'admin:config', value: config },
    { key: 'u:alice:pwd', value: { hash: 'hash:secret', revokedBefore: 200 } },
    {
      key: 'u:alice:pr:a+1',
      value: { title: 'Same', year: '1990', future: 42 },
    },
    { key: 'u:alice:pr:b+2', value: { title: 'Same', year: '2026' } },
    { key: 'u:alice:fav:a+1', value: { title: 'Same' } },
    { key: 'u:alice:following:a+1', value: { title: 'Same' } },
    { key: 'u:alice:skip:a+1', value: { enable: true } },
    { key: 'u:alice:sh', value: ['one', 'two'] },
    { key: 'u:alice:today-updated', value: { date: '2026-10-26', items: [] } },
    { key: 'future:setting', value: { keep: true } },
  ];
  const restored = await backupToRows(snapshotToBackup(rows), 300);
  expect(restored).toEqual(
    expect.arrayContaining(rows.filter((r) => r.key !== 'u:alice:pwd'))
  );
  expect(restored.find((r) => r.key === 'u:alice:pwd')?.value).toEqual({
    hash: 'hash:secret',
    revokedBefore: 300,
    generation: expect.any(String),
  });
  expect(restored).toHaveLength(rows.length);
});

test('malformed reserved keys fail explicitly instead of overwriting a credential or omitting records', () => {
  for (const key of ['u:alice:pwd:extra', 'u:alice:pr:']) {
    expect(() =>
      snapshotToBackup([
        { key: 'admin:config', value: config },
        { key, value: 'bad' },
      ])
    ).toThrow();
  }
});

test('duplicate/known extra rows fail before any transaction is called', async () => {
  const base = {
    adminConfig: config,
    userData: {},
    extraRows: [{ key: 'admin:config', value: {} }],
  };
  await expect(backupToRows(base)).rejects.toThrow();
  await expect(
    backupToRows({
      ...base,
      extraRows: [{ key: 'u:alice:pwd', value: 'inject' }],
    })
  ).rejects.toThrow();
});

test('null-prototype dictionaries preserve a literal __proto__ record without prototype mutation', () => {
  const snapshot = snapshotToBackup([
    { key: 'admin:config', value: config },
    { key: 'u:alice:pr:__proto__', value: { title: 'legacy' } },
  ]);
  expect(Object.keys(snapshot.userData.alice.playRecords || {})).toEqual([
    '__proto__',
  ]);
  expect(Object.getPrototypeOf(snapshot.userData.alice.playRecords)).toBe(null);
});
