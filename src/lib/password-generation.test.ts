/** @jest-environment node */
import { webcrypto } from 'crypto';

import {
  hashPassword,
  normalizePasswordForStorage,
  verifyPassword,
} from './password';

beforeAll(() =>
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  })
);

test('new passwords always get a fresh salt even when input looks like an encoded hash', async () => {
  const encoded = await hashPassword('original-password');
  const first = await hashPassword(encoded);
  const second = await hashPassword(encoded);
  expect(first).not.toBe(encoded);
  expect(second).not.toBe(first);
  expect((await verifyPassword(encoded, first)).valid).toBe(true);
  // Only the explicit trusted backup path preserves an already stored hash.
  expect(await normalizePasswordForStorage(encoded)).toBe(encoded);
});
