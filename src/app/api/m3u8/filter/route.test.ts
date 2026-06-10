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
      ...segmentLines(10, 2.0235, '../ad/ad', 0),
      ...segmentLines(30, 3.753, 'seg/main', 30),
      ...segmentLines(10, 2.0235, '../ad/ad', 10),
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
      'URI="/api/m3u8/filter?url=https%3A%2F%2Fmedia.example.com%2Faudio%2Fplaylist.m3u8"'
    );
    expect(text).toContain(
      'URI="/api/m3u8/filter?url=https%3A%2F%2Fmedia.example.com%2Fiframe%2Fplaylist"'
    );
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
