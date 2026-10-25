import { parseM3U8 } from './m3u8-downloader';
import { fetchMediaUrl } from './url-guard';

jest.mock('./mp4-transmuxer', () => ({
  StreamingTransmuxer: jest.fn(),
  transmuxTSToMP4: jest.fn(),
}));
jest.mock('./url-guard', () => ({ fetchMediaUrl: jest.fn() }));

const media = '#EXTM3U\n#EXTINF:5,\nchunk.ts\n#EXT-X-ENDLIST';
const response = (text: string, url = '', upstream = '') =>
  ({
    ok: true,
    url,
    headers: { get: () => upstream || null },
    text: async () => text,
  } as unknown as Response);
const proxy = (url: string) => `/api/m3u8?url=${encodeURIComponent(url)}`;
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.resetAllMocks();
});

it('falls back for recursive playlists and AES keys using the final upstream URL', async () => {
  const master = 'https://entry.test/master.m3u8';
  const child = 'https://cdn.test/final/child.m3u8';
  const key = 'https://cdn.test/keys/video.key';
  const bytes = new Uint8Array(16).fill(7).buffer;
  global.fetch = jest.fn(async (url) => {
    if (url === proxy(master)) {
      return response(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nchild.m3u8',
        'http://localhost/api/m3u8',
        'https://cdn.test/final/master.m3u8'
      );
    }
    if (url === proxy(child)) {
      return response(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../keys/video.key"\n#EXTINF:5,\nchunk.ts\n#EXT-X-ENDLIST',
        'http://localhost/api/m3u8',
        child
      );
    }
    if (url === proxy(key)) {
      return {
        ...response('', 'http://localhost/api/m3u8', key),
        arrayBuffer: async () => bytes,
      };
    }
    throw new TypeError('Failed to fetch');
  });
  const controller = new AbortController();
  const task = await parseM3U8(master, 0, {
    allowProxyFallback: true,
    signal: controller.signal,
  });
  expect(task.url).toBe(child);
  expect(task.tsUrlList).toEqual(['https://cdn.test/final/chunk.ts']);
  expect(task.aesConf.uri).toBe(key);
  expect(task.aesConf.key.toString()).toBe('07070707070707070707070707070707');
  expect(fetch).toHaveBeenCalledTimes(6);
  expect(fetch).toHaveBeenCalledWith(proxy(key), {
    signal: controller.signal,
    credentials: 'same-origin',
    cache: 'no-store',
  });
});

it('keeps direct response URL authoritative instead of trusting an external header', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      response(
        media,
        'https://cdn.test/final/index.m3u8',
        'https://forged.test/index.m3u8'
      )
    );
  const task = await parseM3U8('https://entry.test/start.m3u8', 0, {
    allowProxyFallback: true,
  });
  expect(task.tsUrlList).toEqual(['https://cdn.test/final/chunk.ts']);
});

it('does not bypass a custom safe fetcher on failure', async () => {
  const fetcher = jest.fn().mockRejectedValue(new Error('blocked by policy'));
  global.fetch = jest.fn();
  await expect(
    parseM3U8('https://cdn.test/index.m3u8', { fetcher }, 0, {
      allowProxyFallback: true,
    })
  ).rejects.toThrow('blocked by policy');
  expect(fetch).not.toHaveBeenCalled();
});

it('never falls back from server-side validation to the client proxy', async () => {
  (fetchMediaUrl as jest.Mock).mockRejectedValue(new Error('unsafe target'));
  global.fetch = jest.fn();
  await expect(
    parseM3U8('https://cdn.test/index.m3u8', 0, {
      allowProxyFallback: true,
      validateUrls: true,
    })
  ).rejects.toThrow('unsafe target');
  expect(fetch).not.toHaveBeenCalled();
});

it('does not convert aborts into fresh proxy requests', async () => {
  const controller = new AbortController();
  global.fetch = jest.fn(async () => {
    controller.abort();
    throw new DOMException('Aborted', 'AbortError');
  });
  await expect(
    parseM3U8('https://cdn.test/index.m3u8', 0, {
      signal: controller.signal,
      allowProxyFallback: true,
    })
  ).rejects.toThrow('Aborted');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['http://localhost/api/m3u8?url=x', 'file:///tmp/video.m3u8'])(
  'never wraps same-origin or non-HTTP targets in the proxy: %s',
  async (url) => {
    global.fetch = jest.fn().mockRejectedValue(new Error('failed'));
    await expect(
      parseM3U8(url, 0, { allowProxyFallback: true })
    ).rejects.toThrow('failed');
    expect(fetch).toHaveBeenCalledTimes(1);
  }
);

it('checks URL validation before fetching and after a redirect', async () => {
  const validateUrl = jest.fn((url: string) => {
    if (url.includes('127.0.0.1')) throw new Error('unsafe redirect');
  });
  global.fetch = jest
    .fn()
    .mockResolvedValue(response(media, 'http://127.0.0.1/'));
  await expect(
    parseM3U8('https://cdn.test/index.m3u8', { validateUrl }, 0, {
      allowProxyFallback: true,
    })
  ).rejects.toThrow('unsafe redirect');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(validateUrl).toHaveBeenCalledWith('https://cdn.test/index.m3u8');
});

it('does not use fallback without explicit opt-in', async () => {
  global.fetch = jest.fn().mockRejectedValue(new TypeError('network failure'));
  await expect(parseM3U8('https://cdn.test/index.m3u8')).rejects.toThrow(
    'network failure'
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
