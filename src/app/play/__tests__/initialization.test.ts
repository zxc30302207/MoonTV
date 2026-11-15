import { act, renderHook } from '@testing-library/react';

import { getAllPlayRecords } from '@/lib/db.client';
import { getVideoResolutionFromM3u8 } from '@/lib/utils';

import { usePlayEngine } from '../usePlayEngine';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
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

jest.mock('@/lib/utils', () => ({
  ...jest.requireActual('@/lib/utils'),
  getVideoResolutionFromM3u8: jest.fn(async () => ({
    quality: '1080p',
    loadSpeed: '1 MB/s',
    pingTime: 10,
    hasError: false,
  })),
}));

const selected = {
  source: 'ruyi',
  id: '83488',
  title: '掌门低调点动漫',
  year: '2026',
  source_name: '如意',
  poster: '',
  episodes: ['https://cdn.test/1.m3u8', 'https://cdn.test/2.m3u8'],
  episodes_titles: ['1', '2'],
};
const alternative = { ...selected, source: 'other', id: '2' };
function streamResponse(results = [selected], close = true, newline = true) {
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        if (results.length)
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ pageResults: results }) + (newline ? '\n' : '')
            )
          );
        if (close) controller.close();
      },
    }),
  } as Response;
}
const detailResponse = (result = selected) =>
  ({ ok: true, json: async () => result } as Response);
const originalFetch = global.fetch;
async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('requestTimeout', '1');
  window.history.replaceState(
    {},
    '',
    '/play?source=ruyi&id=83488&title=掌门低调点动漫&year=2026&stype=tv&prefer=true'
  );
  (getAllPlayRecords as jest.Mock).mockReset().mockResolvedValue({});
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  global.fetch = originalFetch;
});
it('loads the explicit ID without waiting for a stalled whole-site search', async () => {
  localStorage.setItem('moontv_pending_writes_v1_owner', 'retained');
  global.fetch = jest.fn(async (url) =>
    String(url).startsWith('/api/detail')
      ? detailResponse()
      : streamResponse([], false)
  );
  const { result } = renderHook(() => usePlayEngine());
  await flush();
  expect(result.current.totalEpisodes).toBe(2);
  expect(result.current.sourceSearchLoading).toBe(false);
  act(() => jest.advanceTimersByTime(500));
  expect(result.current.loading).toBe(false);
  expect(result.current.currentSource).toBe('ruyi');
  expect(localStorage.getItem('moontv_pending_writes_v1_owner')).toBe(
    'retained'
  );
  act(() => jest.advanceTimersByTime(500));
  await flush();
  expect(result.current.loading).toBe(false);
  expect(result.current.sourceSearchLoading).toBe(false);
  expect(result.current.sourceSearchError).toBe('');
});
it('keeps the direct result in the selector as background alternatives arrive', async () => {
  global.fetch = jest.fn(async (url) =>
    String(url).startsWith('/api/detail')
      ? detailResponse()
      : streamResponse([alternative])
  );
  const { result } = renderHook(() => usePlayEngine());
  await flush();
  expect(
    result.current.availableSources.map((item) => item.source).sort()
  ).toEqual(['other', 'ruyi']);
  expect(result.current.currentSource).toBe('ruyi');
});
it('accepts the exact ID despite changed year or only one TV episode', async () => {
  const changed = {
    ...selected,
    year: '2025',
    episodes: [selected.episodes[0]],
  };
  global.fetch = jest.fn(async (url) =>
    String(url).startsWith('/api/detail')
      ? detailResponse(changed)
      : streamResponse([], false)
  );
  const { result } = renderHook(() => usePlayEngine());
  await flush();
  expect(result.current.totalEpisodes).toBe(1);
  expect(new URL(window.location.href).searchParams.get('year')).toBe('2025');
});
it('falls back to search when direct detail contains no playable URLs', async () => {
  global.fetch = jest.fn(async (url) =>
    String(url).startsWith('/api/detail')
      ? detailResponse({ ...selected, episodes: [] })
      : streamResponse([alternative])
  );
  const { result } = renderHook(() => usePlayEngine());
  await flush();
  expect(result.current.currentSource).toBe('other');
  expect(result.current.totalEpisodes).toBe(2);
});
it('ends initialization even if both fetch and body readers ignore cancellation', async () => {
  global.fetch = jest.fn((url) =>
    String(url).startsWith('/api/detail')
      ? new Promise<Response>(() => undefined)
      : Promise.resolve(streamResponse([], false))
  );
  const { result } = renderHook(() => usePlayEngine());
  await flush();
  act(() => jest.advanceTimersByTime(1000));
  await flush();
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toContain('未找到可播放');
  for (const [, options] of (global.fetch as jest.Mock).mock.calls)
    expect(options.signal.aborted).toBe(true);
});
it('processes a final search result without a trailing newline', async () => {
  global.fetch = jest.fn(async (url) =>
    String(url).startsWith('/api/detail')
      ? ({ ok: false } as Response)
      : streamResponse([selected], true, false)
  );
  const { result } = renderHook(() => usePlayEngine());
  await flush();
  expect(result.current.totalEpisodes).toBe(2);
});
it('preserves source preference rather than immediately starting the direct result', async () => {
  localStorage.setItem('enablePreferBestSource', 'true');
  global.fetch = jest.fn(async (url) =>
    String(url).startsWith('/api/detail')
      ? detailResponse()
      : streamResponse([alternative], false)
  );
  const { result } = renderHook(() => usePlayEngine());
  await flush();
  expect(result.current.totalEpisodes).toBe(0);
  act(() => jest.advanceTimersByTime(1000));
  await flush();
  expect(getVideoResolutionFromM3u8).toHaveBeenCalled();
  expect(result.current.totalEpisodes).toBe(2);
});
it('starts title-only playback on the first match when preference is disabled', async () => {
  window.history.replaceState(
    {},
    '',
    '/play?title=掌门低调点动漫&year=2026&stype=tv'
  );
  global.fetch = jest.fn(async () => streamResponse([selected], false));
  const { result } = renderHook(() => usePlayEngine());
  await flush();
  expect(result.current.totalEpisodes).toBe(2);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
it('preserves the requested episode when using direct detail', async () => {
  window.history.replaceState({}, '', window.location.href + '&ep=2');
  global.fetch = jest.fn(async (url) =>
    String(url).startsWith('/api/detail')
      ? detailResponse()
      : streamResponse([], false)
  );
  const { result } = renderHook(() => usePlayEngine());
  await flush();
  expect(result.current.currentEpisodeIndex).toBe(1);
});
it('does not change the URL when detail completes after unmount', async () => {
  let resolve!: (response: Response) => void;
  global.fetch = jest.fn((url) =>
    String(url).startsWith('/api/detail')
      ? new Promise<Response>((done) => {
          resolve = done;
        })
      : Promise.resolve(streamResponse([], false))
  );
  const { unmount } = renderHook(() => usePlayEngine());
  await flush();
  unmount();
  window.history.replaceState({}, '', '/search?q=newer');
  resolve(detailResponse());
  await flush();
  expect(window.location.pathname + window.location.search).toBe(
    '/search?q=newer'
  );
});
