import {
  buildExternalPlayerUrl,
  EXTERNAL_PLAYERS,
  getPlayableUrl,
} from './external-player';

describe('external-player', () => {
  const mediaUrl =
    'https://example.com/影片/index.m3u8?token=a b&quality=1080p';

  it('lists the supported players', () => {
    expect(EXTERNAL_PLAYERS.map((player) => player.id)).toEqual([
      'potplayer',
      'vlc',
      'mpv',
      'mx-player',
      'nplayer',
      'iina',
    ]);
  });

  it('rejects empty URLs', () => {
    expect(getPlayableUrl('   ')).toBeNull();
    expect(buildExternalPlayerUrl('vlc', '   ')).toBeNull();
  });

  it('builds desktop player schemes without mutating the media URL', () => {
    expect(buildExternalPlayerUrl('potplayer', mediaUrl)).toBe(
      `potplayer://${mediaUrl}`
    );
    expect(buildExternalPlayerUrl('vlc', mediaUrl)).toBe(`vlc://${mediaUrl}`);
    expect(buildExternalPlayerUrl('mpv', mediaUrl)).toBe(`mpv://${mediaUrl}`);
  });

  it('builds mobile/mac player schemes with encoded fields', () => {
    expect(buildExternalPlayerUrl('nplayer', mediaUrl)).toBe(
      `nplayer-${mediaUrl}`
    );
    expect(buildExternalPlayerUrl('iina', mediaUrl)).toBe(
      `iina://weblink?url=${encodeURIComponent(mediaUrl)}`
    );
    expect(buildExternalPlayerUrl('mx-player', mediaUrl, '測試 01')).toBe(
      `intent://example.com/${encodeURIComponent(
        '影片'
      )}/index.m3u8?token=a%20b&quality=1080p#Intent;scheme=https;package=com.mxtech.videoplayer.ad;S.title=${encodeURIComponent(
        '測試 01'
      )};end`
    );
  });
});
