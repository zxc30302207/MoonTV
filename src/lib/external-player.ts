export type ExternalPlayerId =
  | 'potplayer'
  | 'vlc'
  | 'mpv'
  | 'mx-player'
  | 'nplayer'
  | 'iina';

export interface ExternalPlayer {
  id: ExternalPlayerId;
  label: string;
}

export const EXTERNAL_PLAYERS: ExternalPlayer[] = [
  { id: 'potplayer', label: 'PotPlayer' },
  { id: 'vlc', label: 'VLC' },
  { id: 'mpv', label: 'MPV' },
  { id: 'mx-player', label: 'MX Player' },
  { id: 'nplayer', label: 'nPlayer' },
  { id: 'iina', label: 'IINA' },
];

export function getPlayableUrl(mediaUrl: string): string | null {
  const trimmed = mediaUrl.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildExternalPlayerUrl(
  playerId: ExternalPlayerId,
  mediaUrl: string,
  title = ''
): string | null {
  const playableUrl = getPlayableUrl(mediaUrl);
  if (!playableUrl) return null;

  switch (playerId) {
    case 'potplayer':
      return `potplayer://${playableUrl}`;
    case 'vlc':
      return `vlc://${playableUrl}`;
    case 'mpv':
      return `mpv://${playableUrl}`;
    case 'mx-player':
      return buildMxPlayerIntentUrl(playableUrl, title);
    case 'nplayer':
      return `nplayer-${playableUrl}`;
    case 'iina':
      return `iina://weblink?url=${encodeURIComponent(playableUrl)}`;
    default:
      return null;
  }
}

function buildMxPlayerIntentUrl(mediaUrl: string, title: string): string {
  const parsed = tryParseHttpUrl(mediaUrl);
  const encodedTitle = encodeURIComponent(title || 'MoonTV');

  if (!parsed) {
    return `intent://${mediaUrl}#Intent;package=com.mxtech.videoplayer.ad;S.title=${encodedTitle};end`;
  }

  const pathWithQuery = `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  return `intent://${pathWithQuery}#Intent;scheme=${parsed.protocol.replace(
    ':',
    ''
  )};package=com.mxtech.videoplayer.ad;S.title=${encodedTitle};end`;
}

function tryParseHttpUrl(mediaUrl: string): URL | null {
  try {
    const parsed = new URL(mediaUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed;
    }
  } catch (_) {
    return null;
  }

  return null;
}
