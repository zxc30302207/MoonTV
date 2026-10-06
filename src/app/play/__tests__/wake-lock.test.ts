import { act, renderHook } from '@testing-library/react';

import { useWakeLock } from '../hooks/useWakeLock';

beforeEach(() => {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
});

afterEach(() => {
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: undefined,
  });
});

it('releases a wake lock that resolves after playback was paused', async () => {
  const sentinel = {
    released: false,
    release: jest.fn().mockResolvedValue(undefined),
    addEventListener: jest.fn(),
  };
  let resolve!: (value: typeof sentinel) => void;
  const request = jest.fn(
    () =>
      new Promise<typeof sentinel>((r) => {
        resolve = r;
      })
  );
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request },
  });
  const { result } = renderHook(() => useWakeLock());
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.requestWakeLock();
  });
  await act(async () => {
    await result.current.releaseWakeLock();
    resolve(sentinel);
    await pending;
  });
  expect(sentinel.release).toHaveBeenCalledTimes(1);
});

it('deduplicates requests and releases the active lock on unmount', async () => {
  const sentinel = {
    released: false,
    release: jest.fn().mockResolvedValue(undefined),
    addEventListener: jest.fn(),
  };
  const request = jest.fn().mockResolvedValue(sentinel);
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request },
  });
  const { result, unmount } = renderHook(() => useWakeLock());
  await act(async () => {
    await Promise.all([
      result.current.requestWakeLock(),
      result.current.requestWakeLock(),
    ]);
  });
  await act(async () => {
    await result.current.requestWakeLock();
  });
  expect(request).toHaveBeenCalledTimes(1);
  unmount();
  expect(sentinel.release).toHaveBeenCalledTimes(1);
});
