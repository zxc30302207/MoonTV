import { isDirectM3U8Url } from './playback-url';
import { SearchResult } from './types';

export interface VideoProbeInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
}

export interface SourceProbeResult {
  source: SearchResult;
  testResult: VideoProbeInfo;
  index: number;
}

interface ProbeStats {
  maxSpeedKBps: number;
  minPing: number;
  maxPing: number;
}

export function getSourceKey(source: Pick<SearchResult, 'source' | 'id'>) {
  return `${source.source}-${source.id}`;
}

export function getSourceProbeKey(
  source: Pick<SearchResult, 'source' | 'id'>,
  episodeIndex: number
) {
  const safeEpisodeIndex =
    Number.isFinite(episodeIndex) && episodeIndex >= 0
      ? Math.floor(episodeIndex)
      : 0;
  return `${getSourceKey(source)}-ep-${safeEpisodeIndex}`;
}

export function selectEpisodeUrlForSource(
  source: Pick<SearchResult, 'episodes'>,
  episodeIndex: number
) {
  const episodes = source.episodes || [];
  if (episodes.length === 0) return '';

  const safeEpisodeIndex =
    Number.isFinite(episodeIndex) && episodeIndex >= 0
      ? Math.floor(episodeIndex)
      : 0;

  const requestedEpisode = episodes[safeEpisodeIndex];
  if (isDirectM3U8Url(requestedEpisode)) return requestedEpisode;

  return episodes.find(isDirectM3U8Url) || '';
}

export function parseLoadSpeedKBps(loadSpeed: string) {
  const match = loadSpeed.trim().match(/^([\d.]+)\s*([KM]B\/s)$/i);
  if (!match) return 0;

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 0;

  return match[2].toUpperCase() === 'MB/S' ? value * 1024 : value;
}

function qualityScore(quality: string) {
  switch (quality) {
    case '4K':
      return 100;
    case '2K':
      return 85;
    case '1080p':
      return 75;
    case '720p':
      return 60;
    case '480p':
      return 40;
    case 'SD':
      return 20;
    default:
      return 0;
  }
}

function getProbeStats(results: SourceProbeResult[]): ProbeStats {
  const validSpeeds = results
    .map((result) => parseLoadSpeedKBps(result.testResult.loadSpeed))
    .filter((speed) => speed > 0);
  const validPings = results
    .map((result) => result.testResult.pingTime)
    .filter((ping) => ping > 0);

  return {
    maxSpeedKBps: validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1,
    minPing: validPings.length > 0 ? Math.min(...validPings) : 0,
    maxPing: validPings.length > 0 ? Math.max(...validPings) : 0,
  };
}

export function scoreVideoProbeInfo(
  testResult: VideoProbeInfo,
  stats: ProbeStats
) {
  if (testResult.hasError) return -1;

  const speedKBps = parseLoadSpeedKBps(testResult.loadSpeed);
  const quality = qualityScore(testResult.quality);
  const ping = testResult.pingTime;
  const pingScore = (() => {
    if (ping <= 0) return 0;
    if (stats.maxPing <= stats.minPing) return 100;
    return Math.min(
      100,
      Math.max(
        0,
        ((stats.maxPing - ping) / (stats.maxPing - stats.minPing)) * 100
      )
    );
  })();

  if (speedKBps <= 0) {
    return Math.round((quality * 0.05 + pingScore * 0.05) * 100) / 100;
  }

  const speedScore = Math.min(
    100,
    Math.max(0, (speedKBps / Math.max(stats.maxSpeedKBps, 1)) * 100)
  );

  const score = speedScore * 0.6 + pingScore * 0.25 + quality * 0.15;
  return Math.round(score * 100) / 100;
}

export function rankSourcesByProbeResults(
  sources: SearchResult[],
  results: SourceProbeResult[]
) {
  const stats = getProbeStats(results);
  const scoreBySourceKey = new Map<string, number>();

  results.forEach((result) => {
    scoreBySourceKey.set(
      getSourceKey(result.source),
      scoreVideoProbeInfo(result.testResult, stats)
    );
  });

  return sources
    .map((source, index) => ({
      source,
      score: scoreBySourceKey.get(getSourceKey(source)) ?? -1,
      index,
    }))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.index - b.index;
    });
}
