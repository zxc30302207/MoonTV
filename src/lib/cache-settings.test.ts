import { DEFAULT_CACHE_SETTINGS, normalizeCacheSettings } from './video-cache';

it.each([
  ['low', 2],
  ['medium', 4],
  ['high', 8],
])(
  'derives %s concurrency from presets rather than injected values',
  (mode, expected) => {
    expect(
      normalizeCacheSettings({ concurrencyMode: mode, concurrency: 999 })
        .concurrency
    ).toBe(expected);
  }
);
it.each([
  [1, 2],
  [3, 2],
  [5, 4],
  [7, 8],
  [32, 8],
])('migrates legacy custom concurrency %s to %s', (legacy, expected) => {
  expect(
    normalizeCacheSettings({
      concurrencyMode: 'custom',
      customConcurrency: legacy,
    }).concurrency
  ).toBe(expected);
  expect(normalizeCacheSettings({ concurrency: legacy }).concurrency).toBe(
    expected
  );
});
it('preserves existing opt-ins and limits and does not enable caching during upgrade', () => {
  expect(normalizeCacheSettings({}).enabled).toBe(false);
  const settings = normalizeCacheSettings({
    enabled: true,
    autoClearOnEpisodeChange: true,
    useProxy: false,
    maxTotalBytes: 1e9,
  });
  expect(settings).toMatchObject({
    enabled: true,
    autoClearOnEpisodeChange: true,
    useProxy: false,
    maxTotalBytes: 1e9,
  });
  expect(
    normalizeCacheSettings({ concurrencyMode: 'bad', customConcurrency: 32 })
      .concurrency
  ).toBe(DEFAULT_CACHE_SETTINGS.concurrency);
});
