/* eslint-disable @typescript-eslint/no-var-requires */

import {
  createTVBoxToken,
  verifyTVBoxToken,
  verifyTVBoxTokenPayload,
} from './tvbox-auth';

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

  it('returns authenticated issuance time for session revocation checks', async () => {
    const now = Date.now();
    const token = await createTVBoxToken('alice', now);
    await expect(verifyTVBoxTokenPayload(token, now)).resolves.toEqual({
      username: 'alice',
      timestamp: now,
    });
    await expect(verifyTVBoxToken(`${token}.extra`, now)).resolves.toBeNull();
  });

  it('authenticates the credential generation within the token payload', async () => {
    const now = Date.now();
    const sessionVersion = 'a'.repeat(64);
    const token = await createTVBoxToken('alice', now, sessionVersion);
    await expect(verifyTVBoxTokenPayload(token, now)).resolves.toEqual({
      username: 'alice',
      timestamp: now,
      sessionVersion,
    });
    const [, signature] = token.split('.');
    const altered = Buffer.from(
      JSON.stringify({
        username: 'alice',
        timestamp: now,
        sessionVersion: 'b'.repeat(64),
      })
    ).toString('base64url');
    await expect(
      verifyTVBoxTokenPayload(`${altered}.${signature}`, now)
    ).resolves.toBeNull();
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
