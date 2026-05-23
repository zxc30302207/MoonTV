/* eslint-disable @typescript-eslint/no-var-requires */

import { createTVBoxToken, verifyTVBoxToken } from './tvbox-auth';

describe('tvbox-auth', () => {
  const originalPassword = process.env.PASSWORD;

  beforeAll(() => {
    const { webcrypto } = require('crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
  });

  beforeEach(() => {
    process.env.PASSWORD = 'test-secret';
  });

  afterEach(() => {
    if (originalPassword === undefined) {
      delete process.env.PASSWORD;
    } else {
      process.env.PASSWORD = originalPassword;
    }
  });

  it('verifies a user-bound token', async () => {
    const token = await createTVBoxToken('alice', Date.now());

    await expect(verifyTVBoxToken(token)).resolves.toBe('alice');
  });

  it('rejects tampered tokens', async () => {
    const token = await createTVBoxToken('alice', Date.now());
    const [payload, signature] = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ timestamp: Date.now(), username: 'bob' }),
      'utf8'
    ).toString('base64url');

    await expect(
      verifyTVBoxToken(`${tamperedPayload}.${signature || payload}`)
    ).resolves.toBeNull();
  });

  it('rejects expired tokens', async () => {
    const token = await createTVBoxToken(
      'alice',
      Date.now() - 366 * 24 * 60 * 60 * 1000
    );

    await expect(verifyTVBoxToken(token)).resolves.toBeNull();
  });
});
