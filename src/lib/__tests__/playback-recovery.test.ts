import { PlaybackRecovery } from '../playback-recovery';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('bounds retries and then asks for source switching', () => {
  const recovery = new PlaybackRecovery();
  expect(recovery.onFatal('networkError', 'fragLoadError')).toMatchObject({
    action: 'retry',
    attempt: 1,
    delayMs: 800,
  });
  recovery.markHealthy();
  expect(recovery.onFatal('networkError', 'fragLoadError')).toMatchObject({
    action: 'retry',
    attempt: 2,
  });
  expect(recovery.onFatal('networkError', 'fragLoadError')).toMatchObject({
    action: 'retry',
    attempt: 3,
  });
  expect(recovery.onFatal('networkError', 'fragLoadError').action).toBe(
    'switch-source'
  );
});

it('cancels delayed callbacks when the player is disposed', () => {
  const recovery = new PlaybackRecovery();
  const retry = jest.fn();
  recovery.schedule(800, retry);
  recovery.dispose();
  jest.runAllTimers();
  expect(retry).not.toHaveBeenCalled();
  expect(recovery.onFatal('networkError', 'fragLoadError').action).toBe(
    'ignore'
  );
});

it('resets attempts after a genuinely healthy playback interval', () => {
  const recovery = new PlaybackRecovery();
  recovery.onFatal('networkError', 'fragLoadError');
  jest.advanceTimersByTime(3001);
  recovery.markHealthy();
  expect(recovery.onFatal('networkError', 'fragLoadError')).toMatchObject({
    action: 'retry',
    attempt: 1,
  });
});
