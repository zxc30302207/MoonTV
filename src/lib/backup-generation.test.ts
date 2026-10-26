import { createHmac } from 'crypto';

import type { AdminConfig } from './admin.types';
import { backupToRows, snapshotToBackup } from './backup-kv';

jest.mock('./password', () => ({
  normalizePasswordForStorage: async (value: string) => value,
}));

test('restoring the same saved credential twice never revives its previous session generation', async () => {
  const config = { UserConfig: { Users: [] } } as unknown as AdminConfig;
  const credential = {
    hash: 'synthetic-saved-hash',
    revokedBefore: 100,
    generation: 'synthetic-old-generation',
  };
  const backup = snapshotToBackup([
    { key: 'admin:config', value: config },
    { key: 'u:alice:pwd', value: credential },
  ]);
  const first = (await backupToRows(backup, 100)).find(
    (row) => row.key === 'u:alice:pwd'
  )?.value as typeof credential;
  const second = (await backupToRows(backup, 100)).find(
    (row) => row.key === 'u:alice:pwd'
  )?.value as typeof credential;
  const version = (value: typeof credential) =>
    createHmac('sha256', 'synthetic-test-secret')
      .update(JSON.stringify(['alice', value.hash, value.generation || '']))
      .digest('hex');
  expect(first.hash).toBe(credential.hash);
  expect(second.hash).toBe(credential.hash);
  expect(first.generation).not.toBe(credential.generation);
  expect(second.generation).not.toBe(first.generation);
  expect(version(first)).not.toBe(version(credential));
  expect(version(second)).not.toBe(version(first));
});
