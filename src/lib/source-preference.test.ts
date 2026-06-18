import {
  getSourceProbeKey,
  parseLoadSpeedKBps,
  rankSourcesByProbeResults,
  selectEpisodeUrlForSource,
  SourceProbeResult,
} from './source-preference';
import { SearchResult } from './types';

function makeSource(
  source: string,
  id: string,
  episodes: string[] = ['https://media.example.com/episode-1.m3u8']
): SearchResult {
  return {
    id,
    title: `${source}-${id}`,
    poster: '',
    episodes,
    episodes_titles: episodes.map((_, index) => `Episode ${index + 1}`),
    source,
    source_name: source,
    year: '2026',
  };
}

describe('source preference helpers', () => {
  it('selects the current episode url instead of always probing episode two', () => {
    const source = makeSource('fast', '1', [
      'https://media.example.com/current-episode.m3u8',
      'https://media.example.com/second-episode.m3u8',
    ]);

    expect(selectEpisodeUrlForSource(source, 0)).toBe(
      'https://media.example.com/current-episode.m3u8'
    );
    expect(selectEpisodeUrlForSource(source, 1)).toBe(
      'https://media.example.com/second-episode.m3u8'
    );
  });

  it('falls back to the first episode when the requested episode is missing', () => {
    const source = makeSource('partial', '1', [
      'https://media.example.com/fallback.m3u8',
    ]);

    expect(selectEpisodeUrlForSource(source, 99)).toBe(
      'https://media.example.com/fallback.m3u8'
    );
  });

  it('falls back to the first direct m3u8 when the requested url is a web page', () => {
    const source = makeSource('ffzynew', '97846', [
      'https://vip.ffzy-online3.com/share/023f6fecc6b88ffa0b732dd682093b80',
      'https://vip.ffzy-online3.com/20260605/45062_023f6fec/index.m3u8',
    ]);

    expect(selectEpisodeUrlForSource(source, 0)).toBe(
      'https://vip.ffzy-online3.com/20260605/45062_023f6fec/index.m3u8'
    );
  });

  it('keys source probe cache by source id and episode index', () => {
    const source = makeSource('mdzy', '84050');

    expect(getSourceProbeKey(source, 0)).toBe('mdzy-84050-ep-0');
    expect(getSourceProbeKey(source, 3)).toBe('mdzy-84050-ep-3');
  });

  it('parses KB/s and MB/s load speeds to KB/s', () => {
    expect(parseLoadSpeedKBps('512.5 KB/s')).toBe(512.5);
    expect(parseLoadSpeedKBps('2.5 MB/s')).toBe(2560);
    expect(parseLoadSpeedKBps('Unknown')).toBe(0);
  });

  it('prefers measured fast playback over unknown speed even at lower resolution', () => {
    const unknown1080 = makeSource('unknown', '1');
    const fast720 = makeSource('fast', '2');
    const results: SourceProbeResult[] = [
      {
        source: unknown1080,
        index: 0,
        testResult: {
          quality: '1080p',
          loadSpeed: 'Unknown',
          pingTime: 25,
        },
      },
      {
        source: fast720,
        index: 1,
        testResult: {
          quality: '720p',
          loadSpeed: '5.0 MB/s',
          pingTime: 90,
        },
      },
    ];

    const ranked = rankSourcesByProbeResults([unknown1080, fast720], results);

    expect(ranked[0].source).toBe(fast720);
  });

  it('puts failed probes behind playable probes', () => {
    const failed = makeSource('failed', '1');
    const playable = makeSource('playable', '2');
    const results: SourceProbeResult[] = [
      {
        source: failed,
        index: 0,
        testResult: {
          quality: 'Error',
          loadSpeed: 'Unknown',
          pingTime: 0,
          hasError: true,
        },
      },
      {
        source: playable,
        index: 1,
        testResult: {
          quality: 'SD',
          loadSpeed: '128.0 KB/s',
          pingTime: 300,
        },
      },
    ];

    const ranked = rankSourcesByProbeResults([failed, playable], results);

    expect(ranked[0].source).toBe(playable);
    expect(ranked[1].source).toBe(failed);
  });

  it('keeps original order when scores tie', () => {
    const first = makeSource('first', '1');
    const second = makeSource('second', '2');
    const results: SourceProbeResult[] = [
      {
        source: first,
        index: 0,
        testResult: {
          quality: '720p',
          loadSpeed: '1.0 MB/s',
          pingTime: 100,
        },
      },
      {
        source: second,
        index: 1,
        testResult: {
          quality: '720p',
          loadSpeed: '1.0 MB/s',
          pingTime: 100,
        },
      },
    ];

    const ranked = rankSourcesByProbeResults([first, second], results);

    expect(ranked.map((item) => item.source)).toEqual([first, second]);
  });
});
