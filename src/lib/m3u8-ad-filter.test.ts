import { filterAdsFromM3U8 } from './m3u8-ad-filter';

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
