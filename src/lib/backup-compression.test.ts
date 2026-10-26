import { deflate } from 'pako';

import { inflateBackup } from './backup-compression';

test('rejects excessive decompressed data without accepting a compressed zip bomb', () => {
  expect(() => inflateBackup(deflate('x'.repeat(10000)), 100)).toThrow(
    '大小限制'
  );
  expect(inflateBackup(deflate('繁體資料'), 100)).toBe('繁體資料');
  expect(() => inflateBackup(new Uint8Array([1, 2, 3]))).toThrow();
});
