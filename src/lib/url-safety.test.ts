/* eslint-disable @typescript-eslint/no-var-requires */

import { lookup } from 'node:dns/promises';

import { pinnedFetch } from './pinned-fetch';
import { assertSafeResolvedUrl, assertSafeUrl, safeFetch } from './url-safety';

jest.mock('./pinned-fetch', () => ({ pinnedFetch: jest.fn() }));

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

const mockLookup = lookup as jest.MockedFunction<typeof lookup>;

describe('url-safety', () => {
  beforeAll(() => {
    const { Blob, File } = require('node:buffer');
    Object.assign(globalThis, { Blob, File });
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { fetch, Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { fetch, Headers, Request, Response });
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    mockLookup.mockReset();
    (pinnedFetch as jest.Mock).mockReset();
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
    const fetchSpy = (pinnedFetch as jest.Mock).mockResolvedValue(
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

describe('pinned safeFetch lifecycle', () => {
  const fetchMock = pinnedFetch as jest.Mock;
  beforeEach(() => {
    jest.useRealTimers();
    fetchMock.mockReset();
    mockLookup.mockReset();
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);
  });

  it('passes exactly validated answers and preserves signed URL / Range', async () => {
    fetchMock.mockResolvedValue(new Response('bytes', { status: 206 }));
    const response = await safeFetch(
      'https://cdn.example/seg.ts?sig=a%2Fb&x=1',
      {
        headers: { Range: 'bytes=0-4', Host: 'evil.example' },
      }
    );
    expect(fetchMock.mock.calls[0][0].href).toBe(
      'https://cdn.example/seg.ts?sig=a%2Fb&x=1'
    );
    expect(fetchMock.mock.calls[0][1]).toEqual([
      { address: '93.184.216.34', family: 4 },
    ]);
    expect(fetchMock.mock.calls[0][2].headers.get('range')).toBe('bytes=0-4');
    expect(fetchMock.mock.calls[0][2].headers.has('host')).toBe(false);
    expect(await response.text()).toBe('bytes');
    expect(response.status).toBe(206);
    expect(response.url).toContain('sig=a%2Fb');
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  it('re-resolves every hop and strips credentials only across origins', async () => {
    const seen: string[][] = [];
    fetchMock
      .mockImplementationOnce(async (_url, _addresses, init) => {
        seen.push([
          init.headers.get('authorization'),
          init.headers.get('cookie'),
        ]);
        return new Response(null, {
          status: 302,
          headers: { location: '/next' },
        });
      })
      .mockImplementationOnce(async (_url, _addresses, init) => {
        seen.push([
          init.headers.get('authorization'),
          init.headers.get('cookie'),
        ]);
        return new Response(null, {
          status: 307,
          headers: { location: 'https://other.example/end' },
        });
      })
      .mockImplementationOnce(async (_url, _addresses, init) => {
        seen.push([
          init.headers.get('authorization'),
          init.headers.get('cookie'),
        ]);
        return new Response('done');
      });
    const response = await safeFetch('https://cdn.example/start', {
      headers: { Authorization: 'secret', Cookie: 'secret' },
    });
    await response.text();
    expect(seen).toEqual([
      ['secret', 'secret'],
      ['secret', 'secret'],
      [null, null],
    ]);
    expect(mockLookup).toHaveBeenCalledTimes(3);
  });

  it('rejects a rebind on the same hostname before the second socket', async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as never)
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never);
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: '/next' } })
    );
    await expect(safeFetch('https://cdn.example/start')).rejects.toThrow(
      '內網'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancels redirect bodies and rejects redirect loops', async () => {
    const cancelled = jest.fn();
    fetchMock.mockImplementation(
      async () =>
        new Response(new ReadableStream({ cancel: cancelled }), {
          status: 302,
          headers: { location: '/next' },
        })
    );
    await expect(
      safeFetch('https://cdn.example/start', {}, { maxRedirects: 1 })
    ).rejects.toThrow('Redirect');
    expect(cancelled).toHaveBeenCalledTimes(2);
  });

  it('bounds a stalled DNS lookup and honors pre-aborted callers', async () => {
    mockLookup.mockImplementation(() => new Promise(() => undefined));
    await expect(
      safeFetch('https://cdn.example/start', {}, { timeoutMs: 5 })
    ).rejects.toThrow();
    const abort = new AbortController();
    abort.abort(new Error('caller cancelled'));
    mockLookup.mockReset();
    await expect(
      safeFetch('https://cdn.example/start', { signal: abort.signal })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('consumes late DNS rejection after caller abort wins the race', async () => {
    mockLookup.mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('late resolver failure')), 20);
        })
    );
    const abort = new AbortController();
    const work = safeFetch('https://cdn.example/start', {
      signal: abort.signal,
    });
    abort.abort();
    await expect(work).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts upstream when downstream cancels its stream', async () => {
    const cancelled = jest.fn();
    fetchMock.mockResolvedValue(
      new Response(new ReadableStream({ cancel: cancelled }))
    );
    const response = await safeFetch('https://cdn.example/stream');
    await response.body?.cancel();
    expect(fetchMock.mock.calls[0][2].signal.aborted).toBe(true);
    expect(cancelled).toHaveBeenCalled();
  });
});
