import { readCachedSegment } from '@/lib/video-cache';

import {
  applyHlsBufferPlan,
  createCustomHlsLoader,
  getDanmakuDensity,
  loadManualDanmaku,
  planHlsBuffer,
  setDanmakuDensity,
} from '../play-utils';

jest.mock('@/lib/video-cache', () => ({
  DEFAULT_CACHE_SETTINGS: { useProxy: true },
  loadCacheSettings: () => ({ useProxy: true }),
  buildSegmentCacheKey: (url: string) => url,
  readCachedSegment: jest.fn(),
  recordSegmentProbe: jest.fn(),
  touchMeta: jest.fn().mockResolvedValue(undefined),
}));

const MB = 1024 * 1024;

describe('4.7.5 HLS buffering integration', () => {
  it('budgets desktop, low-memory and mobile devices independently', () => {
    expect(planHlsBuffer()).toMatchObject({
      maxBufferLength: 120,
      maxBufferSize: 192 * MB,
    });
    expect(planHlsBuffer({ deviceMemory: 4 })).toMatchObject({
      maxBufferLength: 90,
      maxBufferSize: 128 * MB,
    });
    expect(planHlsBuffer({ mobile: true })).toMatchObject({
      maxBufferLength: 60,
      maxBufferSize: 72 * MB,
    });
    expect(
      planHlsBuffer({ deviceMemory: 2, cacheEnabled: true })
    ).toMatchObject({ maxBufferLength: 30, maxBufferSize: 72 * MB });
  });

  it('reduces network memory targets when cache or save-data is enabled', () => {
    expect(planHlsBuffer({ cacheEnabled: true }).maxBufferLength).toBeLessThan(
      planHlsBuffer().maxBufferLength
    );
    expect(planHlsBuffer({ saveData: true }).maxBufferLength).toBe(45);
  });

  it('allocates a measured bitrate budget and tightens impossible high-bitrate targets', () => {
    const desktop = planHlsBuffer({ levelBitrate: 8_000_000 });
    expect(desktop.limitedByBytes).toBe(false);
    expect(desktop.maxBufferSize).toBe(Math.ceil(150 * 1_000_000 * 1.15));
    const mobile = planHlsBuffer({ mobile: true, levelBitrate: 80_000_000 });
    expect(mobile.limitedByBytes).toBe(true);
    expect(mobile.maxBufferLength).toBeLessThan(30);
    expect(
      (mobile.maxBufferLength + mobile.backBufferLength) * 10_000_000 * 1.15
    ).toBeLessThanOrEqual(mobile.maxBufferSize);
    expect(mobile.maxMaxBufferLength).toBeGreaterThanOrEqual(
      mobile.maxBufferLength
    );
  });

  it.each([128_000, 2_000_000, 8_000_000, 20_000_000, 80_000_000])(
    'bounds the actual hls.js max-of-size-and-time formula at %s bit/s',
    (levelBitrate) => {
      const plan = planHlsBuffer({ mobile: true, levelBitrate });
      const actualForward = Math.min(
        Math.max((8 * plan.maxBufferSize) / levelBitrate, plan.maxBufferLength),
        plan.maxMaxBufferLength
      );
      const estimatedBytes =
        (((actualForward + plan.backBufferLength) * levelBitrate) / 8) * 1.15;
      expect(estimatedBytes).toBeLessThanOrEqual(72 * MB);
    }
  );

  it.each([undefined, null, NaN, Infinity, -1, 0])(
    'keeps invalid bitrate %s finite',
    (levelBitrate) => {
      const plan = planHlsBuffer({ levelBitrate });
      expect(plan.limitedByBytes).toBe(false);
      for (const value of Object.values(plan)) {
        if (typeof value === 'number')
          expect(Number.isFinite(value)).toBe(true);
      }
    }
  );

  it('never re-expands quota-degraded budgets, including a zero back buffer', () => {
    const config = {
      maxBufferLength: 10,
      maxMaxBufferLength: 20,
      backBufferLength: 0,
      maxBufferSize: 32 * MB,
    };
    const hls = { config: { ...config }, __moontvQuotaDegraded: true };
    applyHlsBufferPlan(hls, planHlsBuffer());
    expect(hls.config).toEqual(config);
    applyHlsBufferPlan(undefined, planHlsBuffer());
  });

  it('reports ordered nonzero cache timing and preserves bits/second bandwidth units', async () => {
    class BaseLoader {
      stats = {};
      load = jest.fn();
      abort = jest.fn();
      destroy = jest.fn();
    }
    (readCachedSegment as jest.Mock).mockResolvedValue({
      fragment: { data: new ArrayBuffer(1024), costMs: 20 },
      matchedKey: 'segment',
    });
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: {},
    });
    const Loader = createCustomHlsLoader({
      DefaultConfig: { loader: BaseLoader },
    });
    const onSuccess = jest.fn();
    new Loader({}).load(
      {
        frag: { sn: 1 },
        responseType: 'arraybuffer',
        url: 'https://example.com/segment.ts',
      },
      {},
      { onSuccess }
    );
    for (let i = 0; i < 6; i++) await Promise.resolve();
    const stats = onSuccess.mock.calls[0][1];
    expect(stats.bwEstimate).toBe(409600);
    expect(stats.loading.first).toBeGreaterThan(stats.loading.start);
    expect(stats.loading.end).toBeGreaterThan(stats.loading.first);
    expect(stats.parsing.start).toBe(stats.loading.end);
    expect(stats.parsing.end).toBeGreaterThan(stats.parsing.start);
    expect(stats.buffering.start).toBe(stats.parsing.end);
    expect(stats.buffering.end).toBe(stats.parsing.end);
  });
});

