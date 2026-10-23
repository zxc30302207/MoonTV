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

  it.each([
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:a00:1',
    '::ffff:192.168.1.1',
    '::ffff:169.254.169.254',
    '0:0:0:0:0:0:0:1',
    '::',
    'fc00::1',
    'fdff::1',
    'fe80::1',
    'fe90::1',
    'febf:ffff::1',
  ])('rejects private IPv6 literal %s before fetch', async (address) => {
    const url = `http://[${address}]/image.png`;
    expect(() => assertSafeUrl(url)).toThrow();
    await expect(assertSafeResolvedUrl(url)).rejects.toThrow();
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await expect(safeFetch(url)).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it.each(['::ffff:8.8.8.8', '::ffff:808:808', '2001:4860:4860::8888'])(
    'allows public IPv6 literal %s',
    async (address) => {
      await expect(
        assertSafeResolvedUrl(`https://[${address}]/`)
      ).resolves.toBeInstanceOf(URL);
    }
  );

  it.each(['fcdn.example.com', 'fdimages.example.com'])(
    'does not mistake a domain starting with fc/fd for a private IPv6 address: %s',
    async (host) => {
      await expect(
        assertSafeResolvedUrl(`https://${host}/`)
      ).resolves.toBeInstanceOf(URL);
      expect(mockLookup).toHaveBeenCalledWith(host, {
        all: true,
        verbatim: true,
      });
    }
  );

  it('rejects DNS answers containing IPv4-mapped private IPv6', async () => {
    mockLookup.mockResolvedValue([
      { address: '::ffff:127.0.0.1', family: 6 },
    ] as never);
    await expect(
      assertSafeResolvedUrl('https://media.example.com/')
    ).rejects.toThrow();
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
