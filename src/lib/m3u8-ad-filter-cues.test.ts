import { filterAdsFromM3U8WithStats } from './m3u8-ad-filter';

const segment = (name: string, duration = 2) =>
  `#EXTINF:${duration},\n/${name}.ts`;
const vod = (...lines: string[]) =>
  ['#EXTM3U', '#EXT-X-TARGETDURATION:10', ...lines, '#EXT-X-ENDLIST'].join(
    '\n'
  );

describe('source-independent ad cue parsing', () => {
  it.each(['DURATION="4"', 'ID="break,one",DURATION=4', '4'])(
    'removes an explicitly bounded cue with %s',
    (attributes) => {
      const result = filterAdsFromM3U8WithStats(
        vod(
          `#EXT-X-CUE-OUT:${attributes}`,
          segment('insert-1'),
          segment('insert-2'),
          '#EXT-X-CUE-IN',
          segment('programme', 10)
        )
      );
      expect(result.droppedSegments).toBe(2);
      expect(result.droppedDuration).toBe(4);
      expect(result.content).toContain('/programme.ts');
    }
  );

  it.each(['ElapsedTime=2,Duration=6', '2/6'])(
    'recognizes a clipped VOD beginning with %s',
    (continuation) => {
      const result = filterAdsFromM3U8WithStats(
        vod(
          `#EXT-X-CUE-OUT-CONT:${continuation}`,
          segment('insert-1'),
          '#EXT-X-CUE-OUT-CONT:ElapsedTime=4,Duration=6',
          segment('insert-2'),
          '#EXT-X-CUE-IN',
          segment('programme', 10)
        )
      );
      expect(result.droppedSegments).toBe(2);
      expect(result.content).not.toContain('CUE-OUT-CONT');
      expect(result.content).toContain('/programme.ts');
    }
  );

  it('checks continuation metadata against the actual segment timeline', () => {
    const input = vod(
      '#EXT-X-CUE-OUT:6',
      segment('scene-1'),
      '#EXT-X-CUE-OUT-CONT:ElapsedTime=5,Duration=6',
      segment('scene-2'),
      '#EXT-X-CUE-IN',
      segment('programme', 10)
    );
    expect(filterAdsFromM3U8WithStats(input)).toEqual({
      content: input,
      droppedSegments: 0,
    });
  });

  it.each(['-2', '0', '2garbage', 'DURATION=garbage', 'DURATION=2,DURATION=4'])(
    'does not turn malformed duration %s into an unbounded cue',
    (value) => {
      const input = vod(
        `#EXT-X-CUE-OUT:${value}`,
        segment('scene-1'),
        segment('scene-2'),
        '#EXT-X-CUE-IN',
        segment('programme', 10)
      );
      expect(filterAdsFromM3U8WithStats(input)).toEqual({
        content: input,
        droppedSegments: 0,
      });
    }
  );

  it('does not consume programme content between nested cue-out markers', () => {
    const input = vod(
      '#EXT-X-CUE-OUT',
      segment('scene-1'),
      '#EXT-X-CUE-OUT:2',
      segment('scene-2'),
      '#EXT-X-CUE-IN',
      segment('programme', 10)
    );
    expect(filterAdsFromM3U8WithStats(input)).toEqual({
      content: input,
      droppedSegments: 0,
    });
  });

  it('never removes a segment containing both break and programme time', () => {
    const result = filterAdsFromM3U8WithStats(
      vod(
        '#EXT-X-CUE-OUT:3',
        segment('insert-1'),
        segment('mixed', 4),
        '#EXT-X-CUE-IN',
        segment('programme', 10)
      )
    );
    expect(result.content).toContain('/mixed.ts');
    expect(result.content).toContain('/programme.ts');
  });

  it('leaves raw SCTE-35 and asset metadata alone without validated cue boundaries', () => {
    const input = vod(
      '#EXT-OATCLS-SCTE35:AAAA',
      '#EXT-X-ASSET:CAID="ad"',
      segment('scene-1'),
      segment('programme', 10)
    );
    expect(filterAdsFromM3U8WithStats(input)).toEqual({
      content: input,
      droppedSegments: 0,
    });
  });

  it('does not treat a live continuation as a safely editable VOD timeline', () => {
    const input = vod(
      '#EXT-X-CUE-OUT-CONT:ElapsedTime=2,Duration=6',
      segment('insert'),
      segment('programme', 10)
    ).replace('\n#EXT-X-ENDLIST', '');
    expect(filterAdsFromM3U8WithStats(input)).toEqual({
      content: input,
      droppedSegments: 0,
    });
  });
});

it('removes only the confirmed break across arbitrary hosts, paths, and query strings', () => {
  for (let index = 0; index < 50; index += 1) {
    const uri = `https://cdn-${index}.example/ordinary-${index}.m4s?token=ad${index}`;
    const input = vod(
      segment('programme-before', 10),
      '#EXT-X-CUE-OUT:4',
      '#EXTINF:2,',
      uri,
      '#EXT-X-CUE-OUT-CONT:2/4',
      '#EXTINF:2,',
      `relative-${index}.ts`,
      '#EXT-X-CUE-IN',
      segment('programme-after', 10)
    );
    const result = filterAdsFromM3U8WithStats(input);
    expect(result.droppedSegments).toBe(2);
    expect(result.content).not.toContain(uri);
    expect(result.content).toContain('/programme-before.ts');
    expect(result.content).toContain('/programme-after.ts');
    expect(filterAdsFromM3U8WithStats(result.content).content).toBe(
      result.content
    );
  }
});

it('rolls back a completed cue contradicted by boundary continuation metadata', () => {
  const input = vod(
    '#EXT-X-CUE-OUT:4',
    segment('ambiguous', 4),
    '#EXT-X-CUE-OUT-CONT:ElapsedTime=4,Duration=8',
    segment('scene', 4),
    '#EXT-X-CUE-IN',
    segment('programme', 10)
  );
  expect(filterAdsFromM3U8WithStats(input)).toEqual({
    content: input,
    droppedSegments: 0,
  });

  const independent = input.replace(
    '#EXT-X-ENDLIST',
    '#EXT-X-CUE-OUT:2\n#EXTINF:2,\n/confirmed.ts\n#EXT-X-CUE-IN\n#EXT-X-ENDLIST'
  );
  const result = filterAdsFromM3U8WithStats(independent);
  expect(result.droppedSegments).toBe(1);
  expect(result.content).toContain('/ambiguous.ts');
  expect(result.content).toContain('/scene.ts');
  expect(result.content).not.toContain('/confirmed.ts');
});

it.each([
  ['#EXT-X-CUE-OUT', '#EXTINF:6,', '#EXT-X-CUE-IN:garbage'],
  ['#EXT-X-CUE-OUT:6', '#EXTINF:6,', '#EXT-X-CUE-OUT-CONT'],
  ['#EXT-X-CUE-OUT:6', '#EXTINF:6garbage,', '#EXT-X-CUE-IN'],
  ['#EXT-X-CUE-OUT:6', '#EXTINF:6.0.0,', '#EXT-X-CUE-IN'],
])(
  'preserves malformed cue or segment syntax (%s, %s, %s)',
  (out, duration, end) => {
    const input = vod(
      out,
      duration,
      '/ambiguous.ts',
      end,
      segment('programme', 10)
    );
    expect(filterAdsFromM3U8WithStats(input)).toEqual({
      content: input,
      droppedSegments: 0,
    });
  }
);
