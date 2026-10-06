import { getAvailableApiSites } from './config';
import { getDetailFromApi, searchFromApiStream } from './downstream';
import { fetchVideoDetail } from './fetchVideoDetail';
import { SearchResult } from './types';

jest.mock('./config', () => ({ getAvailableApiSites: jest.fn() }));
jest.mock('./downstream', () => ({
  getDetailFromApi: jest.fn(),
  searchFromApiStream: jest.fn(),
}));

const result = (
  source: string,
  id: string,
  episodes: string[]
): SearchResult => ({
  source,
  id,
  episodes,
  episodes_titles: episodes.map((_, i) => `第${i + 1}集`),
  title: 'Example',
  year: '2026',
  poster: '',
  source_name: source,
});

beforeEach(() => {
  jest.clearAllMocks();
  (getAvailableApiSites as jest.Mock).mockResolvedValue([{ key: 'allowed' }]);
});

it('passes the user identity through source permission lookup', async () => {
  (getAvailableApiSites as jest.Mock).mockResolvedValue([]);
  await expect(
    fetchVideoDetail({ source: 'private', id: '1', username: 'viewer' })
  ).rejects.toThrow('無效');
  expect(getAvailableApiSites).toHaveBeenCalledWith('viewer');
  expect(getDetailFromApi).not.toHaveBeenCalled();
});

it('accepts only an exact source and id with direct playable episodes', async () => {
  (searchFromApiStream as jest.Mock).mockImplementation(async function* () {
    yield [
      result('other', '1', ['https://cdn.example.com/other.m3u8']),
      result('allowed', '2', ['https://cdn.example.com/other.m3u8']),
    ];
    yield [
      result('allowed', '1', [
        'https://example.com/player.html',
        'https://cdn.example.com/right.m3u8',
      ]),
    ];
  });
  const detail = await fetchVideoDetail({
    source: 'allowed',
    id: '1',
    fallbackTitle: 'Example',
  });
  expect(detail.episodes).toEqual(['https://cdn.example.com/right.m3u8']);
  expect(detail.episodes_titles).toEqual(['第2集']);
  expect(getDetailFromApi).not.toHaveBeenCalled();
});

it('falls back to detail when the search match has no valid M3U8 episode', async () => {
  (searchFromApiStream as jest.Mock).mockImplementation(async function* () {
    yield [result('allowed', '1', ['https://example.com/player.html'])];
  });
  (getDetailFromApi as jest.Mock).mockResolvedValue(
    result('allowed', '1', ['https://cdn.example.com/right.m3u8'])
  );
  expect(
    (
      await fetchVideoDetail({
        source: 'allowed',
        id: '1',
        fallbackTitle: 'Example',
      })
    ).episodes
  ).toHaveLength(1);
  expect(getDetailFromApi).toHaveBeenCalledTimes(1);
});
