import { parseEpisodes } from './downstream';

describe('parseEpisodes', () => {
  it('keeps m3u8 URLs with query strings and hash fragments', () => {
    const result = parseEpisodes(
      [
        'EP1$https://media.example.com/show/ep1.m3u8?token=abc',
        'EP2$https://media.example.com/show/ep2.m3u8#frag',
      ].join('#')
    );

    expect(result).toEqual({
      episodes: [
        'https://media.example.com/show/ep1.m3u8?token=abc',
        'https://media.example.com/show/ep2.m3u8#frag',
      ],
      titles: ['EP1', 'EP2'],
    });
  });

  it('rejects player and share page URLs that are not direct m3u8 streams', () => {
    const result = parseEpisodes(
      [
        'EP1$https://play.example.com/play/abc123',
        'EP2$https://v.example.com/share/def456',
      ].join('#')
    );

    expect(result).toEqual({ episodes: [], titles: [] });
  });

  it('chooses the source group with the most direct m3u8 episodes', () => {
    const result = parseEpisodes(
      [
        'web$https://play.example.com/play/abc',
        '$$$',
        'EP1$https://cdn.example.com/1.m3u8',
        '#',
        'EP2$https://cdn.example.com/2.m3u8?token=abc',
      ].join('')
    );

    expect(result).toEqual({
      episodes: [
        'https://cdn.example.com/1.m3u8',
        'https://cdn.example.com/2.m3u8?token=abc',
      ],
      titles: ['EP1', 'EP2'],
    });
  });

  it('chooses the ffzynew direct m3u8 group over the share page group', () => {
    const shareGroup = Array.from({ length: 10 }, (_, index) => {
      const episode = String(index + 1).padStart(2, '0');
      return `第${episode}集$https://vip.ffzy-online3.com/share/${episode}3f6fecc6b88ffa0b732dd682093b80`;
    }).join('#');
    const m3u8Group = Array.from({ length: 10 }, (_, index) => {
      const episode = String(index + 1).padStart(2, '0');
      return `第${episode}集$https://vip.ffzy-online3.com/20260605/45062_${episode}3f6fec/index.m3u8`;
    }).join('#');

    const result = parseEpisodes(`${shareGroup}$$$${m3u8Group}`);

    expect(result.episodes).toHaveLength(10);
    expect(result.episodes.every((url) => url.endsWith('/index.m3u8'))).toBe(
      true
    );
    expect(result.episodes.some((url) => url.includes('/share/'))).toBe(false);
    expect(result.titles).toEqual([
      '第01集',
      '第02集',
      '第03集',
      '第04集',
      '第05集',
      '第06集',
      '第07集',
      '第08集',
      '第09集',
      '第10集',
    ]);
  });

  it('extracts direct m3u8 URLs from fallback content only', () => {
    const result = parseEpisodes(
      undefined,
      [
        '<a href="https://play.example.com/play/abc">web</a>',
        '<a href="https://cdn.example.com/index.m3u8?auth=1">hls</a>',
      ].join('')
    );

    expect(result).toEqual({
      episodes: ['https://cdn.example.com/index.m3u8?auth=1'],
      titles: ['1'],
    });
  });
});
