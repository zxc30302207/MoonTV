import {
  DEFAULT_CACHE_SETTINGS,
  metaStore,
  putCachedSegmentResilient,
  SegmentMeta,
} from '../video-cache';

const record = (
  key: string,
  episodeKey: string,
  lastAccess: number
): SegmentMeta => ({
  key,
  episodeKey,
  lastAccess,
  bytes: 100,
  index: 1,
  costMs: 1,
});
const originalResponse = global.Response;
beforeEach(() => {
  Object.defineProperty(global, 'Response', {
    configurable: true,
    writable: true,
    value: jest.fn(),
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  global.Response = originalResponse;
});
function setup(records: SegmentMeta[], alwaysFull = false) {
  jest.spyOn(metaStore, 'all').mockResolvedValue(records);
  const removeMeta = jest.spyOn(metaStore, 'del').mockResolvedValue(undefined);
  const remove = jest.fn().mockResolvedValue(true);
  const put = jest
    .fn()
    .mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
  if (alwaysFull)
    put.mockRejectedValue(new DOMException('Full', 'QuotaExceededError'));
  else put.mockResolvedValue(undefined);
  Object.defineProperty(global, 'caches', {
    configurable: true,
    value: { open: jest.fn().mockResolvedValue({ put, delete: remove }) },
  });
  return { put, remove, removeMeta };
}

it('frees old non-playing data even below configured limits, then retries once', async () => {
  const { put, remove } = setup([
    record('playing', 'current', 0),
    record('old', 'other', 1),
    record('newer', 'other', 2),
  ]);
  expect(
    await putCachedSegmentResilient(
      'incoming',
      new ArrayBuffer(50),
      null,
      DEFAULT_CACHE_SETTINGS,
      undefined,
      'current'
    )
  ).toBe('ok');
  expect(put).toHaveBeenCalledTimes(2);
  expect(remove.mock.calls).toEqual([['old']]);
});

it('does not evict active playback when no other candidates exist', async () => {
  const { put, remove } = setup([record('playing', 'current', 0)]);
  expect(
    await putCachedSegmentResilient(
      'incoming',
      new ArrayBuffer(50),
      null,
      DEFAULT_CACHE_SETTINGS,
      undefined,
      'current'
    )
  ).toBe('quota');
  expect(put).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
});

it('returns quota rather than looping if eviction still cannot fit the segment', async () => {
  const { put } = setup([record('old', 'other', 0)], true);
  expect(
    await putCachedSegmentResilient(
      'incoming',
      new ArrayBuffer(500),
      null,
      DEFAULT_CACHE_SETTINGS
    )
  ).toBe('quota');
  expect(put).toHaveBeenCalledTimes(2);
});

it('does not evict or retry after cancellation while reading eviction metadata', async () => {
  const { put, remove } = setup([record('old', 'other', 0)]);
  const controller = new AbortController();
  jest.spyOn(metaStore, 'all').mockImplementation(async () => {
    controller.abort();
    return [record('old', 'other', 0)];
  });
  expect(
    await putCachedSegmentResilient(
      'incoming',
      new ArrayBuffer(50),
      null,
      DEFAULT_CACHE_SETTINGS,
      controller.signal
    )
  ).toBe('failed');
  expect(put).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
});
