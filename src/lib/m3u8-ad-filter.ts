type PlaylistEntry = {
  duration: number;
  group: number;
  tags: string[];
  uri: string;
  explicitAd: boolean;
  cueAd: boolean;
};

type PlaylistGroupInfo = {
  groupNumber: number;
  entries: PlaylistEntry[];
  duration: number;
  segmentCount: number;
  signature: string;
};

export type M3U8AdFilterResult = {
  content: string;
  droppedSegments: number;
};

const AD_URI_PATTERN =
  /(^|[/?#&._=-])(ad|ads|adv|adver|advert|advertise|advertisement|adbreak|adinsert|adseg|commercial|doubleclick|googleads|promo|preroll|pre-roll|sponsor|vast|vmap|gg|hdgg|iqiyiad|youkuad)([/?#&._=-]|$)|\u5e7f\u544a|\u5ee3\u544a/i;

const AD_TAG_PATTERN =
  /(^|[",:=._ -])(AD|ADS|ADV|ADVERT|ADVERTISEMENT|ASSET|COMMERCIAL|CUE|INTERSTITIAL|PREROLL|PRE-ROLL|SCTE35|SCTE-35|SPLICE|VAST|VMAP)([",:=._ -]|$)/;

const NON_MEDIA_SEGMENT_PATTERN = /\.(?:gif|jpe?g|png|webp)(?:[?#].*)?$/i;

const MAX_PREROLL_SECONDS = 90;
const MAX_PREROLL_SEGMENTS = 60;
const MAX_INSERTED_AD_SECONDS = 45;
const MAX_INSERTED_AD_SEGMENTS = 20;
const MIN_RECURRING_AD_GROUPS = 2;

export function filterAdsFromM3U8(content: string): string {
  return filterAdsFromM3U8WithStats(content).content;
}

export function filterAdsFromM3U8WithStats(
  content: string
): M3U8AdFilterResult {
  if (!content || !content.trimStart().startsWith('#EXTM3U')) {
    return { content: content || '', droppedSegments: 0 };
  }

  if (isMasterPlaylist(content)) {
    return { content, droppedSegments: 0 };
  }

  const { entries, header, tail } = parseMediaPlaylist(content);
  if (entries.length === 0) {
    return { content, droppedSegments: 0 };
  }

  const dropGroups = getPrerollGroupsToDrop(entries);
  for (const group of Array.from(getRecurringInsertedAdGroupsToDrop(entries))) {
    dropGroups.add(group);
  }
  const result: string[] = [...header];
  let droppedBeforeNextEntry = false;
  let droppedSegments = 0;
  let hasKeptSegment = false;

  for (const entry of entries) {
    const shouldDrop =
      entry.explicitAd || entry.cueAd || dropGroups.has(entry.group);

    if (shouldDrop) {
      droppedSegments += 1;
      droppedBeforeNextEntry = true;
      continue;
    }

    const shouldRemoveLeadingDiscontinuity =
      droppedBeforeNextEntry && !hasKeptSegment;
    const tags = shouldRemoveLeadingDiscontinuity
      ? entry.tags.filter((tag) => !isDiscontinuityTag(tag))
      : entry.tags;

    result.push(...tags.filter((tag) => !isAdControlTag(tag)));
    result.push(entry.uri);
    droppedBeforeNextEntry = false;
    hasKeptSegment = true;
  }

  result.push(...tail.filter((line) => !isAdControlTag(line)));

  return {
    content: result.join('\n'),
    droppedSegments,
  };
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
  const groups = groupEntriesByDiscontinuity(entries);

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
  const firstSignature = getDominantPathSignature(firstGroup);
  const restSignature = getDominantPathSignature(restGroups);

  const looksLikeShortPreroll =
    firstGroup.length > 0 &&
    firstGroup.length <= MAX_PREROLL_SEGMENTS &&
    firstDuration > 0 &&
    firstDuration <= MAX_PREROLL_SECONDS &&
    firstSignature !== '' &&
    restSignature !== '' &&
    firstSignature !== restSignature &&
    restGroups.length >= firstGroup.length * 3 &&
    restDuration >= firstDuration * 3;

  return hasExplicitAd || looksLikeShortPreroll ? new Set([0]) : new Set();
}

function getRecurringInsertedAdGroupsToDrop(
  entries: PlaylistEntry[]
): Set<number> {
  const groups = groupEntriesByDiscontinuity(entries);
  const groupInfos: PlaylistGroupInfo[] = Array.from(groups.entries())
    .map(([groupNumber, groupEntries]) => ({
      groupNumber,
      entries: groupEntries,
      duration: sumDurations(groupEntries),
      segmentCount: groupEntries.length,
      signature: getDominantPathSignature(groupEntries),
    }))
    .filter((info) => info.entries.length > 0 && info.signature);

  if (groupInfos.length < 3) {
    return new Set();
  }

  const signatureDurations = new Map<string, number>();
  for (const info of groupInfos) {
    signatureDurations.set(
      info.signature,
      (signatureDurations.get(info.signature) || 0) + info.duration
    );
  }

  const primarySignature = Array.from(signatureDurations.entries()).sort(
    (a, b) => b[1] - a[1]
  )[0]?.[0];
  if (!primarySignature) {
    return new Set();
  }
  const primaryDuration = signatureDurations.get(primarySignature) || 0;

  const infosBySignature = new Map<string, PlaylistGroupInfo[]>();
  for (const info of groupInfos) {
    const list = infosBySignature.get(info.signature) || [];
    list.push(info);
    infosBySignature.set(info.signature, list);
  }

  const dropGroups = new Set<number>();
  for (const [signature, infos] of Array.from(infosBySignature.entries())) {
    if (signature === primarySignature) continue;

    const signatureDuration = signatureDurations.get(signature) || 0;
    const isMinorInsertedTrack =
      primaryDuration > 0 && signatureDuration <= primaryDuration * 0.35;
    const allGroupsAreShort = infos.every(
      (info) =>
        info.segmentCount <= MAX_INSERTED_AD_SEGMENTS &&
        info.duration > 0 &&
        info.duration <= MAX_INSERTED_AD_SECONDS
    );
    if (
      !isMinorInsertedTrack ||
      !allGroupsAreShort ||
      infos.length < MIN_RECURRING_AD_GROUPS
    ) {
      continue;
    }

    for (const info of infos) {
      dropGroups.add(info.groupNumber);
    }
  }

  return dropGroups;
}

function groupEntriesByDiscontinuity(
  entries: PlaylistEntry[]
): Map<number, PlaylistEntry[]> {
  const groups = new Map<number, PlaylistEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.group) || [];
    group.push(entry);
    groups.set(entry.group, group);
  }
  return groups;
}

function isMasterPlaylist(content: string): boolean {
  return /^#EXT-X-STREAM-INF:/m.test(content);
}

function isAdSegmentUri(uri: string): boolean {
  const normalized = normalizeUrlLikeValue(uri);
  return AD_URI_PATTERN.test(normalized) || NON_MEDIA_SEGMENT_PATTERN.test(uri);
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
    upper.startsWith('#EXT-X-ASSET') ||
    upper.startsWith('#EXT-X-VMAP') ||
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

function getDominantPathSignature(entries: PlaylistEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const signature = getPathSignature(entry.uri);
    if (!signature) continue;
    counts.set(signature, (counts.get(signature) || 0) + 1);
  }

  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function getPathSignature(uri: string): string {
  const normalized = normalizeUrlLikeValue(uri.trim()).split(/[?#]/)[0];
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex < 0) return '';
  return normalized.slice(0, slashIndex + 1);
}

function normalizeUrlLikeValue(value: string): string {
  try {
    return decodeURIComponent(value).toLowerCase();
  } catch (_) {
    return value.toLowerCase();
  }
}
