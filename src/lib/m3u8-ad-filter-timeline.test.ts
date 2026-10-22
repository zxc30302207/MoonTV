import { filterAdsFromM3U8WithStats } from './m3u8-ad-filter';

const playlist = (header: string) =>
  [
    '#EXTM3U',
    header,
    '#EXT-X-CUE-OUT:2',
    '#EXTINF:2,',
    '/insert.ts',
    '#EXT-X-CUE-IN',
    '#EXT-X-DISCONTINUITY',
    '#EXTINF:4,',
    '/main-1.ts',
    '#EXTINF:4,',
    '/main-2.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');

describe('retained playback timeline', () => {
  it.each([
    [4, 2],
    [1, 0],
    [-6, -6],
    [-9, -8],
    [20, 8],
  ])('maps start offset %s to %s after preroll removal', (before, after) => {
    const result = filterAdsFromM3U8WithStats(
      playlist(`#EXT-X-START:TIME-OFFSET=${before},PRECISE=YES`)
    );
    expect(result.droppedSegments).toBe(1);
    expect(result.content).toContain(
      `#EXT-X-START:TIME-OFFSET=${after},PRECISE=YES`
    );
  });
  it.each([
    '#EXT-X-DISCONTINUITY-SEQUENCE:abc',
    '#EXT-X-MEDIA-SEQUENCE:-1',
    '#EXT-X-START:TIME-OFFSET=NaN',
  ])('preserves malformed timeline state %s without throwing', (tag) => {
    const input = playlist(tag);
    expect(filterAdsFromM3U8WithStats(input)).toEqual({
      content: input,
      droppedSegments: 0,
    });
  });
  it('preserves byte ranges whose resolved end exceeds safe integer precision', () => {
    const input = playlist('').replace(
      '#EXTINF:4,\n/main-1.ts',
      '#EXTINF:4,\n#EXT-X-BYTERANGE:10@9007199254740990\n/main-1.ts'
    );
    expect(filterAdsFromM3U8WithStats(input)).toEqual({
      content: input,
      droppedSegments: 0,
    });
  });
});

it('maps negative offsets inside a removed tail to the retained end, not the beginning', () => {
  const input = [
    '#EXTM3U',
    '#EXT-X-START:TIME-OFFSET=-1',
    '#EXTINF:8,',
    '/programme.ts',
    '#EXT-X-CUE-OUT:2',
    '#EXTINF:2,',
    '/insert.ts',
    '#EXT-X-CUE-IN',
    '#EXT-X-ENDLIST',
  ].join('\n');
  const result = filterAdsFromM3U8WithStats(input);
  expect(result.droppedSegments).toBe(1);
  expect(result.content).toContain('#EXT-X-START:TIME-OFFSET=8');
});

it('does not mistake IV-like query text inside a quoted key URI for an explicit IV', () => {
  const key =
    '#EXT-X-KEY:METHOD=AES-128,URI="https://keys.example/key?x=1,IV=42"';
  const input = [
    '#EXTM3U',
    '#EXT-X-MEDIA-SEQUENCE:10',
    key,
    '#EXTINF:6,',
    '/main-1.ts',
    '#EXT-X-CUE-OUT:6',
    '#EXTINF:6,',
    '/insert.ts',
    '#EXT-X-CUE-IN',
    '#EXTINF:6,',
    '/main-2.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');
  const result = filterAdsFromM3U8WithStats(input);
  expect(result.droppedSegments).toBe(1);
  expect(result.content).toContain(
    `${key},IV=0x0000000000000000000000000000000a`
  );
  expect(result.content).toContain(
    `${key},IV=0x0000000000000000000000000000000c`
  );
});

it('preserves an explicit IV in the first key attribute without appending another IV', () => {
  const key =
    '#EXT-X-KEY:IV=0x000000000000000000000000000000ff,METHOD=AES-128,URI="key.bin"';
  const input = playlist(key);
  const result = filterAdsFromM3U8WithStats(input);
  expect(result.droppedSegments).toBe(1);
  expect(
    result.content.split('\n').filter((line) => line.startsWith('#EXT-X-KEY:'))
  ).toEqual([key]);
});
