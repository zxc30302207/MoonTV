import type { AnimeOption } from './danmaku.client';
import {
  readDanmakuEpisodeMapping,
  saveDanmakuEpisodeMapping,
} from './danmaku-episode-mapping';

const anime: AnimeOption = {
  animeId: 1,
  animeTitle: 'Show',
  type: 'TV',
  typeDescription: '',
  episodeCount: 3,
  episodes: [
    { episodeId: 10, episodeTitle: '1' },
    { episodeId: 11, episodeTitle: '2' },
    { episodeId: 12, episodeTitle: '3' },
  ],
};
const video = { source: 'a', id: 'show', index: 0, title: 'Special' };
afterEach(() => localStorage.clear());
it('restores the explicit episode ID, not a guessed numeric offset', () => {
  saveDanmakuEpisodeMapping(video, anime, 3);
  expect(readDanmakuEpisodeMapping(video, anime)?.episodeId).toBe(12);
  expect(readDanmakuEpisodeMapping({ ...video, index: 1 }, anime)).toBeNull();
  expect(
    readDanmakuEpisodeMapping({ ...video, source: 'b' }, anime)
  ).toBeNull();
  expect(
    readDanmakuEpisodeMapping({ ...video, title: 'New first episode' }, anime)
  ).toBeNull();
});
it('rejects stale anime identity and missing episodes', () => {
  saveDanmakuEpisodeMapping(video, anime, 3);
  expect(readDanmakuEpisodeMapping(video, { ...anime, animeId: 2 })).toBeNull();
  expect(
    readDanmakuEpisodeMapping(video, {
      ...anime,
      episodes: anime.episodes.slice(0, 2),
    })
  ).toBeNull();
});
it('handles unavailable storage without disrupting playback', () => {
  const storage = {
    setItem: () => {
      throw new Error('quota');
    },
    getItem: () => '{bad',
  } as unknown as Storage;
  expect(() =>
    saveDanmakuEpisodeMapping(video, anime, 3, storage)
  ).not.toThrow();
  expect(readDanmakuEpisodeMapping(video, anime, storage)).toBeNull();
});

it('does not access an unavailable localStorage getter outside its error boundary', () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get: () => {
      throw new DOMException('Blocked', 'SecurityError');
    },
  });
  try {
    expect(() => saveDanmakuEpisodeMapping(video, anime, 3)).not.toThrow();
    expect(readDanmakuEpisodeMapping(video, anime)).toBeNull();
  } finally {
    if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
  }
});
