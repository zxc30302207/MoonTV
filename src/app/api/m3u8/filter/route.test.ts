/* eslint-disable @typescript-eslint/no-var-requires */

const mockSafeFetch = jest.fn();

jest.mock('@/lib/url-safety', () => ({
  assertSafeUrl: jest.fn((input: string) => new URL(input)),
  parseAllowedHosts: jest.fn(),
  safeFetch: mockSafeFetch,
}));

describe('/api/m3u8/filter', () => {
  beforeAll(() => {
    const { MessageChannel, MessagePort } = require('worker_threads');
    Object.assign(globalThis, { MessageChannel, MessagePort });
    const { Headers, Request, Response } = require('undici');
    Object.assign(globalThis, { Headers, Request, Response });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('filters media playlists and rewrites segment/key/map URIs', async () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-KEY:METHOD=AES-128,URI="../keys/main.key"',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-PART:DURATION=0.333,URI="parts/part0.m4s"',
      ...segmentLines(30, 3.753, 'seg/main', 0),
      '#EXT-X-CUE-OUT:20.235',
      ...segmentLines(10, 2.0235, '../ad/ad', 0),
      '#EXT-X-CUE-IN',
      ...segmentLines(30, 3.753, 'seg/main', 30),
      '#EXT-X-CUE-OUT:20.235',
      ...segmentLines(10, 2.0235, '../ad/ad', 10),
      '#EXT-X-CUE-IN',
      ...segmentLines(30, 3.753, 'seg/main', 60),
      '#EXT-X-ENDLIST',
    ].join('\n');
    mockSafeFetch.mockResolvedValue(new Response(playlist, { status: 200 }));

    const { GET } = await import('./route');
    const response = await GET(
      requestWithUrl(
        'http://localhost/api/m3u8/filter?url=' +
          encodeURIComponent('https://media.example.com/movie/hls/index.m3u8')
      )
    );
    const text = await response.text();

    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-MoonTV-Dropped-Segments')).toBe('20');
    expect(text).toContain(
      'URI="https://media.example.com/movie/keys/main.key"'
    );
    expect(text).toContain(
      'URI="https://media.example.com/movie/hls/init.mp4"'
    );
    expect(text).toContain(
      'URI="https://media.example.com/movie/hls/parts/part0.m4s"'
    );
    expect(text).toContain('https://media.example.com/movie/hls/seg/main0.ts');
    expect(text).not.toContain('/ad/ad0.ts');
  });

  it('rewrites master playlist child entries and URI attributes through the filter route', async () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="main",URI="audio/playlist.m3u8"',
      '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,URI="iframe/playlist"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000000',
      '720p/playlist',
    ].join('\n');
    mockSafeFetch.mockResolvedValue(new Response(playlist, { status: 200 }));

    const { GET } = await import('./route');
    const response = await GET(
      requestWithUrl(
        'http://localhost/api/m3u8/filter?url=' +
          encodeURIComponent('https://media.example.com/master.m3u8')
      )
    );
    const text = await response.text();

    expect(text).toContain(
      '/api/m3u8/filter?url=https%3A%2F%2Fmedia.example.com%2F720p%2Fplaylist'
    );
    expect(text).toContain(
      'URI="/api/m3u8/filter?url=https%3A%2F%2Fmedia.example.com%2Faudio%2Fplaylist.m3u8&preserve=1"'
    );
    expect(text).toContain(
      'URI="/api/m3u8/filter?url=https%3A%2F%2Fmedia.example.com%2Fiframe%2Fplaylist&preserve=1"'
    );
  });
  it('resolves relative playlists, key and segment paths against the final redirect URL', async () => {
    const upstream = new Response(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../keys/main.key"\n#EXTINF:8,\nsegments/main.ts\n#EXT-X-ENDLIST'
    );
    Object.defineProperty(upstream, 'url', {
      value: 'https://final-cdn.example.com/redirected/show/index.m3u8',
    });
    mockSafeFetch.mockResolvedValue(upstream);
    const { GET } = await import('./route');
    const response = await GET(
      requestWithUrl(
        'http://localhost/api/m3u8/filter?url=' +
          encodeURIComponent('https://entry.example.com/start.m3u8')
      )
    );
    const text = await response.text();
    expect(text).toContain(
      'https://final-cdn.example.com/redirected/show/segments/main.ts'
    );
    expect(text).toContain(
      'https://final-cdn.example.com/redirected/keys/main.key'
    );
    expect(text).not.toContain('https://entry.example.com/segments');
  });

  it('keeps suffixless rendition reports in the filtering path', async () => {
    mockSafeFetch.mockResolvedValue(
      new Response(
        '#EXTM3U\n#EXT-X-RENDITION-REPORT:URI="alternate/playlist",LAST-MSN=1\n#EXTINF:8,\nsegment.ts\n#EXT-X-ENDLIST'
      )
    );
    const { GET } = await import('./route');
    const response = await GET(
      requestWithUrl(
        'http://localhost/api/m3u8/filter?url=' +
          encodeURIComponent('https://cdn.example.com/show/index.m3u8')
      )
    );
    expect(await response.text()).toContain(
      'URI="/api/m3u8/filter?url=https%3A%2F%2Fcdn.example.com%2Fshow%2Falternate%2Fplaylist"'
    );
  });

  it('publishes verified removal counts and replaces untrusted upstream diagnostic markers', async () => {
    const prefix = '/20260917/oVx7Nl6K/hls/';
    const files = ['6DX5yaZ1.ts', 'Q22Q6Lti.ts', 'Qailk3T1.ts', 'aV53bW81.ts'];
    const durations = [5, 5, 5, 2.567];
    const ad = files.flatMap((file, index) => [
      `#EXTINF:${durations[index]},`,
      prefix + file,
    ]);
    mockSafeFetch.mockResolvedValue(
      new Response(
        [
          '#EXTM3U',
          '#MOONTV-AD-FILTER:{"removedSegments":999,"removedSeconds":999}',
          '#EXTINF:8,',
          'main/one.ts',
          ...ad,
          '#EXTINF:8,',
          'main/two.ts',
          '#EXT-X-ENDLIST',
        ].join('\n')
      )
    );
    const { GET } = await import('./route');
    const response = await GET(
      requestWithUrl(
        'http://localhost/api/m3u8/filter?url=' +
          encodeURIComponent('https://cdn.example.com/show/index.m3u8')
      )
    );
    const text = await response.text();
    expect(response.headers.get('X-MoonTV-Dropped-Segments')).toBe('4');
    expect(response.headers.get('X-MoonTV-Dropped-Duration')).toBe('17.567');
    expect(text).toContain(
      '#MOONTV-AD-FILTER:{"removedSegments":4,"removedSeconds":17.567}'
    );
    expect(text).not.toContain('999');
    expect(text).not.toContain('oVx7Nl6K');
    expect(text).toContain('https://cdn.example.com/show/main/one.ts');
    expect(text).toContain('https://cdn.example.com/show/main/two.ts');
  });
  it('preserves the complete media timeline for independent audio/subtitle renditions', async () => {
    const master =
      '#EXTM3U\n#EXT-X-MEDIA:URI="audio/index.m3u8",GROUP-ID="a",TYPE=AUDIO\n#EXT-X-STREAM-INF:BANDWIDTH=1000,AUDIO="a"\nvideo/index.m3u8';
    mockSafeFetch.mockResolvedValueOnce(new Response(master));
    const { GET } = await import('./route');
    const root = await GET(
      requestWithUrl(
        'http://localhost/api/m3u8/filter?url=' +
          encodeURIComponent('https://cdn.example.com/master.m3u8')
      )
    );
    const rewritten = await root.text();
    expect(rewritten).toContain('preserve=1');
    expect(root.headers.get('X-MoonTV-Filter-Mode')).toBe('preserve-timeline');
    mockSafeFetch.mockResolvedValueOnce(
      new Response(
        '#EXTM3U\n#EXT-X-CUE-OUT:2\n#EXTINF:2,\nclip.ts\n#EXTINF:8,\nmain.ts\n#EXT-X-ENDLIST'
      )
    );
    const child = await GET(
      requestWithUrl(
        'http://localhost/api/m3u8/filter?preserve=1&url=' +
          encodeURIComponent('https://cdn.example.com/video/index.m3u8')
      )
    );
    const body = await child.text();
    expect(body).toContain('https://cdn.example.com/video/clip.ts');
    expect(body).toContain('https://cdn.example.com/video/main.ts');
    expect(child.headers.get('X-MoonTV-Dropped-Segments')).toBe('0');
    expect(body).toContain('"preservedReason":"multiple-renditions"');
  });
});

function segmentLines(
  count: number,
  duration: number,
  prefix: string,
  start: number
): string[] {
  return Array.from({ length: count }, (_, offset) => [
    `#EXTINF:${duration},`,
    `${prefix}${start + offset}.ts`,
  ]).flat();
}

export {};

function requestWithUrl(url: string) {
  return {
    headers: new Headers(),
    nextUrl: new URL(url),
  } as never;
}
