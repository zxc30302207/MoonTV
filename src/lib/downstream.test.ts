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
