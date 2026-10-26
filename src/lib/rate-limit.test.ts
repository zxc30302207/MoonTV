/** @jest-environment node */
import { Headers } from 'next/dist/compiled/@edge-runtime/primitives/fetch';

import { getClientIp, getRateLimitHeaders, rateLimit } from './rate-limit';

const originalEnv = process.env;
const originalFetch = global.fetch;
beforeEach(() => {
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_STORAGE_TYPE: 'supabase',
    PASSWORD: 'test-secret',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'test-key',
  };
  global.fetch = jest.fn();
});
afterEach(() => {
  process.env = originalEnv;
  global.fetch = originalFetch;
});
const config = { prefix: 'login', limit: 10, windowMs: 60_000 };
const answer = {
  allowed: true,
  remaining: 9,
  limit: 10,
  reset_at_ms: 1900000000000,
};

test('shared RPC hashes subject and does not cache or retry mutations', async () => {
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => answer,
  });
  expect(await rateLimit('203.0.113.1', config)).toEqual({
    allowed: true,
    remaining: 9,
    limit: 10,
    resetAt: answer.reset_at_ms,
  });
  const [, init] = (fetch as jest.Mock).mock.calls[0];
  expect(init.cache).toBe('no-store');
  const body = JSON.parse(init.body);
  expect(body.p_scope).toBe('login');
  expect(body.p_subject_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(init.body).not.toContain('203.0.113.1');
  await rateLimit('203.0.113.1', config);
  expect(fetch).toHaveBeenCalledTimes(2);
});
test.each(['network', 'http', 'malformed'])(
  'fails closed on %s',
  async (kind) => {
    if (kind === 'network')
      (fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    else
      (fetch as jest.Mock).mockResolvedValue({
        ok: kind !== 'http',
        json: async () => ({ allowed: true }),
      });
    const result = await rateLimit('ip', config);
    expect(result).toMatchObject({
      allowed: false,
      unavailable: true,
      remaining: 0,
    });
    expect(getRateLimitHeaders(result)['Retry-After']).toBe('30');
    expect(fetch).toHaveBeenCalledTimes(1);
  }
);
test('missing configuration never falls back locally', async () => {
  delete process.env.PASSWORD;
  expect(await rateLimit('ip', config)).toMatchObject({
    unavailable: true,
    allowed: false,
  });
  expect(fetch).not.toHaveBeenCalled();
});
test('unknown or changed scope is not accepted', async () => {
  expect(await rateLimit('ip', { ...config, limit: 999 })).toMatchObject({
    unavailable: true,
  });
  expect(fetch).not.toHaveBeenCalled();
});
test('over limit result is distinct from unavailable', async () => {
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ ...answer, allowed: false, remaining: 0 }),
  });
  expect(await rateLimit('ip', config)).toMatchObject({
    allowed: false,
    remaining: 0,
  });
  expect((await rateLimit('ip', config)).unavailable).toBeUndefined();
});
test('localstorage retains local limiter', async () => {
  process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';
  const local = { prefix: 'unique-local', limit: 1, windowMs: 60_000 };
  expect((await rateLimit('one', local)).allowed).toBe(true);
  expect((await rateLimit('one', local)).allowed).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
test('only platform-owned single IP header is trusted on Vercel', () => {
  process.env.VERCEL = '1';
  const headers = new Headers({
    'x-forwarded-for': '1.1.1.1',
    'x-vercel-forwarded-for': '203.0.113.1',
  });
  expect(getClientIp({ headers })).toBe('203.0.113.1');
  headers.set('x-vercel-forwarded-for', '203.0.113.1, 1.1.1.1');
  expect(getClientIp({ headers })).toBe('unknown');
});
test('self-hosted headers require explicit trusted ingress configuration', () => {
  delete process.env.VERCEL;
  delete process.env.RATE_LIMIT_TRUSTED_IP_HEADER;
  const headers = new Headers({ 'x-real-ip': '2001:0db8:0:0:0:0:0:1' });
  expect(getClientIp({ headers })).toBe('unknown');
  process.env.RATE_LIMIT_TRUSTED_IP_HEADER = 'x-real-ip';
  expect(getClientIp({ headers })).toBe('2001:db8::1');
});

test('aborts an unresponsive backend instead of allowing requests', async () => {
  jest.useFakeTimers();
  (fetch as jest.Mock).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const result = rateLimit('ip', config);
  jest.advanceTimersByTime(3000);
  expect(await result).toMatchObject({ allowed: false, unavailable: true });
  expect(fetch).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
