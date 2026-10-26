import { act, renderHook, waitFor } from '@testing-library/react';

import { deleteSkipConfig, getAllPlayRecords } from '@/lib/db.client';

import { usePlayEngine } from '../usePlayEngine';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('source=a&id=1&title=Show'),
}));
jest.mock('@/lib/db.client', () => ({
  getAllPlayRecords: jest.fn(async () => ({})),
  getSkipConfig: jest.fn(async () => null),
  deleteSkipConfig: jest.fn(async () => undefined),
  saveSkipConfig: jest.fn(async () => undefined),
  generateStorageKey: (source: string, id: string) => `${source}+${id}`,
  savePlayRecord: jest.fn(async () => undefined),
}));
jest.mock('../hooks/useVideoActions', () => ({ useVideoActions: () => ({}) }));
jest.mock('../preview-thumbnailer', () => ({
  PreviewThumbnailer: jest.fn(() => ({
    destroy: jest.fn(),
    cancel: jest.fn(),
    capture: jest.fn(),
    load: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('artplayer', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('artplayer-plugin-danmuku', () => ({
  __esModule: true,
  default: jest.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const sources = ['a', 'b', 'c'].map((source) => ({
  source,
  id: '1',
  title: 'Show',
  year: '2024',
  source_name: source,
  poster: '',
  episodes: [
    'https://cdn.test/1.m3u8',
    'https://cdn.test/2.m3u8',
    'https://cdn.test/3.m3u8',
  ],
  episodes_titles: ['1', '2', '3'],
}));
const originalFetch = global.fetch;
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/play?source=a&id=1&title=Show');
  (getAllPlayRecords as jest.Mock).mockReset().mockResolvedValue({});
  (deleteSkipConfig as jest.Mock).mockReset().mockResolvedValue(undefined);
  global.fetch = jest.fn(
    async () =>
      ({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ pageResults: sources }) + '\n'
              )
            );
            controller.close();
          },
        }),
      } as Response)
  );
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

it('actual hook keeps the latest episode when history reads finish in reverse order', async () => {
  const { result } = renderHook(() => usePlayEngine());
  await waitFor(() => expect(result.current.totalEpisodes).toBe(3));
  const first = deferred<Record<string, never>>();
  const second = deferred<Record<string, never>>();
  (getAllPlayRecords as jest.Mock)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  let firstSelection!: Promise<void>;
  let secondSelection!: Promise<void>;
  act(() => {
    firstSelection = result.current.handleEpisodeChange(1);
    secondSelection = result.current.handleEpisodeChange(2);
  });
  await act(async () => {
    second.resolve({});
    await secondSelection;
  });
  expect(result.current.currentEpisodeIndex).toBe(2);
  expect(result.current.loading).toBe(false);
  await act(async () => {
    first.resolve({});
    await firstSelection;
  });
  expect(result.current.currentEpisodeIndex).toBe(2);
});

it('actual hook keeps the latest source despite delayed skip-config persistence', async () => {
  const { result } = renderHook(() => usePlayEngine());
  await waitFor(() => expect(result.current.availableSources).toHaveLength(3));
  const first = deferred<void>();
  const second = deferred<void>();
  (deleteSkipConfig as jest.Mock)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  let a!: Promise<void>;
  let b!: Promise<void>;
  act(() => {
    a = result.current.handleSourceChange('b', '1', 'Show');
    b = result.current.handleSourceChange('c', '1', 'Show');
  });
  await act(async () => {
    second.resolve();
    await b;
  });
  await act(async () => {
    first.resolve();
    await a;
  });
  expect(result.current.currentSource).toBe('c');
  expect(new URL(window.location.href).searchParams.get('source')).toBe('c');
});

it('unmount aborts initialization and prevents late URL changes', async () => {
  const pending = deferred<Response>();
  global.fetch = jest.fn(() => pending.promise);
  const { unmount } = renderHook(() => usePlayEngine());
  const signal = (global.fetch as jest.Mock).mock.calls[0][1]
    .signal as AbortSignal;
  unmount();
  expect(signal.aborted).toBe(true);
  window.history.replaceState({}, '', '/search?q=other');
  await act(async () => {
    pending.resolve({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    } as Response);
    await pending.promise;
  });
  expect(window.location.pathname).toBe('/search');
  expect(window.location.search).toBe('?q=other');
});
