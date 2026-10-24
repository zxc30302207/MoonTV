import { searchFromApiStream } from './downstream';

jest.mock('@/lib/config', () => ({
  API_CONFIG: {
    search: { path: '?q=', pagePath: '?q={query}&pg={page}', headers: {} },
  },
  getConfig: async () => ({ SiteConfig: { SearchDownstreamMaxPage: 3 } }),
}));

const source = { key: 'test', name: 'Test', api: 'https://source.example/' };
const item = (id: string) => ({
  vod_id: id,
  vod_name: `Title (${id})`,
  vod_pic: '',
  vod_play_url: 'EP1$https://cdn.example/a.m3u8',
});

describe('upstream search integration', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('keeps successful pages when another page rejects and deduplicates results', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (url.includes('pg=2')) throw new Error('network failed');
      const list = url.includes('pg=3') ? [item('1'), item('3')] : [item('1')];
      return {
        ok: true,
        json: async () => ({ list, pagecount: 3 }),
      } as Response;
    });
    global.fetch = fetchMock as typeof fetch;
    const results = [];
    for await (const page of searchFromApiStream(source, 'Title (2026)'))
      results.push(...page);
    expect(results.map((result) => result.id)).toEqual(['1', '3']);
    expect(fetchMock.mock.calls.every(([url]) => url.includes('q=Title'))).toBe(
      true
    );
    expect(
      results.every(
        (result) => result.episodes[0] === 'https://cdn.example/a.m3u8'
      )
    ).toBe(true);
  });

  it('does not request anything after pre-cancellation', async () => {
    global.fetch = jest.fn();
    const controller = new AbortController();
    controller.abort();
    const results = [];
    for await (const page of searchFromApiStream(
      source,
      'Title',
      true,
      undefined,
      controller.signal
    ))
      results.push(...page);
    expect(results).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('drops malformed items while preserving valid signed playback URLs', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        list: [
          null,
          {},
          { vod_id: 1 },
          { vod_id: 2, vod_name: '  ' },
          {
            vod_id: 3,
            vod_name: '三體',
            vod_year: 2024,
            vod_play_url:
              '第一集$https://cdn.example/show.m3u8?token=signed#fragment',
          },
        ],
      }),
    });
    const results = [];
    for await (const page of searchFromApiStream(source, '三體'))
      results.push(...page);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(
      expect.objectContaining({
        id: '3',
        title: '三體',
        year: '2024',
        poster: '',
        episodes: ['https://cdn.example/show.m3u8?token=signed#fragment'],
      })
    );
  });

  it('reports HTTP failures instead of silently treating them as empty results', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const search = searchFromApiStream(source, 'Title');
    await expect(search.next()).rejects.toThrow('HTTP 503');
  });

  it('keeps sequential results when a later page has malformed JSON', async () => {
    global.fetch = jest.fn(async (url: string) => ({
      ok: true,
      json: async () => {
        if (url.includes('pg=2')) throw new SyntaxError('invalid JSON');
        return { list: [item(url.includes('pg=3') ? '3' : '1')], pagecount: 3 };
      },
    })) as unknown as typeof fetch;
    const results = [];
    for await (const page of searchFromApiStream(source, 'Title', false))
      results.push(...page);
    expect(results.map((result) => result.id)).toEqual(['1', '3']);
  });
});
