/** Abortable slots shared by current-episode prefetch and next-episode warmup. */
export class PrefetchLimiter {
  private active = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly limit: () => number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (this.active < this.limit()) {
        this.active += 1;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          this.active -= 1;
          this.wake();
        };
      }
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          signal.removeEventListener('abort', onAbort);
          this.waiters = this.waiters.filter((waiter) => waiter !== onReady);
        };
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onAbort = () => {
          cleanup();
          reject(new DOMException('Aborted', 'AbortError'));
        };
        this.waiters.push(onReady);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    }
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((resolve) => resolve());
  }
}

export function getPrefetchLimit(segmentBytes: number): number {
  const nav =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & {
          deviceMemory?: number;
          connection?: { effectiveType?: string };
        });
  const constrained =
    (nav?.deviceMemory !== undefined && nav.deviceMemory <= 4) ||
    (nav?.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 4) ||
    nav?.connection?.effectiveType === '3g';
  const budget = (constrained ? 16 : 32) * 1024 * 1024;
  // This is an estimated working-set budget, not a hard cap for a single segment.
  return Math.max(
    1,
    Math.min(
      constrained ? 3 : 6,
      Math.floor(budget / Math.max(1, segmentBytes))
    )
  );
}

let estimatedSegmentBytes = 4 * 1024 * 1024;
export function observePrefetchSegment(bytes: number): void {
  estimatedSegmentBytes = Math.max(
    4 * 1024 * 1024,
    bytes,
    estimatedSegmentBytes * 0.9
  );
}

export const prefetchDownloadLimiter = new PrefetchLimiter(() =>
  getPrefetchLimit(estimatedSegmentBytes)
);
export const prefetchWriteLimiter = new PrefetchLimiter(() => 1);

/** Hysteresis avoids repeatedly stopping/restarting requests near the threshold. */
export function shouldThrottlePrefetch(
  video: Pick<
    HTMLVideoElement,
    | 'paused'
    | 'seeking'
    | 'currentTime'
    | 'duration'
    | 'playbackRate'
    | 'buffered'
  >,
  wasThrottled: boolean
): boolean {
  if (video.seeking) return true;
  if (video.paused) return false;
  let ahead = 0;
  for (let i = 0; i < video.buffered.length; i += 1) {
    if (
      video.buffered.start(i) <= video.currentTime &&
      video.buffered.end(i) > video.currentTime
    ) {
      ahead = video.buffered.end(i) - video.currentTime;
      break;
    }
  }
  if (
    Number.isFinite(video.duration) &&
    video.duration > 0 &&
    ahead > 0 &&
    video.currentTime + ahead >= video.duration - 0.25
  ) {
    return false;
  }
  const playbackSeconds = ahead / Math.max(0.1, video.playbackRate);
  return playbackSeconds < (wasThrottled ? 15 : 5);
}
