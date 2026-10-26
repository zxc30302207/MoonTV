import { getFollowingWatchedEpisodes } from './following';
import type { PlayRecord } from './types';

const history: PlayRecord = {
  title: 'Shared name',
  search_title: 'Shared name',
  source_name: 'Source',
  cover: '',
  year: '2026',
  index: 9,
  total_episodes: 10,
  play_time: 1,
  total_time: 100,
  save_time: 1,
};
it('uses exact source/id history in preference to title matches', () => {
  expect(
    getFollowingWatchedEpisodes(
      'a+1',
      { watched_episodes: 2 },
      { 'a+1': { ...history, index: 3 }, 'b+1': history }
    )
  ).toBe(3);
});
it('keeps existing watched progress when only another source has a same-title/year/count history', () => {
  expect(
    getFollowingWatchedEpisodes(
      'a+1',
      { watched_episodes: 2 },
      { 'b+1': history }
    )
  ).toBe(2);
  expect(
    getFollowingWatchedEpisodes('a+1', undefined, { 'b+1': history })
  ).toBe(0);
});
