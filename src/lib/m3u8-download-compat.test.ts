import { downloadTsSegmentConcurrent, parseM3U8 } from './m3u8-downloader';

jest.mock('./mp4-transmuxer', () => ({
  StreamingTransmuxer: jest.fn(),
  transmuxTSToMP4: jest.fn(),
}));

describe('M3U8 upstream and custom compatibility', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('retains safe fetch/URL validation and transformations across master recursion', async () => {
    const fetcher = jest.fn(
      async (url: string) =>
        ({
          text: async () =>
            url.endsWith('master.m3u8')
              ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000,RESOLUTION=1280x720\nhigh/index.m3u8'
              : '#EXTM3U\n#EXTINF:5,\nsegment.ts\n#EXTINF:2,\nad.ts\n#EXT-X-ENDLIST',
        } as Response)
    );
    const validateUrl = jest.fn();
    const transformPlaylist = jest.fn((content: string) =>
      content.replace('#EXTINF:2,\nad.ts\n', '')
    );
    const result = await parseM3U8(
      'https://cdn.test/master.m3u8',
      { fetcher, validateUrl, transformPlaylist },
      0,
      { height: 360 }
    );
    expect(result.url).toBe('https://cdn.test/low/index.m3u8');
    expect(result.tsUrlList).toEqual(['https://cdn.test/low/segment.ts']);
    expect(validateUrl).toHaveBeenCalledWith('https://cdn.test/low/segment.ts');
    expect(transformPlaylist).toHaveBeenCalledTimes(2);
  });
  it('never fetches an unsafe child playlist', async () => {
    const fetcher = jest.fn(
      async () =>
        ({
          text: async () =>
            '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nhttp://127.0.0.1/private.m3u8',
        } as Response)
    );
    await expect(
      parseM3U8('https://cdn.test/master.m3u8', {
        fetcher,
        validateUrl: (url) => {
          if (url.includes('127.0.0.1')) throw new Error('unsafe');
        },
      })
    ).rejects.toThrow('unsafe');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('resolves redirect-relative media and keys against the final URL', async () => {
    const fetcher = jest.fn(async (url: string) =>
      url.endsWith('.key')
        ? ({ arrayBuffer: async () => new Uint8Array(16).buffer } as Response)
        : ({
            url: 'https://cdn.test/final/show/index.m3u8',
            text: async () =>
              '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../video.key"\n#EXTINF:5,\nchunk.ts\n#EXT-X-ENDLIST',
          } as Response)
    );
    const result = await parseM3U8('https://entry.test/start.m3u8', {
      fetcher,
    });
    expect(result.url).toBe('https://cdn.test/final/show/index.m3u8');
    expect(result.tsUrlList).toEqual(['https://cdn.test/final/show/chunk.ts']);
    expect(fetcher).toHaveBeenCalledWith('https://cdn.test/final/video.key');
  });
  it('allows an authenticated proxy to supply its verified upstream URL', async () => {
    const fetcher = jest.fn(
      async () =>
        ({
          url: 'https://app.test/api/m3u8?url=source',
          text: async () => '#EXTM3U\n#EXTINF:5,\nchunk.ts\n#EXT-X-ENDLIST',
        } as Response)
    );
    const result = await parseM3U8('https://entry.test/start.m3u8', {
      fetcher,
      resolveResponseUrl: () => 'https://cdn.test/final/index.m3u8',
    });
    expect(result.tsUrlList).toEqual(['https://cdn.test/final/chunk.ts']);
  });
  it('uses the full probe response once when Range is unsupported', async () => {
    const data = new Uint8Array([1, 2, 3]).buffer;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => data,
    });
    await expect(
      downloadTsSegmentConcurrent('https://cdn.test/segment.ts')
    ).resolves.toBe(data);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
