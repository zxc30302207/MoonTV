import {
  buildDanmakuMatchFileNames,
  DanmakuRequestError,
  findAutoDanmakuMatch,
  findDanmakuEpisodeFromSearch,
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

function errorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    text: async () => JSON.stringify(body),
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

  it('treats explicit unmatched responses as empty even when candidates are present', async () => {
    global.fetch = jest.fn(async () => {
      return jsonResponse({
        isMatched: false,
        matches: [{ animeId: 1, animeTitle: '錯誤結果', episodeId: 101 }],
      });
    }) as unknown as typeof fetch;

    await expect(matchAnime('波波 S1E1 @qiyi')).resolves.toEqual([]);
  });

  it('preserves structured HTTP errors from the danmaku proxy', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    global.fetch = jest.fn(async () => {
      return errorResponse(503, {
        code: 'DANMAKU_UPSTREAM_AUTH_REQUIRED',
        error: 'missing credentials',
      });
    }) as unknown as typeof fetch;

    await expect(matchAnime('missing S1E1')).rejects.toMatchObject({
      name: 'DanmakuRequestError',
      status: 503,
      code: 'DANMAKU_UPSTREAM_AUTH_REQUIRED',
      message: 'missing credentials',
    } satisfies Partial<DanmakuRequestError>);
    consoleErrorSpy.mockRestore();
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

  it('keeps trying candidates when one match request fails', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const consoleWarnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(errorResponse(500, { error: 'temporary fail' }))
      .mockResolvedValueOnce(
        jsonResponse({
          matches: [{ animeId: 8, animeTitle: '波波', episodeId: 801 }],
        })
      ) as unknown as typeof fetch;

    const result = await matchAnimeCandidates(['bad candidate', '波波 第1集']);

    expect(result).toMatchObject({
      fileName: '波波 第1集',
      matches: [
        {
          animeId: 8,
          animeTitle: '波波',
          episodeId: 801,
          episodeTitle: 'EP801',
        },
      ],
    });
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('uses search fallback immediately when match requests are slower', async () => {
    global.fetch = jest.fn((input, init) => {
      const url = String(input);

      if (url.includes('/search/episodes')) {
        return Promise.resolve(
          jsonResponse({
            success: true,
            errorCode: 0,
            animes: [
              {
                animeId: 21,
                animeTitle: 'Demo from iqiyi',
                type: 'tv',
                typeDescription: 'TV',
                episodes: [{ episodeId: 2101, episodeTitle: '[qiyi] EP1' }],
              },
            ],
          })
        );
      }

      if (url.includes('/api/v2/match')) {
        return new Promise<Response>((resolve, reject) => {
          const signal = (init as RequestInit | undefined)
            ?.signal as AbortSignal | null;
          const timer = setTimeout(() => {
            resolve(
              jsonResponse({
                matches: [
                  {
                    animeId: 22,
                    animeTitle: 'Slow match',
                    episodeId: 2201,
                  },
                ],
              })
            );
          }, 100);

          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true }
          );
        });
      }

      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    }) as unknown as typeof fetch;

    const result = await findAutoDanmakuMatch({
      title: 'Demo',
      episodeNumber: 1,
      platform: 'qiyi',
    });

    expect(result).toMatchObject({
      source: 'search',
      fileName: null,
      match: {
        animeId: 21,
        animeTitle: 'Demo from iqiyi',
        episodeId: 2101,
        episodeTitle: '[qiyi] EP1',
      },
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

  it('selects a fallback episode from search results when match returns empty', () => {
    expect(
      findDanmakuEpisodeFromSearch(
        [
          {
            animeId: 9,
            animeTitle: '波波',
            type: 'tv',
            typeDescription: 'TV',
            episodeCount: 3,
            episodes: [
              { episodeId: 901, episodeTitle: '第1集' },
              { episodeId: 902, episodeTitle: '第2集' },
              { episodeId: 903, episodeTitle: '第三話' },
            ],
          },
        ],
        3
      )
    ).toMatchObject({
      animeId: 9,
      animeTitle: '波波',
      episodeId: 903,
      episodeTitle: '第三話',
    });

    expect(findDanmakuEpisodeFromSearch([], 1)).toBeNull();
  });

  it('prefers matching danmaku platform when search returns multiple sources', () => {
    expect(
      findDanmakuEpisodeFromSearch(
        [
          {
            animeId: 10,
            animeTitle: '波波 from iqiyi',
            type: 'tv',
            typeDescription: 'TV',
            episodeCount: 1,
            episodes: [{ episodeId: 1001, episodeTitle: '[qiyi] 第1集' }],
          },
          {
            animeId: 11,
            animeTitle: '波波 from renren',
            type: 'tv',
            typeDescription: 'TV',
            episodeCount: 1,
            episodes: [{ episodeId: 1101, episodeTitle: '[renren] 第1集' }],
          },
        ],
        1,
        'renren'
      )
    ).toMatchObject({
      animeId: 11,
      episodeId: 1101,
      episodeTitle: '[renren] 第1集',
    });
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
