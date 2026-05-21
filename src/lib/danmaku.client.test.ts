import {
  buildDanmakuMatchFileNames,
  getDanmakuUrlByEpisodeId,
  matchAnime,
  matchAnimeCandidates,
  resolveDanmakuEpisodeNumber,
} from './danmaku.client';

const originalFetch = global.fetch;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe('danmaku client', () => {
  beforeEach(() => {
    (
      window as Window & {
        RUNTIME_CONFIG?: { DANMU_API_BASE_URL: string };
      }
    ).RUNTIME_CONFIG = {
      DANMU_API_BASE_URL: 'https://danmu.example',
    };
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('normalizes top-level match results', async () => {
    global.fetch = jest.fn(async () => {
      return jsonResponse({
        matches: [
          {
            animeId: 1,
            animeTitle: '波波',
            type: 'tv',
            typeDescription: 'TV',
            episodeId: 100,
            episodeTitle: '第1集',
          },
        ],
      });
    }) as unknown as typeof fetch;

    const matches = await matchAnime('波波 S1E1 @bilibili1');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://danmu.example/api/v2/match',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ fileName: '波波 S1E1 @bilibili1' }),
      })
    );
    expect(matches).toEqual([
      {
        animeId: 1,
        animeTitle: '波波',
        type: 'tv',
        typeDescription: 'TV',
        episodeId: 100,
        episodeTitle: '第1集',
      },
    ]);
  });

  it('supports nested and array match response shapes', async () => {
    const responses = [
      { data: { matches: [{ animeId: 2, animeTitle: '巢', episodeId: 200 }] } },
      {
        data: [
          {
            anime_id: '3',
            anime_title: '基地',
            episode_id: '300',
            episode_title: 'EP3',
            type_description: 'Movie',
          },
        ],
      },
    ];
    global.fetch = jest.fn(async () => {
      return jsonResponse(responses.shift());
    }) as unknown as typeof fetch;

    await expect(matchAnime('巢 S1E2 @qq')).resolves.toEqual([
      {
        animeId: 2,
        animeTitle: '巢',
        type: '',
        typeDescription: '',
        episodeId: 200,
        episodeTitle: 'EP200',
      },
    ]);
    await expect(matchAnime('基地 S1E3 @qq')).resolves.toEqual([
      {
        animeId: 3,
        animeTitle: '基地',
        type: '',
        typeDescription: 'Movie',
        episodeId: 300,
        episodeTitle: 'EP3',
      },
    ]);
  });

  it('returns an empty list when match response has no candidates', async () => {
    global.fetch = jest.fn(async () => {
      return jsonResponse({ matches: [] });
    }) as unknown as typeof fetch;

    await expect(matchAnime('missing S1E1 @dandan')).resolves.toEqual([]);
  });

  it('tries generated match candidates until one returns results', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ matches: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          matches: [{ animeId: 7, animeTitle: '波波', episodeId: 701 }],
        })
      ) as unknown as typeof fetch;

    const candidates = buildDanmakuMatchFileNames({
      title: '波波',
      year: '2026',
      episodeNumber: 1,
      season: 1,
      platform: 'bilibili1',
    });
    const result = await matchAnimeCandidates(candidates);

    expect(candidates).toContain('波波 S01E01 @bilibili1');
    expect(candidates).toContain('波波 第1集');
    expect(result).toMatchObject({
      fileName: candidates[1],
      matches: [
        {
          animeId: 7,
          animeTitle: '波波',
          episodeId: 701,
          episodeTitle: 'EP701',
        },
      ],
    });
  });

  it('builds comment URL from episode id and resolves fallback episode number', () => {
    expect(getDanmakuUrlByEpisodeId(123, 'xml')).toBe(
      'https://danmu.example/api/v2/comment/123?format=xml'
    );
    expect(resolveDanmakuEpisodeNumber('第12集', 0)).toBe(12);
    expect(resolveDanmakuEpisodeNumber('', 4)).toBe(5);
    expect(resolveDanmakuEpisodeNumber(undefined, 2)).toBe(3);
  });

  it('uses the internal danmaku proxy when no base URL is configured', () => {
    (
      window as Window & {
        RUNTIME_CONFIG?: { DANMU_API_BASE_URL?: string };
      }
    ).RUNTIME_CONFIG = {};

    expect(getDanmakuUrlByEpisodeId(456, 'xml')).toBe(
      '/api/danmaku/api/v2/comment/456?format=xml'
    );
  });
});
