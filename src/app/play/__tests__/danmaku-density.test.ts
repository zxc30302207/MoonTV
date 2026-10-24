import {
  computeDanmuTop,
  MAX_LOADED_DANMAKU,
  sampleDanmakuTimeline,
  wrapArtplayerPluginDanmuku,
} from '../danmuku-live-font-size';
import {
  createDanmakuDensityThrottle,
  createDanmakuFilter,
  createDanmakuInitialConfig,
  getDanmakuDensity,
  pickDanmakuSettings,
  saveDanmakuSettings,
  setDanmakuDensity,
} from '../play-utils';

beforeEach(() => {
  localStorage.clear();
  setDanmakuDensity('sparse');
});

it('persists validated density without leaking it into plugin configuration', () => {
  expect(pickDanmakuSettings({ density: 'arbitrary' }).density).toBeUndefined();
  saveDanmakuSettings({ density: 'dense', fontSize: 30 });
  const config = createDanmakuInitialConfig();
  expect(getDanmakuDensity()).toBe('dense');
  expect(config.density).toBeUndefined();
  expect(config.fontSize).toBe(30);
});

it('limits bursts, refills on time slots, and applies density changes immediately', () => {
  let now = 0;
  const allow = createDanmakuDensityThrottle(() => now);
  expect([allow(10), allow(10), allow(10)]).toEqual([true, true, false]);
  now = 1;
  expect(allow(10)).toBe(true);
  setDanmakuDensity('dense');
  expect([allow(10), allow(10), allow(10), allow(10)]).toEqual([
    true,
    true,
    true,
    false,
  ]);
});

it('keeps later-episode comments rather than permanently truncating at 8000', () => {
  const filter = createDanmakuFilter();
  for (let i = 0; i < 8100; i++)
    expect(filter({ text: 'comment', time: i })).toBe(true);
  expect(filter({ text: 'a'.repeat(101) })).toBe(false);
});

it('prefers empty lanes over sharing an already occupied scroll lane', () => {
  const top = computeDanmuTop({
    target: { height: 20, mode: 0, speed: 10 },
    visibles: [
      {
        top: 0,
        height: 20,
        mode: 0,
        speed: 20,
        distance: 100,
        right: 50,
        time: 1,
      },
    ],
    clientWidth: 500,
    clientHeight: 40,
    marginTop: 0,
    marginBottom: 0,
  });
  expect(top).toBe(20);
});

it('bounds oversized loads while retaining early and late timeline comments', () => {
  const items = Array.from({ length: 16001 }, (_, time) => ({
    time,
    text: `${time}`,
  }));
  const sampled = sampleDanmakuTimeline(items);
  expect(sampled).toHaveLength(MAX_LOADED_DANMAKU);
  expect(new Set(sampled).size).toBe(MAX_LOADED_DANMAKU);
  expect(sampled[0]).toBe(items[0]);
  expect(sampled[sampled.length - 1]).toBe(items[items.length - 1]);
  expect(sampled.some((item) => item.time > 7999 && item.time < 12000)).toBe(
    true
  );
  expect(sampleDanmakuTimeline([...items].reverse())).toEqual(sampled);
  expect(items[0].time).toBe(0);
});

it('leaves normal loads exactly unchanged and respects remaining append capacity', () => {
  const items = Array.from({ length: MAX_LOADED_DANMAKU }, (_, time) => ({
    time,
  }));
  expect(sampleDanmakuTimeline(items)).toBe(items);
  expect(sampleDanmakuTimeline([])).toEqual([]);
  expect(sampleDanmakuTimeline(items, 2)).toEqual([items[0], items[7999]]);
  expect(sampleDanmakuTimeline(items, 0)).toEqual([]);
  expect(sampleDanmakuTimeline(items, -1)).toEqual([]);
});

type TestDanmaku = { text: string; time: number; $ref?: HTMLElement | null };

// Mirrors the plugin 5.2.0 facade/bind capture and synchronous emit mutation.
function createWrappedPlugin() {
  const art = { emit: jest.fn(), on: jest.fn() };
  const instance = {
    queue: [] as TestDanmaku[],
    states: { wait: [] as TestDanmaku[], ready: [], emit: [], stop: [] },
    $refs: [],
    $danmuku: document.createElement('div'),
    art,
    option: {
      danmuku: '/old.xml',
      beforeVisible: (item: TestDanmaku) => Boolean(item),
    },
    config(option: Record<string, unknown>) {
      Object.assign(this.option, option);
      return this;
    },
    makeWait: jest.fn(),
    filter: jest.fn(),
    postMessage: jest.fn(),
    load: jest.fn(),
    reset() {
      this.states.wait = [...this.queue];
    },
    async emit(item: TestDanmaku) {
      this.queue.push(item);
      this.states.wait.push(item);
    },
  };
  const factory = () => () => {
    // Actual plugin binds these public methods after constructor setup.
    const reset = instance.reset.bind(instance);
    return {
      reset,
      load: instance.load.bind(instance),
      config: instance.config.bind(instance),
    };
  };
  const plugin = wrapArtplayerPluginDanmuku(factory)({})(art);
  return { plugin, instance, art };
}

it('clears old episode queue and in-flight DOM references instead of merely resetting', async () => {
  const { plugin, instance } = createWrappedPlugin();
  const old = {
    text: 'old episode',
    time: 2,
    $ref: document.createElement('span'),
  };
  await plugin.load([old]);
  instance.$danmuku.textContent = 'old episode';
  plugin.reset();
  expect(instance.queue).toHaveLength(1);
  plugin.clear();
  expect(instance.queue).toEqual([]);
  expect(instance.states).toEqual({ wait: [], ready: [], emit: [], stop: [] });
  expect(instance.$danmuku.textContent).toBe('');
  expect(old.$ref).toBeNull();
  // A previous frame can still hold a readys snapshot while its worker resolves.
  expect(instance.option.beforeVisible(old)).toBe(false);
  await plugin.load([{ text: 'new selection', time: 3 }]);
  expect(instance.queue.map((item) => item.text)).toEqual(['new selection']);
});

it('does not repopulate after an old XML request resolves following episode clear', async () => {
  const oldFetch = global.fetch;
  let resolveFetch: (value: Response) => void = () => undefined;
  global.fetch = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })
  );
  try {
    const { plugin, instance, art } = createWrappedPlugin();
    const pending = plugin.load();
    plugin.clear();
    resolveFetch({
      ok: true,
      text: async () => '<d p="2,1,25,16777215,0,0,u,1">old</d>',
    } as Response);
    await pending;
    expect(instance.queue).toEqual([]);
    expect(art.emit).not.toHaveBeenCalledWith(
      'artplayerPluginDanmuku:loaded',
      expect.anything()
    );
    await plugin.load([{ text: 'selected', time: 3 }]);
    expect(instance.queue).toHaveLength(1);
  } finally {
    global.fetch = oldFetch;
  }
});

it('stops an in-progress array load on clear and bounds a fresh oversized queue', async () => {
  const { plugin, instance } = createWrappedPlugin();
  const items = Array.from({ length: 16001 }, (_, time) => ({
    time,
    text: `${time}`,
  }));
  const pending = plugin.load(items);
  plugin.clear();
  await pending;
  expect(instance.queue).toEqual([]);
  await plugin.load(items);
  expect(instance.queue).toHaveLength(MAX_LOADED_DANMAKU);
  expect(instance.queue[0].time).toBe(0);
  expect(instance.queue[7999].time).toBe(16000);
});
