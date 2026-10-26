import { PlaybackSelection } from './playback-selection';

describe('playback selection lifecycle', () => {
  afterEach(() => jest.useRealTimers());
  it('allows only the last selection to commit out-of-order history/source work', async () => {
    const scope = new PlaybackSelection();
    let releaseFirst!: () => void;
    let selected = 0;
    const select = async (value: number, work: Promise<void>) => {
      const revision = scope.begin();
      await work;
      if (scope.isCurrent(revision)) selected = value;
    };
    const first = select(
      2,
      new Promise<void>((resolve) => {
        releaseFirst = resolve;
      })
    );
    await select(3, Promise.resolve());
    releaseFirst();
    await first;
    expect(selected).toBe(3);
  });
  it('cancels ended callbacks after manual switching and on unmount', () => {
    jest.useFakeTimers();
    const scope = new PlaybackSelection();
    const advance = jest.fn();
    scope.schedule(scope.capture(), advance, 1000);
    scope.begin();
    jest.advanceTimersByTime(1000);
    expect(advance).not.toHaveBeenCalled();
    scope.schedule(scope.capture(), advance, 1000);
    scope.dispose();
    jest.runAllTimers();
    expect(advance).not.toHaveBeenCalled();
    expect(scope.isCurrent(scope.capture())).toBe(false);
  });
  it('does not revive stale initialization work on a new mount lifecycle', () => {
    const scope = new PlaybackSelection();
    const old = scope.capture();
    scope.dispose();
    scope.activate();
    expect(scope.isCurrent(old)).toBe(false);
    expect(scope.isCurrent(scope.capture())).toBe(true);
  });
});
