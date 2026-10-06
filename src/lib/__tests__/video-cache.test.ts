import {
  clearVideoCache,
  DEFAULT_CACHE_SETTINGS,
  putCachedSegmentResilient,
  readCachedSegment,
} from '../video-cache';

beforeEach(() => jest.clearAllMocks());

it('does not write after logout clears a pending cache open', async () => {
  let finishOpen!: (cache: Cache) => void;
  const put = jest.fn();
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      open: jest.fn(
        () =>
          new Promise<Cache>((resolve) => {
            finishOpen = resolve;
          })
      ),
      delete: jest.fn().mockResolvedValue(true),
    },
  });
  const writing = putCachedSegmentResilient(
    '/api/m3u8?url=test',
    new ArrayBuffer(1)
  );
  await clearVideoCache();
  finishOpen({ put } as unknown as Cache);
  expect(await writing).toBe('failed');
  expect(put).not.toHaveBeenCalled();
});

it('does not open a cache for an already-cancelled prefetch', async () => {
  const open = jest.fn();
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: { open },
  });
  const controller = new AbortController();
  controller.abort();
  expect(
    await putCachedSegmentResilient(
      '/api/m3u8?url=test',
      new ArrayBuffer(1),
      undefined,
      DEFAULT_CACHE_SETTINGS,
      controller.signal
    )
  ).toBe('failed');
  expect(open).not.toHaveBeenCalled();
});

it('does not deliver cached bytes that finished reading after logout', async () => {
  let finishRead!: (data: ArrayBuffer) => void;
  const response = {
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((resolve) => {
        finishRead = resolve;
      }),
  };
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      open: jest
        .fn()
        .mockResolvedValue({ match: jest.fn().mockResolvedValue(response) }),
      delete: jest.fn().mockResolvedValue(true),
    },
  });
  const reading = readCachedSegment('/api/m3u8?url=test');
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(finishRead).toBeDefined();
  await clearVideoCache();
  finishRead(new ArrayBuffer(1));
  expect(await reading).toBeNull();
});
