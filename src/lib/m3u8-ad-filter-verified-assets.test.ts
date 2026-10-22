import { filterAdsFromM3U8WithStats } from './m3u8-ad-filter';

// Bounded public-source samples visually verified 2026-10-22; see evidence notes.
describe.each([
  {
    prefix: '/20261009/Bjf6z0RU/10152kb/hls/',
    files: [
      '6JFnQsqe.ts',
      'WfGR4xIS.ts',
      'KMplaxXV.ts',
      '0ONtLMnT.ts',
      'auT4G7cp.ts',
      'j2XNBmNk.ts',
    ],
    durations: [3, 3, 5, 3, 3, 0.64],
    removedSeconds: 35.28,
    afterIv: '11',
  },
  {
    prefix: '/20261008/2DExGZYA/hls/',
    files: ['wTYCABLc.ts', 'HJKFKNWX.ts', 'tem9H9Vu.ts', 'Y2VXzNPO.ts'],
    durations: [5, 5, 5, 2.567],
    removedSeconds: 35.134,
    afterIv: '0f',
  },
])(
  'verified asset $prefix',
  ({ prefix, files, durations, removedSeconds, afterIv }) => {
    const sequence = (paths = files, times = durations, base = prefix) =>
      paths.flatMap((file, index) => [
        `#EXTINF:${times[index]},`,
        `${base}${file}`,
      ]);
    const media = (name: string) => ['#EXTINF:2.125,', `/programme/${name}.ts`];
    const vod = (lines: string[]) =>
      ['#EXTM3U', '#EXT-X-TARGETDURATION:5', ...lines, '#EXT-X-ENDLIST'].join(
        '\n'
      );

    test('removes two verified rotated-asset breaks but retains both adjacent programme boundaries', () => {
      const input = vod([
        ...media('before'),
        '#EXT-X-DISCONTINUITY',
        '#EXT-X-KEY:METHOD=NONE',
        ...sequence(),
        '#EXT-X-DISCONTINUITY',
        ...media('after'),
        ...media('tail-credits'),
        '#EXT-X-DISCONTINUITY',
        '#EXT-X-KEY:METHOD=NONE',
        ...sequence(),
      ]);
      const result = filterAdsFromM3U8WithStats(input);
      expect(result.droppedSegments).toBe(files.length * 2);
      expect(result.droppedDuration).toBe(removedSeconds);
      for (const name of ['before', 'after', 'tail-credits'])
        expect(result.content).toContain(`/programme/${name}.ts`);
      expect(result.content).not.toContain(prefix);
      expect(result.content).toContain('#EXT-X-KEY:METHOD=NONE');
      expect(result.content.endsWith('#EXT-X-ENDLIST')).toBe(true);
      expect(filterAdsFromM3U8WithStats(result.content).content).toBe(
        result.content
      );
    });

    test('matches the complete verified asset through rotated CDN hosts and query strings', () => {
      const lines = sequence().map((line) =>
        line.startsWith('#')
          ? line
          : `https://rotated.example${line}?expires=123&token=example`
      );
      expect(
        filterAdsFromM3U8WithStats(
          vod([...media('before'), ...lines, ...media('after')])
        ).droppedSegments
      ).toBe(files.length);
    });

    test.each([
      ['incomplete', sequence(files.slice(0, -1))],
      ['reordered', sequence([files[1], files[0], ...files.slice(2)])],
      ['unknown filename', sequence([...files.slice(0, -1), 'programme.ts'])],
      [
        'same durations different path',
        sequence(files, durations, '/programme/'),
      ],
      ['duration mismatch', sequence(files, [3.1, ...durations.slice(1)])],
    ])('preserves the entire playlist for %s', (_name, lines) => {
      const input = vod([
        ...media('before'),
        ...(lines as string[]),
        ...media('after'),
      ]);
      expect(filterAdsFromM3U8WithStats(input)).toEqual({
        content: input,
        droppedSegments: 0,
      });
    });

    test('does not empty a playlist containing only the verified advertisement', () => {
      const input = vod(sequence());
      expect(filterAdsFromM3U8WithStats(input)).toEqual({
        content: input,
        droppedSegments: 0,
      });
    });

    test('carries encrypted init state through verified-asset removal without changing programme IV numbering', () => {
      const input = vod([
        '#EXT-X-MEDIA-SEQUENCE:10',
        '#EXT-X-KEY:METHOD=AES-128,URI="main.key"',
        ...media('before'),
        '#EXT-X-MAP:URI="new-init.mp4"',
        ...sequence(),
        ...media('after'),
      ]);
      const result = filterAdsFromM3U8WithStats(input);
      expect(result.droppedSegments).toBe(files.length);
      expect(result.content).toContain('#EXT-X-MAP:URI="new-init.mp4"');
      expect(result.content).toContain(`IV=0x${afterIv.padStart(32, '0')}`);
      expect(result.content).toContain('/programme/after.ts');
    });
  }
);
