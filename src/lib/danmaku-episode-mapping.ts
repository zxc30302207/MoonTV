import type { AnimeMatch, AnimeOption } from './danmaku.client';

export interface VideoEpisodeIdentity {
  source: string;
  id: string;
  index: number;
  title: string;
}

function mappingKey(video: VideoEpisodeIdentity): string | null {
  if (
    !video.source ||
    !video.id ||
    !Number.isInteger(video.index) ||
    video.index < 0
  )
    return null;
  // Deliberately source-scoped: never assume episode offsets match across sources/seasons.
  return `danmakuEpisode:v1:${JSON.stringify([
    video.source,
    video.id,
    video.index,
    video.title,
  ])}`;
}

export function saveDanmakuEpisodeMapping(
  video: VideoEpisodeIdentity,
  anime: AnimeOption,
  episodeNumber: number,
  storage?: Storage
): void {
  const key = mappingKey(video);
  const episode = Number.isInteger(episodeNumber)
    ? anime.episodes[episodeNumber - 1]
    : undefined;
  if (
    !key ||
    !episode ||
    !Number.isSafeInteger(episode.episodeId) ||
    episode.episodeId <= 0
  )
    return;
  try {
    (storage ?? window.localStorage).setItem(
      key,
      JSON.stringify({ animeId: anime.animeId, episodeId: episode.episodeId })
    );
  } catch {
    /* Private browsing/quota must not prevent immediate manual playback. */
  }
}

export function readDanmakuEpisodeMapping(
  video: VideoEpisodeIdentity,
  anime: AnimeOption,
  storage?: Storage
): AnimeMatch | null {
  const key = mappingKey(video);
  if (!key) return null;
  try {
    const saved = JSON.parse(
      (storage ?? window.localStorage).getItem(key) || 'null'
    );
    if (!saved || saved.animeId !== anime.animeId) return null;
    const episode = anime.episodes.find(
      (item) => item.episodeId === saved.episodeId
    );
    if (!episode) return null;
    return {
      animeId: anime.animeId,
      animeTitle: anime.animeTitle,
      type: anime.type,
      typeDescription: anime.typeDescription,
      ...episode,
    };
  } catch {
    return null;
  }
}
