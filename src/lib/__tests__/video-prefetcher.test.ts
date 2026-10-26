import { parseM3U8 } from '../m3u8-downloader';
import {
  getCachedSegmentRecords,
  loadCacheSettings,
  metaStore,
  putCachedSegmentResilient,
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

it('does not restart unlimited prefetch while the playlist is still parsing', async () => {
  (parseM3U8 as jest.Mock).mockImplementation(
    () => new Promise(() => undefined)
  );
  const prefetcher = new VideoPrefetcher();
  prefetcher.ensure(options);
  prefetcher.ensure({ ...options, currentTime: 1 });
  await flush();
  expect(parseM3U8).toHaveBeenCalledTimes(1);
  prefetcher.stop();
});

it('keeps proxy requests authenticated and aligns the ad-filtered playlist with playback', async () => {
  (parseM3U8 as jest.Mock).mockResolvedValue(task);
  const prefetcher = new VideoPrefetcher();
  prefetcher.ensure(options);
  await flush();
  const parserOptions = (parseM3U8 as jest.Mock).mock.calls[0][1];
  const parsedUrl = (parseM3U8 as jest.Mock).mock.calls[0][0];
  expect(parsedUrl).toBe(
    'http://localhost/api/m3u8/filter?url=' +
      encodeURIComponent(options.m3u8Url)
  );
  expect(parserOptions.transformPlaylist).toBeUndefined();
  await parserOptions.fetcher(parsedUrl);
  expect(fetch).toHaveBeenCalledWith(
    parsedUrl,
    expect.objectContaining({
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    })
  );
  expect(fetch).toHaveBeenCalledWith(
    task.tsUrlList[0],
    expect.objectContaining({ credentials: 'same-origin' })
  );
  expect(prefetcher.getStats()).toMatchObject({ state: 'done', cached: 1 });
  prefetcher.stop();
});

it('does not let an aborted parse clear or overwrite the newer queue', async () => {
  let rejectOld!: (reason: Error) => void;
  (parseM3U8 as jest.Mock)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        })
    )
    .mockImplementationOnce(() => new Promise(() => undefined));
  const oldProgress = jest.fn();
  const newProgress = jest.fn();
  const prefetcher = new VideoPrefetcher();
  prefetcher.ensure({ ...options, onProgress: oldProgress });
  await flush();
  prefetcher.ensure({
    ...options,
    episodeKey: 'source:id:1',
    onProgress: newProgress,
  });
  rejectOld(new Error('aborted'));
  await flush();
  prefetcher.ensure({ ...options, episodeKey: 'source:id:1', currentTime: 1 });
  expect(parseM3U8).toHaveBeenCalledTimes(2);
  expect(prefetcher.getStats().state).toBe('parsing');
  expect(oldProgress).toHaveBeenCalledTimes(1);
  prefetcher.stop();
});

it('rebuilds the queue when ad filtering changes for the same episode', async () => {
  (parseM3U8 as jest.Mock).mockResolvedValue(task);
  const prefetcher = new VideoPrefetcher();
  prefetcher.ensure(options);
  await flush();
  prefetcher.ensure({ ...options, blockAd: false });
  await flush();
  expect(parseM3U8).toHaveBeenCalledTimes(2);
  expect(
    (parseM3U8 as jest.Mock).mock.calls[1][1].transformPlaylist
  ).toBeUndefined();
  prefetcher.stop();
});

it('stops before writing metadata after logout cancels an in-flight cache write', async () => {
  let finishWrite!: (result: string) => void;
  (parseM3U8 as jest.Mock).mockResolvedValue(task);
  (putCachedSegmentResilient as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishWrite = resolve;
      })
  );
  const prefetcher = new VideoPrefetcher();
  prefetcher.ensure(options);
  await flush();
  expect(finishWrite).toBeDefined();
  prefetcher.stop();
  finishWrite('ok');
  await flush();
  expect(metaStore.put).not.toHaveBeenCalled();
  expect(prefetcher.getStats().state).toBe('idle');
});

it('uses trusted raw-proxy redirect metadata as the unfiltered playlist base', async () => {
  (parseM3U8 as jest.Mock).mockResolvedValue(task);
  const prefetcher = new VideoPrefetcher();
  prefetcher.ensure({ ...options, blockAd: false });
  await flush();
  const parserOptions = (parseM3U8 as jest.Mock).mock.calls[0][1];
  expect((parseM3U8 as jest.Mock).mock.calls[0][0]).toBe(options.m3u8Url);
  const response = {
    url: 'http://localhost/api/m3u8?url=original',
    headers: { get: () => 'https://final.example.com/show/index.m3u8' },
  };
  expect(parserOptions.resolveResponseUrl(response, options.m3u8Url)).toBe(
    'https://final.example.com/show/index.m3u8'
  );
  expect(
    parserOptions.resolveResponseUrl(
      { ...response, headers: { get: () => null } },
      options.m3u8Url
    )
  ).toBe(options.m3u8Url);
  prefetcher.stop();
});

it('does not trust proxy metadata from a direct external response', async () => {
  (parseM3U8 as jest.Mock).mockResolvedValue(task);
  const prefetcher = new VideoPrefetcher();
  prefetcher.ensure({ ...options, blockAd: false, useProxy: false });
  await flush();
  const parserOptions = (parseM3U8 as jest.Mock).mock.calls[0][1];
  expect(
    parserOptions.resolveResponseUrl(
      {
        url: 'https://real.example.com/index.m3u8',
        headers: { get: () => 'https://forged.example.com/' },
      },
      options.m3u8Url
    )
  ).toBe('https://real.example.com/index.m3u8');
  prefetcher.stop();
});

it('retries a stalled segment rather than treating timeout as bandwidth yielding forever', async () => {
  jest.useFakeTimers();
  (parseM3U8 as jest.Mock).mockResolvedValue(task);
  (global.fetch as jest.Mock).mockImplementationOnce(
    () => new Promise(() => undefined)
  );
  const prefetcher = new VideoPrefetcher();
  try {
    prefetcher.ensure(options);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(15_000);
    await flush();
    // Timeout uses the existing bounded retry/backoff policy, not an immediate loop.
    expect(fetch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1_000);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(prefetcher.getStats()).toMatchObject({ state: 'done', cached: 1 });
  } finally {
    prefetcher.stop();
    jest.useRealTimers();
  }
});
