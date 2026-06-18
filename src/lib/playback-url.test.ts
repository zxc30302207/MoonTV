import { filterDirectM3U8Episodes, isDirectM3U8Url } from './playback-url';

describe('playback URL helpers', () => {
  it('accepts direct m3u8 URLs with query strings and hash fragments', () => {
    expect(isDirectM3U8Url('https://cdn.example.com/index.m3u8?token=1')).toBe(
      true
    );
    expect(isDirectM3U8Url('https://cdn.example.com/index.m3u8#frag')).toBe(
      true
    );
  });

  it('rejects web player pages even when they are from a video host', () => {
    expect(
      isDirectM3U8Url(
        'https://vip.ffzy-online3.com/share/023f6fecc6b88ffa0b732dd682093b80'
      )
    ).toBe(false);
    expect(isDirectM3U8Url('https://play.example.com/play/abc123')).toBe(false);
  });

  it('keeps titles aligned while filtering non-m3u8 episodes', () => {
    const result = filterDirectM3U8Episodes(
      [
        'https://play.example.com/play/abc',
        'https://cdn.example.com/ep1.m3u8);',
        'https://cdn.example.com/ep2.m3u8?token=abc',
      ],
      ['web', 'EP1', 'EP2']
    );

    expect(result).toEqual({
      episodes: [
        'https://cdn.example.com/ep1.m3u8',
        'https://cdn.example.com/ep2.m3u8?token=abc',
      ],
      titles: ['EP1', 'EP2'],
      indexes: [1, 2],
    });
  });
});
