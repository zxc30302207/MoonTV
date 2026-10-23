import { PreviewThumbnailer } from '../preview-thumbnailer';

class FakeHls {
  static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
  static instances: FakeHls[] = [];
  config = {};
  listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  loadSource = jest.fn();
  stopLoad = jest.fn();
  startLoad = jest.fn();
  attachMedia = jest.fn();
  destroy = jest.fn();
  constructor() {
    FakeHls.instances.push(this);
  }
  on(event: string, callback: (...args: unknown[]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(callback);
  }
  off(event: string, callback: (...args: unknown[]) => void) {
    this.listeners.get(event)?.delete(callback);
  }
}

beforeEach(() => {
  jest.useFakeTimers();
  FakeHls.instances = [];
  jest
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => undefined);
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: jest.fn(),
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('loads preview manifests lazily and settles cancelled captures without leaking videos', async () => {
  const thumb = new PreviewThumbnailer();
  thumb.load('/api/m3u8/filter?url=movie', FakeHls, class {});
  const hls = FakeHls.instances[0];
  expect(hls.loadSource).not.toHaveBeenCalled();
  const pending = thumb.capture(20);
  expect(hls.loadSource).toHaveBeenCalledWith('/api/m3u8/filter?url=movie');
  thumb.cancel();
  await expect(pending).resolves.toBeNull();
  expect(hls.stopLoad).toHaveBeenCalled();
  thumb.destroy();
  expect(document.querySelector('video')).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});

it('cancels superseded captures and bounds a stalled manifest by timeout', async () => {
  const thumb = new PreviewThumbnailer();
  thumb.load('movie.m3u8', FakeHls, class {});
  const first = thumb.capture(10);
  const second = thumb.capture(30);
  await expect(first).resolves.toBeNull();
  jest.advanceTimersByTime(10000);
  await expect(second).resolves.toBeNull();
  thumb.destroy();
  expect(jest.getTimerCount()).toBe(0);
});

it('switching sources destroys the old decoder and resolves its pending capture', async () => {
  const thumb = new PreviewThumbnailer();
  thumb.load('first.m3u8', FakeHls, class {});
  const firstHls = FakeHls.instances[0];
  const pending = thumb.capture(20);
  thumb.load('second.m3u8', FakeHls, class {});
  await expect(pending).resolves.toBeNull();
  expect(firstHls.destroy).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll('video')).toHaveLength(1);
  thumb.destroy();
});
