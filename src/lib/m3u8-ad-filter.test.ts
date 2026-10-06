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
      '#EXT-X-CUE-OUT:4',
      '#EXTINF:2.000000,',
      'https://cdn.example.com/mov/AD/preroll0.ts',
      '#EXTINF:2.000000,',
      'https://cdn.example.com/mov/AD/preroll1.ts',
      '#EXT-X-CUE-IN',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key.bin"',
      '#EXTINF:4.000000,',
      'https://cdn.example.com/movie/part0.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const filtered = filterAdsFromM3U8(playlist);

    expect(filtered).not.toContain('/AD/');
    expect(filtered.split('\n')).not.toContain('#EXT-X-DISCONTINUITY');
    expect(filtered).toContain('#EXT-X-KEY:METHOD=AES-128');
    expect(filtered).toContain('https://cdn.example.com/movie/part0.ts');
  });

  it('keeps an unverified cold open despite a different folder and discontinuity', () => {
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

    expect(filtered).toContain('/stream/202604/08/cf1g6f/');
    expect(filtered).toContain('#EXT-X-DISCONTINUITY');
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

  it('preserves unverified interstitial metadata and its following media', () => {
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

    expect(result.droppedSegments).toBe(0);
    expect(result.content).toContain('DATERANGE');
    expect(result.content).toContain('vast-ad-1');
    expect(result.content).toContain('/videos/main/index0.ts');
    expect(result.content).toContain('/videos/main/index1.ts');
  });

  it('does not assume that an interstitial class identifies advertising', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-TARGETDURATION:6',
      '#EXTINF:6.000000,',
      '/videos/main/index0.ts',
      '#EXT-X-DATERANGE:ID="ad-1",CLASS="com.apple.hls.interstitial",START-DATE="2026-05-21T00:00:00Z",DURATION=6',
      '#EXTINF:6.000000,',
      '/videos/main/index1.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterAdsFromM3U8WithStats(playlist);

    expect(result.droppedSegments).toBe(0);
    expect(result.content).toContain('DATERANGE');
    expect(result.content).toContain('/videos/main/index0.ts');
    expect(result.content).toContain('/videos/main/index1.ts');
  });

  it('keeps image-suffixed entries because valid media may be disguised as jpg', () => {
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

    expect(filtered).toContain('banner.jpg');
    expect(filtered).toContain('main0000.ts');
  });

  it('preserves unverified URI-only fixture: removes recurring short inserted ad groups from Modu-style playlists', () => {
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

    expect(result).toEqual({ content: playlist, droppedSegments: 0 });
  });

  it('preserves unverified URI-only fixture: removes repeated 360-style short inserted groups', () => {
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

    expect(result).toEqual({ content: playlist, droppedSegments: 0 });
  });

  it('preserves unverified URI-only fixture: removes sparse iKun-style recurring inserted groups', () => {
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

    expect(result).toEqual({ content: playlist, droppedSegments: 0 });
  });

  it('preserves unverified URI-only fixture: removes repeated inline Modu-style ad runs without discontinuity tags', () => {
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

    expect(result).toEqual({ content: playlist, droppedSegments: 0 });
  });

  it('keeps unverified repeated alternate scenes even when their filenames sound suspicious', () => {
    const mainBase = 'https://bf.modujx11.com/20260605/35q3P9pc/3623kb/hls/';
    const adBase = 'https://bf.modujx15.com/20260604/LNKyEzPq/10048kb/hls/';
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:4',
      ...segmentLines(87, 2.002, mainBase, 'main'),
      ...segmentLines(10, 2.0235, adBase, 'gambling'),
      ...segmentLines(337, 2.002, mainBase, 'main', 87),
      ...segmentLines(10, 2.0235, adBase, 'gambling', 10),
      ...segmentLines(400, 2.002, mainBase, 'main', 424),
      ...segmentLines(10, 2.0235, adBase, 'gambling', 20),
      ...segmentLines(400, 2.002, mainBase, 'main', 824),
      ...segmentLines(10, 2.0235, adBase, 'gambling', 30),
      ...segmentLines(327, 2.002, mainBase, 'main', 1224),
      ...segmentLines(10, 2.0235, adBase, 'gambling', 40),
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterAdsFromM3U8WithStats(playlist);

    expect(result.droppedSegments).toBe(0);
    expect(countMediaSegments(result.content)).toBe(1601);
    expect(result.content).toContain('/LNKyEzPq/10048kb/hls/');
    expect(result.content).toContain(`${mainBase}main0.ts`);
    expect(result.content).toContain(`${mainBase}main1550.ts`);
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

  it('keeps normal media when ad-like text only appears in a query string', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXTINF:6.000000,',
      'https://cdn.example.com/video/main/index0.ts?token=ad-preroll',
      '#EXTINF:6.000000,',
      'https://cdn.example.com/video/main/index1.ts?ad=1',
      '#EXT-X-ENDLIST',
    ].join('\n');

    expect(filterAdsFromM3U8WithStats(playlist)).toEqual({
      content: playlist,
      droppedSegments: 0,
    });
  });

  it('keeps ordinary paths that merely contain ad as part of a word', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXTINF:6.000000,',
      'https://cdn.example.com/video/adventure/index0.ts',
      '#EXTINF:6.000000,',
      'https://cdn.example.com/video/shadow/index1.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    expect(filterAdsFromM3U8WithStats(playlist)).toEqual({
      content: playlist,
      droppedSegments: 0,
    });
  });

  it('keeps a playlist when the main content itself lives under an AD-like directory', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      ...segmentLines(20, 2, 'https://cdn.example.com/mov/AD/', 'main'),
      '#EXT-X-ENDLIST',
    ].join('\n');

    expect(filterAdsFromM3U8WithStats(playlist)).toEqual({
      content: playlist,
      droppedSegments: 0,
    });
  });

  it('preserves unverified URI-only fixture: keeps dominant jpg media segments while removing a small AD preroll', () => {
    const mainSegments = Array.from({ length: 30 }, (_, index) => [
      '#EXTINF:4.000000,',
      `https://cdn.example.com/mov/uphls/title/main${index}.jpg`,
    ]).flat();
    const playlist = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      ...segmentLines(8, 2, 'https://cdn.example.com/mov/AD/', 'pre'),
      ...mainSegments,
      '#EXT-X-ENDLIST',
    ].join('\n');

    const result = filterAdsFromM3U8WithStats(playlist);

    expect(result).toEqual({ content: playlist, droppedSegments: 0 });
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
      '#EXT-X-CUE-OUT:20',
      ...segmentLines(5, 4, '/video/ad/hls/', 'ad'),
      '#EXT-X-CUE-IN',
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-KEY:METHOD=AES-128,URI="/video/main/key.bin"',
      '#EXT-X-BYTERANGE:75232@0',
      '#EXT-X-PROGRAM-DATE-TIME:2026-05-24T00:00:00Z',
      ...segmentLines(30, 4, '/video/main/hls/', 'main', 30),
      '#EXT-X-DISCONTINUITY',
      '#EXT-X-KEY:METHOD=NONE',
      '#EXT-X-CUE-OUT:20',
      ...segmentLines(5, 4, '/video/ad/hls/', 'ad', 5),
      '#EXT-X-CUE-IN',
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

// Bounded manifest excerpts from public configured sources, captured 2026-10-06.
// Main programme URLs are replaced with example.com. Verified ad paths are exact.
// Modu: 你好湖南 20261005 + 掌門低調點2026 ep34, both repeat this 17.64s clip.
// Decoded first-segment SHA-256: 360b0c5f3838807fd6e10120eab143f7c49ca9b7a3a22b5335a202ecef668964.
// 360: 听见繁星 + Doraemon, same 17.567s sequence across two CDN hosts.
// Decoded first-segment SHA-256: c50a42f22eca4fb2c871f704c227c9387fdf68de5e3e5164c20f89f7152f68c8.
// Sampled frames show gambling/VPN advertising; no frames or media are committed.
const verifiedModu = [
  ['ziiI7NqG.ts', 3],
  ['6A9DtRjZ.ts', 3],
  ['yDBttVea.ts', 5],
  ['375tEjhm.ts', 3],
  ['8MtYWTXy.ts', 3],
  ['ZSaJTnmE.ts', 0.64],
] as const;
const verified360 = [
  ['6DX5yaZ1.ts', 5],
  ['Q22Q6Lti.ts', 5],
  ['Qailk3T1.ts', 5],
  ['aV53bW81.ts', 2.567],
] as const;
const verifiedLines = (
  prefix: string,
  entries: ReadonlyArray<readonly [string, number]>
) =>
  entries.flatMap(([file, duration]) => [
    `#EXTINF:${duration},`,
    `${prefix}${file}`,
  ]);

it('removes a verified Modu midroll plus identical tail without requiring two interior insertions', () => {
  const ad = verifiedLines('/20260917/khKm9Z55/10110kb/hls/', verifiedModu);
  const main = segmentLines(10, 2, 'https://main.example.com/show/', 'scene');
  const result = filterAdsFromM3U8WithStats(
    ['#EXTM3U', ...main, ...ad, ...main, ...ad, '#EXT-X-ENDLIST'].join('\n')
  );
  expect(result.droppedSegments).toBe(12);
  expect(result.droppedDuration).toBe(35.28);
  expect(countMediaSegments(result.content)).toBe(20);
  expect(result.content).not.toContain('khKm9Z55');
  expect(result.content).toContain('scene0.ts');
  expect(result.content).toContain('scene9.ts');
});

it('matches verified 360 sequences across rotated CDN hosts and preserves normal ad-substring filenames', () => {
  const relative = verifiedLines('/20260917/oVx7Nl6K/hls/', verified360);
  const absolute = verifiedLines(
    'https://new-cdn.example.com/20260917/oVx7Nl6K/hls/',
    verified360
  );
  const result = filterAdsFromM3U8WithStats(
    [
      '#EXTM3U',
      '#EXTINF:8,',
      '/main/0Adg9umW.ts',
      ...relative,
      '#EXTINF:8,',
      '/main/real.ts',
      ...absolute,
      '#EXT-X-ENDLIST',
    ].join('\n')
  );
  expect(result.droppedSegments).toBe(8);
  expect(result.droppedDuration).toBe(35.134);
  expect(result.content).toContain('/main/0Adg9umW.ts');
  expect(result.content).toContain('/main/real.ts');
});

it('keeps unrecognized assets in the same folder and incomplete/timing-mismatched sequences', () => {
  const partial = verifiedLines(
    '/20260917/khKm9Z55/10110kb/hls/',
    verifiedModu.slice(0, 5)
  );
  const result = filterAdsFromM3U8WithStats(
    [
      '#EXTM3U',
      '#EXTINF:8,',
      '/main/a.ts',
      ...partial,
      '#EXTINF:3,',
      '/20260917/khKm9Z55/10110kb/hls/unknown.ts',
      '#EXT-X-ENDLIST',
    ].join('\n')
  );
  expect(result.droppedSegments).toBe(0);
  const changed = verifiedLines('/20260917/oVx7Nl6K/hls/', verified360)
    .join('\n')
    .replace('#EXTINF:5,', '#EXTINF:9,');
  expect(
    filterAdsFromM3U8WithStats(
      `#EXTM3U\n#EXTINF:8,\n/main/a.ts\n${changed}\n#EXT-X-ENDLIST`
    ).droppedSegments
  ).toBe(0);
});

it('carries inherited key and map state from a removed segment to the following programme', () => {
  const result = filterAdsFromM3U8WithStats(
    [
      '#EXTM3U',
      '#EXT-X-MEDIA-SEQUENCE:100',
      '#EXT-X-KEY:METHOD=AES-128,URI="init.key",IV=0x00000000000000000000000000000001',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXT-X-CUE-OUT:2',
      '#EXTINF:2,',
      '/ads/ad0.ts',
      '#EXTINF:8,',
      '/main/real.ts',
      '#EXT-X-ENDLIST',
    ].join('\n')
  );
  expect(result.droppedSegments).toBe(1);
  expect(result.content).toContain('#EXT-X-MAP:URI="init.mp4"');
  expect(result.content).toContain(
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000065'
  );
  expect(result.content.indexOf('init.mp4')).toBeLessThan(
    result.content.indexOf('/main/real.ts')
  );
});

it('pins original implicit IVs for kept AES-128 segments after an interior removal', () => {
  const result = filterAdsFromM3U8WithStats(
    [
      '#EXTM3U',
      '#EXT-X-MEDIA-SEQUENCE:8',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXTINF:8,',
      '/main/one.ts',
      '#EXT-X-CUE-OUT:2',
      '#EXTINF:2,',
      '/ads/ad.ts',
      '#EXTINF:8,',
      '/main/two.ts',
      '#EXT-X-ENDLIST',
    ].join('\n')
  );
  expect(result.content).toContain('IV=0x00000000000000000000000000000008');
  expect(result.content).toContain('IV=0x0000000000000000000000000000000a');
});

it('resolves implicit byte offsets against the original segments, including removed ones', () => {
  const result = filterAdsFromM3U8WithStats(
    [
      '#EXTM3U',
      '#EXT-X-BYTERANGE:100@0',
      '#EXTINF:8,',
      '/main/all.ts',
      '#EXT-X-CUE-OUT:2',
      '#EXT-X-BYTERANGE:20',
      '#EXTINF:2,',
      '/main/all.ts',
      '#EXT-X-CUE-IN',
      '#EXT-X-BYTERANGE:100',
      '#EXTINF:8,',
      '/main/all.ts',
      '#EXT-X-ENDLIST',
    ].join('\n')
  );
  expect(result.droppedSegments).toBe(1);
  expect(result.content).toContain('#EXT-X-BYTERANGE:100@120');
});

it('keeps programme content after an unclosed bounded cue and keeps an ambiguous unbounded cue', () => {
  const bounded =
    '#EXTM3U\n#EXT-X-CUE-OUT:2\n#EXTINF:2,\n/x/one.ts\n#EXTINF:8,\n/x/two.ts\n#EXT-X-ENDLIST';
  expect(filterAdsFromM3U8WithStats(bounded).content).toContain('/x/two.ts');
  expect(filterAdsFromM3U8WithStats(bounded).droppedSegments).toBe(1);
  expect(
    filterAdsFromM3U8WithStats(
      bounded.replace('#EXT-X-CUE-OUT:2', '#EXT-X-CUE-OUT')
    ).droppedSegments
  ).toBe(0);
});

it('leaves unsupported encryption and live media sequences intact instead of corrupting playback', () => {
  const vod =
    '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\n#EXTINF:2,\n/ads/ad.ts\n#EXTINF:8,\n/main/a.ts\n#EXT-X-ENDLIST';
  expect(filterAdsFromM3U8WithStats(vod)).toEqual({
    content: vod,
    droppedSegments: 0,
  });
  const live = vod
    .replace('#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\n', '')
    .replace('\n#EXT-X-ENDLIST', '');
  expect(filterAdsFromM3U8WithStats(live)).toEqual({
    content: live,
    droppedSegments: 0,
  });
});

it('never removes a minority programme scene based on gg/ad123/promo naming alone', () => {
  for (const uri of [
    '/movie/gg/scene.ts',
    '/movie/ad123.ts',
    '/movie/promo/scene.ts',
    '/movie/scene.jpg',
  ]) {
    const playlist = `#EXTM3U\n#EXTINF:20,\n/movie/main1.ts\n#EXTINF:3,\n${uri}\n#EXTINF:20,\n/movie/main2.ts\n#EXT-X-ENDLIST`;
    expect(filterAdsFromM3U8WithStats(playlist)).toEqual({
      content: playlist,
      droppedSegments: 0,
    });
  }
});

it('preserves globally scoped tags placed after KEY and pins the original sequence with compatible version', () => {
  const result = filterAdsFromM3U8WithStats(
    [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXT-X-MEDIA-SEQUENCE:100',
      '#EXT-X-TARGETDURATION:8',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-CUE-OUT:2',
      '#EXTINF:2,',
      '/x/ad.ts',
      '#EXTINF:8,',
      '/x/main.ts',
      '#EXT-X-ENDLIST',
    ].join('\n')
  );
  expect(result.droppedSegments).toBe(1);
  expect(result.content).toContain('#EXT-X-MEDIA-SEQUENCE:101');
  expect(result.content).toContain('#EXT-X-TARGETDURATION:8');
  expect(result.content).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
  expect(result.content).toContain('#EXT-X-VERSION:2');
  expect(result.content).toContain('IV=0x00000000000000000000000000000065');
});

it('leaves leading discontinuity and sequence metadata byte-for-byte unchanged when nothing is removed', () => {
  for (const tail of ['', '\n#EXT-X-ENDLIST']) {
    const playlist =
      '#EXTM3U\n#EXT-X-DISCONTINUITY-SEQUENCE:10\n#EXT-X-DISCONTINUITY\n#EXTINF:8,\n/main/real.ts' +
      tail;
    expect(filterAdsFromM3U8WithStats(playlist)).toEqual({
      content: playlist,
      droppedSegments: 0,
    });
  }
});

it('preserves an unknown director introduction interstitial, including beside a verified ad removal', () => {
  const introduction =
    '#EXT-X-DATERANGE:ID="director-introduction",CLASS="com.apple.hls.interstitial",X-ASSET-URI="intro.m3u8",START-DATE="2026-10-06T00:00:00Z"';
  const main = ['#EXTM3U', introduction, '#EXTINF:8,', '/main/one.ts'];
  const unchanged = [...main, '#EXT-X-ENDLIST'].join('\n');
  expect(filterAdsFromM3U8WithStats(unchanged)).toEqual({
    content: unchanged,
    droppedSegments: 0,
  });
  const filtered = filterAdsFromM3U8WithStats(
    [
      ...main,
      ...verifiedLines('/20260917/oVx7Nl6K/hls/', verified360),
      '#EXT-X-ENDLIST',
    ].join('\n')
  );
  expect(filtered.droppedSegments).toBe(0);
  expect(filtered.content).toContain('oVx7Nl6K');
  expect(filtered.content).toContain(introduction);
  expect(filtered.content).toContain('/main/one.ts');
});

it('preserves unknown timed metadata attached to a verified ad or final removed block', () => {
  const metadata =
    '#EXT-X-DATERANGE:ID="director-introduction",CLASS="com.apple.hls.interstitial",X-ASSET-URI="intro.m3u8",START-DATE="2026-10-06T00:00:00Z"';
  const playlist = [
    '#EXTM3U',
    '#EXTINF:20,',
    '/main/programme.ts',
    metadata,
    ...verifiedLines('/20260917/oVx7Nl6K/hls/', verified360),
    '#EXT-X-ENDLIST',
  ].join('\n');
  expect(filterAdsFromM3U8WithStats(playlist)).toEqual({
    content: playlist,
    droppedSegments: 0,
  });
});
