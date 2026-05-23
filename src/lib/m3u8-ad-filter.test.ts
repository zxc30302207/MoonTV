import {
  filterAdsFromM3U8,
  filterAdsFromM3U8WithStats,
} from './m3u8-ad-filter';

function segmentLines(
  count: number,
  duration: number,
  basePath: string,
  prefix: string,
  start = 0
): string[] {
  return Array.from({ length: count }, (_, offset) => [
    `#EXTINF:${duration},`,
    `${basePath}${prefix}${start + offset}.ts`,
  ]).flat();
}

function countMediaSegments(content: string): number {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith('#')).length;
}

describe('filterAdsFromM3U8', () => {
  it('removes explicit ad segments and keeps the real encrypted media', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:4',
      '#EXTINF:2.000000,',
      'https://cdn.example.com/mov/AD/preroll0.ts',
      '#EXTINF:2.000000,',
      'https://cdn.example.com/mov/AD/preroll1.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key.bin"',
      '#EXTINF:4.000000,',
      'https://cdn.example.com/movie/part0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const filtered = filterAdsFromM3U8(playlist);

    expect(filtered).not.toContain('/AD/');
    expect(filtered).not.toContain('#EXT-X-DISCONTINUITY');
    expect(filtered).toContain('#EXT-X-KEY:METHOD=AES-128');
    expect(filtered).toContain('https://cdn.example.com/movie/part0.ts');
  });

  it('removes short leading preroll blocks before the first discontinuity', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:2',
      '#EXTINF:2.000000,',
      '/stream/202604/08/cf1g6f/index0.ts',
      '#EXTINF:2.000000,',
      '/stream/202604/08/cf1g6f/index1.ts',
      '#EXTINF:0.500000,',
      '/stream/202604/08/cf1g6f/index2.ts',
      '#EXT-X-DISCONTINUITY',
      ...Array.from({ length: 12 }, (_, index) =>
        [`#EXTINF:2.000000,`, `/videos/main/index${index}.ts`].join('\n')
      ),
      '#EXT-X-ENDLIST',
    ].join('\n');

    const filtered = filterAdsFromM3U8(playlist);

    expect(filtered).not.toContain('/stream/202604/08/cf1g6f/');
    expect(filtered).not.toContain('#EXT-X-DISCONTINUITY');
    expect(filtered).toContain('/videos/main/index0.ts');
    expect(filtered).toContain('/videos/main/index11.ts');
  });

  it('removes cue-out ad breaks until cue-in', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:6',
      '#EXTINF:6.000000,',
      '/videos/main/index0.ts',
      '#EXT-X-CUE-OUT:12',
      '#EXTINF:6.000000,',
      '/ads/midroll0.ts',
      '#EXTINF:6.000000,',
      '/ads/midroll1.ts',
      '#EXT-X-CUE-IN',
      '#EXTINF:6.000000,',
      '/videos/main/index1.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const filtered = filterAdsFromM3U8(playlist);

    expect(filtered).not.toContain('midroll');
    expect(filtered).not.toContain('#EXT-X-CUE-OUT');
    expect(filtered).not.toContain('#EXT-X-CUE-IN');
    expect(filtered).toContain('/videos/main/index0.ts');
    expect(filtered).toContain('/videos/main/index1.ts');
  });

  it('removes daterange and interstitial ad markers', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-TARGETDURATION:6',
      '#EXTINF:6.000000,',
      '/videos/main/index0.ts',
      '#EXT-X-DATERANGE:ID="ad-1",CLASS="com.apple.hls.interstitial",START-DATE="2026-05-21T00:00:00Z",DURATION=6',
      '#EXTINF:6.000000,',
      '/promo/vast-ad-1.ts',
      '#EXTINF:6.000000,',
      '/videos/main/index1.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterAdsFromM3U8WithStats(playlist);

    expect(result.droppedSegments).toBe(1);
    expect(result.content).not.toContain('DATERANGE');
    expect(result.content).not.toContain('vast-ad-1');
    expect(result.content).toContain('/videos/main/index0.ts');
    expect(result.content).toContain('/videos/main/index1.ts');
  });

  it('removes image placeholders that appear as media entries', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:6',
      '#EXTINF:6.000000,',
      '/mov/uphls/banner.jpg',
      '#EXTINF:6.000000,',
      '/mov/uphls/main0000.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const filtered = filterAdsFromM3U8(playlist);

    expect(filtered).not.toContain('banner.jpg');
    expect(filtered).toContain('main0000.ts');
  });

  it('removes recurring short inserted ad groups from Modu-style playlists', () => {
    const normalSegments = 170;
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:4',
      ...segmentLines(70, 3.753, '/20230728/1vhyUy5r/1500kb/hls/', 'main'),
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-KEY:METHOD=NONE',
      ...segmentLines(10, 2.0235, '/20260521/Wjp7h1go/10088kb/hls/', 'ad'),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(30, 3.753, '/20230728/1vhyUy5r/1500kb/hls/', 'main', 70),
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-KEY:METHOD=NONE',
      ...segmentLines(10, 2.0235, '/20260521/Wjp7h1go/10088kb/hls/', 'ad', 10),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(70, 3.753, '/20230728/1vhyUy5r/1500kb/hls/', 'main', 100),
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterAdsFromM3U8WithStats(playlist);

    expect(result.droppedSegments).toBe(20);
    expect(countMediaSegments(result.content)).toBe(normalSegments);
    expect(result.content).not.toContain('/20260521/Wjp7h1go/');
    expect(result.content).toContain('#EXT-X-DISCONTINUITY');
    expect(result.content).toContain('main0.ts');
    expect(result.content).toContain('main169.ts');
  });

  it('removes repeated 360-style short inserted groups', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:5',
      ...segmentLines(
        80,
        3.333,
        'https://vod1.maowushi.com/20251030/shir1aze/821kb/hls/',
        'main'
      ),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(
        5,
        4.0466,
        'https://vod.360zyx.vip/20260523/03a6aqvq/hls/',
        'ad'
      ),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(
        80,
        3.333,
        'https://vod1.maowushi.com/20251030/shir1aze/821kb/hls/',
        'main',
        80
      ),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(
        5,
        4.0466,
        'https://vod.360zyx.vip/20260523/03a6aqvq/hls/',
        'ad',
        5
      ),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(
        80,
        3.333,
        'https://vod1.maowushi.com/20251030/shir1aze/821kb/hls/',
        'main',
        160
      ),
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterAdsFromM3U8WithStats(playlist);

    expect(result.droppedSegments).toBe(10);
    expect(countMediaSegments(result.content)).toBe(240);
    expect(result.content).not.toContain('vod.360zyx.vip');
    expect(result.content).toContain('#EXT-X-DISCONTINUITY');
  });

  it('removes sparse iKun-style recurring inserted groups', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:4',
      ...segmentLines(180, 3.753, '/20221103/uhsibknu/2000kb/hls/', 'main'),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(10, 2.0235, '/20260423/i4zx6o1y/10074kb/hls/', 'ad'),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(
        220,
        3.753,
        '/20221103/uhsibknu/2000kb/hls/',
        'main',
        180
      ),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(10, 2.0235, '/20260423/i4zx6o1y/10074kb/hls/', 'ad', 10),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(
        220,
        3.753,
        '/20221103/uhsibknu/2000kb/hls/',
        'main',
        400
      ),
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterAdsFromM3U8WithStats(playlist);

    expect(result.droppedSegments).toBe(20);
    expect(countMediaSegments(result.content)).toBe(620);
    expect(result.content).not.toContain('/20260423/i4zx6o1y/');
    expect(result.content).toContain('main619.ts');
  });

  it('removes repeated inline Modu-style ad runs without discontinuity tags', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:4',
      ...segmentLines(30, 3.753, '/20251012/Wsc1LdY1/1500kb/hls/', 'main'),
      ...segmentLines(10, 2.0235, '/20260521/iMvWvkWK/10088kb/hls/', 'ad'),
      ...segmentLines(30, 3.753, '/20251012/Wsc1LdY1/1500kb/hls/', 'main', 30),
      ...segmentLines(10, 2.0235, '/20260521/iMvWvkWK/10088kb/hls/', 'ad', 10),
      ...segmentLines(30, 3.753, '/20251012/Wsc1LdY1/1500kb/hls/', 'main', 60),
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterAdsFromM3U8WithStats(playlist);

    expect(result.droppedSegments).toBe(20);
    expect(countMediaSegments(result.content)).toBe(90);
    expect(result.content).not.toContain('/20260521/iMvWvkWK/');
    expect(result.content).toContain('main0.ts');
    expect(result.content).toContain('main89.ts');
  });

  it('keeps a single inline alternate run because recurrence is required', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:4',
      ...segmentLines(30, 3.753, '/video/main/hls/', 'main'),
      ...segmentLines(5, 3.753, '/video/opening/hls/', 'op'),
      ...segmentLines(30, 3.753, '/video/main/hls/', 'main', 30),
      '#EXT-X-ENDLIST',
    ].join('\n');

    expect(filterAdsFromM3U8WithStats(playlist)).toEqual({
      content: playlist,
      droppedSegments: 0,
    });
  });

  it('keeps playlists with many discontinuities when all groups share the same path', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:4',
      ...segmentLines(8, 3.753, '/video/2000k_1080/hls/', 'main'),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(8, 3.753, '/video/2000k_1080/hls/', 'main', 8),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(8, 3.753, '/video/2000k_1080/hls/', 'main', 16),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(8, 3.753, '/video/2000k_1080/hls/', 'main', 24),
      '#EXT-X-ENDLIST',
    ].join('\n');

    expect(filterAdsFromM3U8WithStats(playlist)).toEqual({
      content: playlist,
      droppedSegments: 0,
    });
  });

  it('keeps filename-only playlists because there is no stable path signature', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:5',
      '#EXTINF:4,',
      '3913a6a090698d9b23b7ed67ea08e399.ts',
      '#EXTINF:4,',
      '1d1ec19d88b7b62f29c7c29aab926ded.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:4,',
      '36831a50c7518df514542c6d071b2147.ts',
      '#EXTINF:4,',
      'e2fbc3719d4891e22d2a155d8ca55fec.ts',
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:4,',
      'bc753f8e69a4e90bbf22303b1bedbbea.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    expect(filterAdsFromM3U8WithStats(playlist)).toEqual({
      content: playlist,
      droppedSegments: 0,
    });
  });

  it('keeps a single short alternate group because recurrence is required', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:5',
      ...segmentLines(50, 4, '/video/main/hls/', 'main'),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(5, 4, '/video/extra-scene/hls/', 'bonus'),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(50, 4, '/video/main/hls/', 'main', 50),
      '#EXT-X-ENDLIST',
    ].join('\n');

    expect(filterAdsFromM3U8WithStats(playlist)).toEqual({
      content: playlist,
      droppedSegments: 0,
    });
  });

  it('keeps recurring alternate groups when their total duration is too large', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:5',
      ...segmentLines(20, 4, '/video/main/hls/', 'main'),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(10, 4, '/video/alternate/hls/', 'alt'),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(10, 4, '/video/main/hls/', 'main', 20),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(10, 4, '/video/alternate/hls/', 'alt', 10),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(20, 4, '/video/main/hls/', 'main', 30),
      '#EXT-X-ENDLIST',
    ].join('\n');

    expect(filterAdsFromM3U8WithStats(playlist)).toEqual({
      content: playlist,
      droppedSegments: 0,
    });
  });

  it('keeps scoped tags and boundary discontinuities after mid-roll removal', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-TARGETDURATION:5',
      '#EXT-X-MAP:URI="/video/main/init.mp4"',
      ...segmentLines(30, 4, '/video/main/hls/', 'main'),
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-KEY:METHOD=NONE',
      ...segmentLines(5, 4, '/video/ad/hls/', 'ad'),
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-KEY:METHOD=AES-128,URI="/video/main/key.bin"',
      '#EXT-X-BYTERANGE:75232@0',
      '#EXT-X-PROGRAM-DATE-TIME:2026-05-24T00:00:00Z',
      ...segmentLines(30, 4, '/video/main/hls/', 'main', 30),
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-KEY:METHOD=NONE',
      ...segmentLines(5, 4, '/video/ad/hls/', 'ad', 5),
      '#EXT-X-DISCONTINUITY',
      ...segmentLines(30, 4, '/video/main/hls/', 'main', 60),
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterAdsFromM3U8WithStats(playlist);

    expect(result.droppedSegments).toBe(10);
    expect(countMediaSegments(result.content)).toBe(90);
    expect(result.content).toContain('#EXT-X-DISCONTINUITY');
    expect(result.content).toContain(
      '#EXT-X-KEY:METHOD=AES-128,URI="/video/main/key.bin"'
    );
    expect(result.content).toContain('#EXT-X-BYTERANGE:75232@0');
    expect(result.content).toContain(
      '#EXT-X-PROGRAM-DATE-TIME:2026-05-24T00:00:00Z'
    );
    expect(result.content).not.toContain('/video/ad/hls/');
  });

  it('reports zero dropped segments for clean media playlists', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:6',
      '#EXTINF:6.000000,',
      '/videos/main/index0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    expect(filterAdsFromM3U8WithStats(playlist)).toEqual({
      content: playlist,
      droppedSegments: 0,
    });
  });

  it('leaves master playlists untouched so hls.js can select a level', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720',
      '/video/720p/index.m3u8',
    ].join('\n');

    expect(filterAdsFromM3U8(playlist)).toBe(playlist);
  });

  it('does not treat adult domains as ad segments by name alone', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXTINF:6.000000,',
      'https://cdn.adult.example.com/video/index0.ts',
      '#EXTINF:6.000000,',
      'https://cdn.adult.example.com/video/index1.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const filtered = filterAdsFromM3U8(playlist);

    expect(filtered).toContain('index0.ts');
    expect(filtered).toContain('index1.ts');
  });
});