describe('manual danmaku lifecycle integration', () => {
  const setup = () => ({
    plugin: {
      config: jest.fn(),
      load: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn(),
    },
    getUrl: jest.fn().mockResolvedValue('/api/danmaku/signed.xml'),
    isCurrent: jest.fn().mockReturnValue(true),
    onStart: jest.fn(),
    onLoaded: jest.fn(),
    onError: jest.fn(),
    onFinish: jest.fn(),
  });

  it('reloads a repeated selection, while clearing its loading state each time', async () => {
    const options = setup();
    await loadManualDanmaku(options);
    await loadManualDanmaku(options);
    expect(options.plugin.load).toHaveBeenCalledTimes(2);
    expect(options.onStart).toHaveBeenCalledTimes(2);
    expect(options.onLoaded).toHaveBeenLastCalledWith(
      '/api/danmaku/signed.xml'
    );
    expect(options.onFinish).toHaveBeenCalledTimes(2);
  });

  it('shows loading before URL resolution and ignores an obsolete selection', async () => {
    const options = setup();
    let resolve!: (url: string) => void;
    options.getUrl.mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        })
    );
    const pending = loadManualDanmaku(options);
    expect(options.onStart).toHaveBeenCalledTimes(1);
    options.isCurrent.mockReturnValue(false);
    resolve('/old.xml');
    await pending;
    expect(options.plugin.config).not.toHaveBeenCalled();
    expect(options.onLoaded).not.toHaveBeenCalled();
    expect(options.onFinish).not.toHaveBeenCalled();
  });

  it('does not let a stale XML completion restore visibility or clear a newer loader', async () => {
    const options = setup();
    let finish!: () => void;
    options.plugin.load.mockImplementation(
      () =>
        new Promise<void>((done) => {
          finish = done;
        })
    );
    const pending = loadManualDanmaku(options);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(options.plugin.load).toHaveBeenCalledTimes(1);
    options.isCurrent.mockReturnValue(false);
    finish();
    await pending;
    expect(options.onLoaded).not.toHaveBeenCalled();
    expect(options.onFinish).not.toHaveBeenCalled();
    expect(options.plugin.clear).not.toHaveBeenCalled();
  });

  it('clears failed comments and finishes loading without restoring old content', async () => {
    const options = setup();
    const error = new Error('network failed');
    options.plugin.load.mockRejectedValue(error);
    await loadManualDanmaku(options);
    expect(options.plugin.clear).toHaveBeenCalledTimes(1);
    expect(options.onError).toHaveBeenCalledWith(error);
    expect(options.onLoaded).not.toHaveBeenCalled();
    expect(options.onFinish).toHaveBeenCalledTimes(1);
  });

  it('defaults unknown density to normal while preserving an explicit sparse choice', () => {
    expect(setDanmakuDensity(undefined)).toBe('normal');
    expect(getDanmakuDensity()).toBe('normal');
    expect(setDanmakuDensity('sparse')).toBe('sparse');
  });
});
