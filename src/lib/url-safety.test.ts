/* eslint-disable @typescript-eslint/no-var-requires */

import { lookup } from 'node:dns/promises';

import { assertSafeResolvedUrl, assertSafeUrl, safeFetch } from './url-safety';

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

const mockLookup = lookup as jest.MockedFunction<typeof lookup>;

describe('url-safety', () => {
  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { fetch, Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { fetch, Headers, Request, Response });
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    mockLookup.mockReset();
    mockLookup.mockResolvedValue([
      { address: '203.0.113.10', family: 4 },
    ] as never);
  });

  it('rejects localhost, private IPs, and userinfo URLs', () => {
    expect(() => assertSafeUrl('http://localhost/video.m3u8')).toThrow();
    expect(() => assertSafeUrl('http://127.0.0.1/video.m3u8')).toThrow();
    expect(() => assertSafeUrl('http://[::1]/video.m3u8')).toThrow();
    expect(() =>
      assertSafeUrl('https://user:pass@example.com/video.m3u8')
    ).toThrow();
  });

  it('rejects public hostnames that resolve to private addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);

    await expect(
      assertSafeResolvedUrl('https://media.example.com/index.m3u8')
    ).rejects.toThrow();
  });

  it('revalidates redirect targets before following them', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
        status: 302,
      }) as Response
    );

    await expect(
      safeFetch('https://media.example.com/index.m3u8')
    ).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
