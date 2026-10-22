import { readCachedSegment, touchMeta } from '@/lib/video-cache';

import {
  createCustomHlsLoader,
  filterAdsFromM3U8,
  readAdFilterReport,
} from '../play-utils';

jest.mock('@/lib/video-cache', () => ({
  DEFAULT_CACHE_SETTINGS: { useProxy: true },
  loadCacheSettings: () => ({ useProxy: true }),
  buildSegmentCacheKey: (
    url: string,
    proxy: boolean,
    range?: { start: number; end: number }
  ) =>
    `${proxy ? '/api/m3u8?url=' : ''}${encodeURIComponent(url)}${
      range ? `#range=${range.start}-${range.end}` : ''
    }`,
  readCachedSegment: jest.fn(),
  recordSegmentProbe: jest.fn(),
  touchMeta: jest.fn().mockResolvedValue(undefined),
}));

const baseLoad = jest.fn();
class BaseLoader {
  stats = {};
  load = baseLoad;
  abort = jest.fn();
  destroy = jest.fn();
}
const Hls = { DefaultConfig: { loader: BaseLoader } };
const context = {
  frag: { sn: 1 },
  responseType: 'arraybuffer',
  url: 'https://cdn.example.com/movie/segment.ts',
  rangeStart: 0,
  rangeEnd: 0,
};
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {},
  });
});

describe('HLS loader integration', () => {
  it('serves actual hls.js fragment contexts from cache with finite measured stats', async () => {
    const data = new ArrayBuffer(1024);
    (readCachedSegment as jest.Mock).mockResolvedValue({
      fragment: { data, costMs: 20 },
      matchedKey: 'cached',
    });
    const Loader = createCustomHlsLoader(Hls);
    const loader = new Loader({});
    const onSuccess = jest.fn();
    loader.load(context, {}, { onSuccess });
    await flush();
    expect(baseLoad).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith(
      { url: context.url, data },
      expect.objectContaining({ loaded: 1024, bwEstimate: 409600 }),
      context
    );
    expect(touchMeta).toHaveBeenCalled();
  });

  it('uses separate byte-range cache keys instead of full responses', async () => {
    const data = new ArrayBuffer(1024);
    (readCachedSegment as jest.Mock).mockResolvedValue({
      fragment: { data, costMs: 10 },
      matchedKey: 'ranged',
    });
    const Loader = createCustomHlsLoader(Hls);
    const callbacks = { onSuccess: jest.fn() };
    const rangeContext = { ...context, rangeEnd: 1024 };
    new Loader({}).load(rangeContext, {}, callbacks);
    await flush();
    expect(baseLoad).not.toHaveBeenCalled();
    expect(readCachedSegment).toHaveBeenCalledWith(
      expect.stringContaining('#range=0-1024')
    );
    expect(callbacks.onSuccess).toHaveBeenCalledWith(
      { url: context.url, data },
      expect.anything(),
      rangeContext
    );
  });

  it('bypasses cache for invalid byte ranges rather than returning a full fragment', () => {
    const Loader = createCustomHlsLoader(Hls);
    const callbacks = { onSuccess: jest.fn() };
    const rangeContext = { ...context, rangeStart: 1024, rangeEnd: 512 };
    new Loader({}).load(rangeContext, {}, callbacks);
    expect(baseLoad).toHaveBeenCalledWith(rangeContext, {}, callbacks);
    expect(readCachedSegment).not.toHaveBeenCalled();
  });

  it('falls back to network on cache miss', async () => {
    (readCachedSegment as jest.Mock).mockResolvedValue(null);
    const Loader = createCustomHlsLoader(Hls);
    const callbacks = { onSuccess: jest.fn() };
    new Loader({}).load(context, {}, callbacks);
    await flush();
    expect(baseLoad).toHaveBeenCalledWith(context, {}, callbacks);
  });

  it('does not deliver a stale cache lookup after abort or reuse', async () => {
    let resolveOld!: (data: unknown) => void;
    (readCachedSegment as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockResolvedValueOnce({
        fragment: { data: new ArrayBuffer(1), costMs: 1 },
        matchedKey: 'cached',
      });
    const Loader = createCustomHlsLoader(Hls);
    const loader = new Loader({});
    const oldSuccess = jest.fn();
    const newSuccess = jest.fn();
    loader.load(context, {}, { onSuccess: oldSuccess });
    loader.abort();
    loader.load(
      { ...context, url: 'https://cdn.example.com/new.ts' },
      {},
      { onSuccess: newSuccess }
    );
    resolveOld({
      fragment: { data: new ArrayBuffer(1), costMs: 1 },
      matchedKey: 'cached',
    });
    await flush();
    expect(oldSuccess).not.toHaveBeenCalled();
    expect(newSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not continue cache candidates or start network after a cancelled cache miss', async () => {
    let resolveOld!: (value: null) => void;
    (readCachedSegment as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    );
    const Loader = createCustomHlsLoader(Hls);
    const loader = new Loader({});
    const onSuccess = jest.fn();
    loader.load(context, {}, { onSuccess });
    loader.destroy();
    resolveOld(null);
    await flush();
    expect(readCachedSegment).toHaveBeenCalledTimes(1);
    expect(baseLoad).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('uses bounded ad cues while retaining encrypted programme media', () => {
    const playlist =
      '#EXTM3U\n#EXT-X-CUE-OUT:2\n#EXTINF:2,\nhttps://cdn.example.com/AD/preroll.ts\n#EXT-X-DISCONTINUITY\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:8,\nhttps://cdn.example.com/movie/main.ts\n#EXT-X-ENDLIST';
    const filtered = filterAdsFromM3U8(playlist);
    expect(filtered).not.toContain('/AD/');
    expect(filtered).toContain('#EXT-X-KEY');
    expect(filtered).toContain('movie/main.ts');
  });
});

it('reports server filtering without destructively filtering the returned playlist twice', () => {
  const report = { removedSegments: 4, removedSeconds: 17.567 };
  const playlist = `#EXTM3U\n#MOONTV-AD-FILTER:${JSON.stringify(
    report
  )}\n#EXTINF:8,\n/ads/already-verified-main.ts\n#EXTINF:8,\n/main/real.ts\n#EXT-X-ENDLIST`;
  baseLoad.mockImplementationOnce((ctx, _cfg, callbacks) =>
    callbacks.onSuccess({ data: playlist }, {}, ctx)
  );
  const onAdFilter = jest.fn();
  const onSuccess = jest.fn();
  const Loader = createCustomHlsLoader(Hls, { onAdFilter });
  new Loader({}).load(
    { type: 'level', url: '/api/m3u8/filter?url=target' },
    {},
    { onSuccess }
  );
  expect(onAdFilter).toHaveBeenCalledWith(report);
  expect(onSuccess.mock.calls[0][0].data).toBe(playlist);
});

it('does not trust diagnostic comments from an external media host', () => {
  const playlist =
    '#EXTM3U\n#MOONTV-AD-FILTER:{"removedSegments":999,"removedSeconds":999}\n#EXTINF:8,\n/main/real.ts\n#EXT-X-ENDLIST';
  baseLoad.mockImplementationOnce((ctx, _cfg, callbacks) =>
    callbacks.onSuccess({ data: playlist }, {}, ctx)
  );
  const onAdFilter = jest.fn();
  const Loader = createCustomHlsLoader(Hls, { onAdFilter });
  new Loader({}).load(
    { type: 'level', url: 'https://external.example.com/index.m3u8' },
    {},
    { onSuccess: jest.fn() }
  );
  expect(onAdFilter).toHaveBeenCalledWith({
    removedSegments: 0,
    removedSeconds: 0,
  });
  expect(
    readAdFilterReport(
      '#MOONTV-AD-FILTER:{"removedSegments":-1,"removedSeconds":0}'
    )
  ).toBeNull();
});
