import { getVideoResolutionFromM3u8 } from '../utils';

const mockHandlers: Record<string, (event?: unknown, data?: unknown) => void> =
  {};
const mockDestroy = jest.fn();
jest.mock('hls.js', () => ({
  __esModule: true,
  default: Object.assign(
    jest.fn().mockImplementation(() => ({
      on: (event: string, handler: (typeof mockHandlers)[string]) => {
        mockHandlers[event] = handler;
      },
      loadSource: jest.fn(),
      attachMedia: jest.fn(),
      destroy: mockDestroy,
    })),
    {
      Events: {
        FRAG_LOADING: 'loading',
        FRAG_LOADED: 'loaded',
        ERROR: 'error',
      },
    }
  ),
}));
const originalFetch = global.fetch;
let video: HTMLVideoElement;
let remove: jest.Mock;
let pingSignal: AbortSignal;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  remove = jest.fn();
  video = { videoWidth: 0, remove } as unknown as HTMLVideoElement;
  jest.spyOn(document, 'createElement').mockReturnValue(video);
  global.fetch = jest.fn((_url, init) => {
    pingSignal = init?.signal as AbortSignal;
    return new Promise(() => undefined);
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  global.fetch = originalFetch;
});
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

it('cleans Hls, video and pending HEAD even when metadata width is zero', async () => {
  const result = getVideoResolutionFromM3u8('https://cdn.test/video.m3u8');
  await flush();
  jest.advanceTimersByTime(100);
  mockHandlers.loading();
  jest.advanceTimersByTime(100);
  video.onloadedmetadata?.call(video, new Event('loadedmetadata'));
  mockHandlers.loaded(undefined, { payload: new Uint8Array(1024) });
  expect(await result).toMatchObject({ quality: '未知' });
  expect(mockDestroy).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(pingSignal.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});

it.each(['timeout', 'fatal', 'video'])(
  'cleans all resources after %s failure',
  async (reason) => {
    const result = getVideoResolutionFromM3u8('https://cdn.test/video.m3u8');
    const assertion = expect(result).rejects.toThrow();
    await flush();
    if (reason === 'timeout') jest.advanceTimersByTime(4000);
    else if (reason === 'fatal')
      mockHandlers.error(undefined, { fatal: true, type: 'network' });
    else video.onerror?.call(video, new Event('error'));
    await assertion;
    expect(mockDestroy).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(pingSignal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  }
);
