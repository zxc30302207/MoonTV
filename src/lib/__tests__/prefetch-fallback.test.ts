import { parseM3U8 } from '../m3u8-downloader';
import {
  getCachedSegmentRecords,
  loadCacheSettings,
  metaStore,
  SegmentMeta,
} from '../video-cache';
import { VideoPrefetcher } from '../video-prefetcher';

jest.mock('../m3u8-downloader', () => ({ parseM3U8: jest.fn() }));
jest.mock('../video-cache', () => ({
  ...jest.requireActual('../video-cache'),
  getCachedSegmentRecords: jest.fn().mockResolvedValue([]),
  buildSegmentCacheKey: (url: string, proxy: boolean) =>
    proxy ? `/api/m3u8?url=${encodeURIComponent(url)}` : url,
  enforceQuota: jest.fn().mockResolvedValue(0),
  ensurePersistentStorage: jest.fn().mockResolvedValue(true),
  hasCachedSegment: jest.fn().mockResolvedValue(false),
  loadCacheSettings: jest.fn(),
  metaStore: { put: jest.fn().mockResolvedValue(undefined) },
  putCachedSegmentResilient: jest.fn().mockResolvedValue('ok'),
  touchMeta: jest.fn().mockResolvedValue(undefined),
}));

const settings = {
  enabled: true,
  concurrency: 1,
  horizonSeconds: 0,
  useProxy: true,
  maxBytesPerEpisode: 1e6,
  maxTotalBytes: 1e7,
};
const options = {
  m3u8Url: 'https://cdn.example.com/movie/index.m3u8',
  currentTime: 0,
  episodeKey: 'source:id:0',
};
const task = {
  tsUrlList: ['https://cdn.example.com/movie/1.ts'],
  segmentDurations: [600],
  durationSecond: 600,
};
const flush = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  (loadCacheSettings as jest.Mock).mockReturnValue(settings);
  const records: SegmentMeta[] = [];
  (getCachedSegmentRecords as jest.Mock).mockImplementation(async () =>
    records.slice()
  );
  (metaStore.put as jest.Mock).mockImplementation(async (record) => {
    records.push(record);
  });
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {},
  });
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: true,
  });
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => 'video/mp2t' },
    arrayBuffer: async () => new ArrayBuffer(8),
  });
});

it.each([401, 403, 404, 410, 'cors'])(
  'switches directly to the proxy without retry delays for %s',
  async (status) => {
    (parseM3U8 as jest.Mock).mockResolvedValue(task);
    const direct = task.tsUrlList[0];
    const proxy = `/api/m3u8?url=${encodeURIComponent(direct)}`;
    global.fetch = jest.fn(async (url) => {
      if (url === direct) {
        if (status === 'cors') throw new TypeError('Failed to fetch');
        return {
          ok: false,
          status,
          body: { cancel: jest.fn().mockResolvedValue(undefined) },
        } as unknown as Response;
      }
      return {
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(8),
      } as unknown as Response;
    });
    const prefetcher = new VideoPrefetcher();
    prefetcher.ensure(options);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, direct, expect.any(Object));
    expect(fetch).toHaveBeenNthCalledWith(2, proxy, expect.any(Object));
    expect(prefetcher.getStats()).toMatchObject({ state: 'done', cached: 1 });
    prefetcher.stop();
  }
);

it('retains retry backoff for transient server errors instead of immediately switching routes', async () => {
  jest.useFakeTimers();
  (parseM3U8 as jest.Mock).mockResolvedValue(task);
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
  const prefetcher = new VideoPrefetcher();
  try {
    prefetcher.ensure(options);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1000);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url] of (fetch as jest.Mock).mock.calls) {
      expect(url).toBe(task.tsUrlList[0]);
    }
  } finally {
    prefetcher.stop();
    await flush();
    jest.useRealTimers();
  }
});

it('retries a truncated segment body on the same route before using the proxy', async () => {
  jest.useFakeTimers();
  (parseM3U8 as jest.Mock).mockResolvedValue(task);
  const direct = task.tsUrlList[0];
  let attempts = 0;
  global.fetch = jest.fn(async (url) => {
    if (url !== direct) {
      throw new Error(`unexpected fetch ${String(url)}`);
    }
    attempts += 1;
    if (attempts === 1) {
      return {
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => {
          throw new TypeError('Connection closed');
        },
      } as unknown as Response;
    }
    return {
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(8),
    } as unknown as Response;
  });
  const prefetcher = new VideoPrefetcher();
  try {
    prefetcher.ensure(options);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1000);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      (fetch as jest.Mock).mock.calls.map((call: unknown[]) => call[0])
    ).toEqual([direct, direct]);
    expect(prefetcher.getStats()).toMatchObject({ state: 'done', cached: 1 });
  } finally {
    prefetcher.stop();
    await flush();
    jest.useRealTimers();
  }
});

it('retains useful parse error details without changing the safe filtering pipeline', async () => {
  (parseM3U8 as jest.Mock).mockRejectedValue(new Error('HTTP 403'));
  const prefetcher = new VideoPrefetcher();
  prefetcher.ensure(options);
  await flush();
  expect((parseM3U8 as jest.Mock).mock.calls[0][0]).toContain(
    '/api/m3u8/filter?'
  );
  expect(prefetcher.getStats()).toMatchObject({
    state: 'error',
    message: '播放列表解析失敗：HTTP 403',
  });
  prefetcher.stop();
});
