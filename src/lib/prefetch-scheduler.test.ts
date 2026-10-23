import { PrefetchLimiter, shouldThrottlePrefetch } from './prefetch-scheduler';

it('cancels queued slots and releases active slots idempotently', async () => {
  const limiter = new PrefetchLimiter(() => 1);
  const first = await limiter.acquire(new AbortController().signal);
  const controller = new AbortController();
  const pending = limiter.acquire(controller.signal);
  controller.abort();
  await expect(pending).rejects.toHaveProperty('name', 'AbortError');
  first();
  first();
  const release = await limiter.acquire(new AbortController().signal);
  release();
});

it('yields bandwidth while playing with low buffer but not while paused', () => {
  const video = {
    paused: false,
    seeking: false,
    currentTime: 10,
    duration: 100,
    playbackRate: 1,
    buffered: { length: 1, start: () => 0, end: () => 12 },
  };
  expect(shouldThrottlePrefetch(video, false)).toBe(true);
  expect(shouldThrottlePrefetch({ ...video, paused: true }, true)).toBe(false);
  expect(shouldThrottlePrefetch({ ...video, seeking: true }, false)).toBe(true);
});

it('wakes queued work when the user raises the shared limit', async () => {
  let limit = 1;
  const limiter = new PrefetchLimiter(() => limit);
  const releaseFirst = await limiter.acquire(new AbortController().signal);
  let acquired = false;
  const pending = limiter
    .acquire(new AbortController().signal)
    .then((release) => {
      acquired = true;
      return release;
    });
  await Promise.resolve();
  expect(acquired).toBe(false);
  limit = 2;
  limiter.notifyLimitChanged();
  const releaseSecond = await pending;
  expect(acquired).toBe(true);
  releaseSecond();
  releaseFirst();
});
