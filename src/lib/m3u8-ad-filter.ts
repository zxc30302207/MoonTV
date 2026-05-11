type PlaylistEntry = {
  duration: number;
  group: number;
  tags: string[];
  uri: string;
  explicitAd: boolean;
  cueAd: boolean;
};

const AD_URI_PATTERN =
  /(^|[/?#&._=-])(ad|ads|adv|advert|advertise|commercial|promo|preroll|pre-roll|gg|hdgg)([/?#&._=-]|$)|\u5e7f\u544a|\u5ee3\u544a/i;

const AD_TAG_PATTERN =
  /(^|[",:=._ -])(AD|ADS|ADV|ADVERT|COMMERCIAL|CUE|PREROLL|PRE-ROLL|SCTE35|SCTE-35)([",:=._ -]|$)/;

const MAX_PREROLL_SECONDS = 90;
const MAX_PREROLL_SEGMENTS = 60;

export function filterAdsFromM3U8(content: string): string {
  if (!content || !content.trimStart().startsWith('#EXTM3U')) {
    return content || '';
  }

  if (isMasterPlaylist(content)) {
    return content;
  }

  const { entries, header, tail } = parseMediaPlaylist(content);
  if (entries.length === 0) {
    return content;
  }

  const dropGroups = getPrerollGroupsToDrop(entries);
  const result: string[] = [...header];
  let droppedBeforeNextEntry = false;

  for (const entry of entries) {
    const shouldDrop =
      entry.explicitAd || entry.cueAd || dropGroups.has(entry.group);

    if (shouldDrop) {
      droppedBeforeNextEntry = true;
      continue;
    }

    const tags = droppedBeforeNextEntry
      ? entry.tags.filter((tag) => !isDiscontinuityTag(tag))
      : entry.tags;

    result.push(...tags.filter((tag) => !isAdControlTag(tag)));
    result.push(entry.uri);
    droppedBeforeNextEntry = false;
  }

  result.push(...tail.filter((line) => !isAdControlTag(line)));

  return result.join('\n');
}

function parseMediaPlaylist(content: string): {
  entries: PlaylistEntry[];
  header: string[];
  tail: string[];
} {
  const lines = content.split(/\r?\n/);
  const entries: PlaylistEntry[] = [];
  const header: string[] = [];
  let pendingTags: string[] = [];
  let currentGroup = 0;
  let cueAd = false;
  let nextSegmentCueAd = false;
  let hasSeenSegmentScopedTag = false;
  let hasSeenSegment = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (!line.startsWith('#')) {
      entries.push({
        duration: getPendingDuration(pendingTags),
        group: currentGroup,
        tags: pendingTags,
        uri: rawLine,
        explicitAd: isAdSegmentUri(line) || pendingTags.some(isAdMarkerTag),
        cueAd: cueAd || nextSegmentCueAd,
      });
      pendingTags = [];
      nextSegmentCueAd = false;
      hasSeenSegment = true;
      continue;
    }

    if (isCueOutTag(line)) {
      cueAd = true;
      nextSegmentCueAd = true;
      continue;
    }

    if (isCueInTag(line)) {
      cueAd = false;
      nextSegmentCueAd = false;
      continue;
    }

    if (isAdMarkerTag(line)) {
      nextSegmentCueAd = true;
      continue;
    }

    if (isDiscontinuityTag(line)) {
      if (hasSeenSegment || pendingTags.length > 0) {
        currentGroup += 1;
      }
      pendingTags.push(rawLine);
      hasSeenSegmentScopedTag = true;
      continue;
    }

    if (
      !hasSeenSegment &&
      !hasSeenSegmentScopedTag &&
      !isSegmentScopedTag(line)
    ) {
      header.push(rawLine);
      continue;
    }

    pendingTags.push(rawLine);
    if (isSegmentScopedTag(line)) {
      hasSeenSegmentScopedTag = true;
    }
  }

  return {
    entries,
    header,
    tail: pendingTags,
  };
}

function getPrerollGroupsToDrop(entries: PlaylistEntry[]): Set<number> {
  const groups = new Map<number, PlaylistEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.group) || [];
    group.push(entry);
    groups.set(entry.group, group);
  }

  const groupNumbers = Array.from(groups.keys()).sort((a, b) => a - b);
  if (groupNumbers.length < 2 || groupNumbers[0] !== 0) {
    return new Set();
  }

  const firstGroup = groups.get(0) || [];
  const restGroups = groupNumbers
    .slice(1)
    .flatMap((groupNumber) => groups.get(groupNumber) || []);

  const firstDuration = sumDurations(firstGroup);
  const restDuration = sumDurations(restGroups);
  const hasExplicitAd = firstGroup.some(
    (entry) => entry.explicitAd || entry.cueAd
  );

  const looksLikeShortPreroll =
    firstGroup.length > 0 &&
    firstGroup.length <= MAX_PREROLL_SEGMENTS &&
    firstDuration > 0 &&
    firstDuration <= MAX_PREROLL_SECONDS &&
    restGroups.length >= firstGroup.length * 3 &&
    restDuration >= firstDuration * 3;

  return hasExplicitAd || looksLikeShortPreroll ? new Set([0]) : new Set();
}

function isMasterPlaylist(content: string): boolean {
  return /^#EXT-X-STREAM-INF:/m.test(content);
}

function isAdSegmentUri(uri: string): boolean {
  return AD_URI_PATTERN.test(normalizeUrlLikeValue(uri));
}

function isCueOutTag(line: string): boolean {
  const upper = line.toUpperCase();
  return (
    upper.startsWith('#EXT-X-CUE-OUT') ||
    upper.startsWith('#EXT-OATCLS-SCTE35') ||
    upper.startsWith('#EXT-X-SCTE35')
  );
}

function isCueInTag(line: string): boolean {
  return line.toUpperCase().startsWith('#EXT-X-CUE-IN');
}

function isAdMarkerTag(line: string): boolean {
  const upper = line.toUpperCase();
  return (
    isCueOutTag(upper) ||
    (upper.startsWith('#EXT-X-DATERANGE') && AD_TAG_PATTERN.test(upper))
  );
}

function isAdControlTag(line: string): boolean {
  return isCueOutTag(line) || isCueInTag(line) || isAdMarkerTag(line);
}

function isDiscontinuityTag(line: string): boolean {
  return line.trim().toUpperCase() === '#EXT-X-DISCONTINUITY';
}

function isSegmentScopedTag(line: string): boolean {
  const upper = line.toUpperCase();
  return (
    upper.startsWith('#EXTINF:') ||
    upper.startsWith('#EXT-X-BYTERANGE') ||
    upper.startsWith('#EXT-X-KEY') ||
    upper.startsWith('#EXT-X-MAP') ||
    upper.startsWith('#EXT-X-PROGRAM-DATE-TIME') ||
    upper.startsWith('#EXT-X-PART') ||
    upper.startsWith('#EXT-X-PRELOAD-HINT') ||
    isDiscontinuityTag(upper)
  );
}

function getPendingDuration(tags: string[]): number {
  const extinf = [...tags]
    .reverse()
    .find((tag) => tag.trim().startsWith('#EXTINF:'));
  if (!extinf) return 0;

  const match = extinf.match(/^#EXTINF:([0-9.]+)/);
  return match ? Number.parseFloat(match[1]) || 0 : 0;
}

function sumDurations(entries: PlaylistEntry[]): number {
  return entries.reduce((total, entry) => total + entry.duration, 0);
}

function normalizeUrlLikeValue(value: string): string {
  try {
    return decodeURIComponent(value).toLowerCase();
  } catch (_) {
    return value.toLowerCase();
  }
}
