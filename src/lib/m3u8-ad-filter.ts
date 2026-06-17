type DropReason =
  | 'cue'
  | 'explicit-tag'
  | 'explicit-uri'
  | 'non-media'
  | 'preroll'
  | 'recurring-group'
  | 'recurring-run';

type PlaylistEntry = {
  cueAd: boolean;
  duration: number;
  explicitAd: boolean;
  group: number;
  index: number;
  reasons: Set<DropReason>;
  signature: string;
  tags: string[];
  uri: string;
};

type PlaylistGroupInfo = {
  duration: number;
  entries: PlaylistEntry[];
  groupNumber: number;
  segmentCount: number;
  signature: string;
};

type ParsedMediaPlaylist = {
  entries: PlaylistEntry[];
  header: string[];
  tail: string[];
};

type SegmentRun = {
  duration: number;
  endIndex: number;
  segmentCount: number;
  signature: string;
  startIndex: number;
};

export type M3U8AdFilterResult = {
  content: string;
  droppedSegments: number;
};

const STRONG_AD_TOKENS = new Set([
  'ad',
  'ads',
  'adv',
  'adver',
  'advert',
  'advertise',
  'advertisement',
  'adbreak',
  'adinsert',
  'adseg',
  'commercial',
  'doubleclick',
  'googleads',
  'gg',
  'hdgg',
  'iqiyiad',
  'pre-roll',
  'preroll',
  'promo',
  'sponsor',
  'vast',
  'vmap',
  'youkuad',
]);

const AD_TAG_PATTERN =
  /(^|[",:=._ -])(AD|ADS|ADV|ADVERT|ADVERTISEMENT|ASSET|COMMERCIAL|CUE|INTERSTITIAL|PREROLL|PRE-ROLL|SCTE35|SCTE-35|SPLICE|VAST|VMAP)([",:=._ -]|$)|\u5e7f\u544a|\u5ee3\u544a/;

const NON_MEDIA_SEGMENT_PATTERN = /\.(?:gif|jpe?g|png|webp|html?)(?:[?#].*)?$/i;

const MAX_PREROLL_SECONDS = 90;
const MAX_PREROLL_SEGMENTS = 60;
const MAX_INSERTED_AD_SECONDS = 45;
const MAX_INSERTED_AD_SEGMENTS = 20;
const MIN_RECURRING_AD_GROUPS = 2;
const MAX_STRUCTURAL_DROP_RATIO = 0.35;

const STRUCTURAL_REASONS = new Set<DropReason>([
  'preroll',
  'recurring-group',
  'recurring-run',
]);

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

  const parsed = parseMediaPlaylist(content);
  if (parsed.entries.length === 0) {
    return { content, droppedSegments: 0 };
  }

  const dropPlan = buildDropPlan(parsed.entries);

  return rebuildPlaylist(parsed, dropPlan);
}

function parseMediaPlaylist(content: string): ParsedMediaPlaylist {
  const lines = content.split(/\r?\n/);
  const entries: PlaylistEntry[] = [];
  const header: string[] = [];
  let currentGroup = 0;
  let hasSeenSegment = false;
  let inCueAd = false;
  let nextSegmentCueAd = false;
  let pendingTags: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (!line.startsWith('#')) {
      const tags = pendingTags;
      const uriAdReason = getExplicitUriAdReason(line);
      const tagAdReason = tags.some(isSegmentAdMarkerTag)
        ? 'explicit-tag'
        : null;
      const cueAd = inCueAd || nextSegmentCueAd;
      const explicitAd = Boolean(uriAdReason || tagAdReason);
      const reasons = new Set<DropReason>();

      if (cueAd) reasons.add('cue');
      if (uriAdReason) reasons.add(uriAdReason);
      if (tagAdReason) reasons.add(tagAdReason);

      entries.push({
        cueAd,
        duration: getPendingDuration(tags),
        explicitAd,
        group: currentGroup,
        index: entries.length,
        reasons,
        signature: getPathSignature(line),
        tags,
        uri: rawLine,
      });

      pendingTags = [];
      nextSegmentCueAd = false;
      hasSeenSegment = true;
      continue;
    }

    if (isCueOutTag(line)) {
      inCueAd = true;
      nextSegmentCueAd = true;
      continue;
    }

    if (isCueInTag(line)) {
      inCueAd = false;
      nextSegmentCueAd = false;
      continue;
    }

    if (isAdControlOrMetadataTag(line)) {
      if (isSegmentAdMarkerTag(line)) {
        nextSegmentCueAd = true;
      }
      continue;
    }

    if (
      !hasSeenSegment &&
      pendingTags.length === 0 &&
      !isSegmentScopedTag(line)
    ) {
      header.push(rawLine);
      continue;
    }

    if (isDiscontinuityTag(line)) {
      if (hasSeenSegment || pendingTags.length > 0) {
        currentGroup += 1;
      }
      pendingTags.push(rawLine);
      continue;
    }

    pendingTags.push(rawLine);
  }

  return {
    entries,
    header,
    tail: pendingTags,
  };
}

function buildDropPlan(entries: PlaylistEntry[]): Map<number, Set<DropReason>> {
  const candidates = new Map<number, Set<DropReason>>();

  for (const entry of entries) {
    for (const reason of Array.from(entry.reasons)) {
      addDropReason(candidates, entry.index, reason);
    }
  }

  for (const group of Array.from(getPrerollGroupsToDrop(entries))) {
    for (const entry of entries) {
      if (entry.group === group) {
        addDropReason(candidates, entry.index, 'preroll');
      }
    }
  }

  for (const group of Array.from(getRecurringInsertedAdGroupsToDrop(entries))) {
    for (const entry of entries) {
      if (entry.group === group) {
        addDropReason(candidates, entry.index, 'recurring-group');
      }
    }
  }

  for (const index of Array.from(getRecurringInlineAdSegmentsToDrop(entries))) {
    addDropReason(candidates, index, 'recurring-run');
  }

  return applyDropSafety(entries, candidates);
}

function addDropReason(
  candidates: Map<number, Set<DropReason>>,
  index: number,
  reason: DropReason
) {
  const reasons = candidates.get(index) || new Set<DropReason>();
  reasons.add(reason);
  candidates.set(index, reasons);
}

function applyDropSafety(
  entries: PlaylistEntry[],
  candidates: Map<number, Set<DropReason>>
): Map<number, Set<DropReason>> {
  candidates = removeDominantUriOnlyCandidates(entries, candidates);
  if (candidates.size === 0) return candidates;

  const explicitCandidates = new Map<number, Set<DropReason>>();
  const structuralCandidates = new Map<number, Set<DropReason>>();

  for (const [index, reasons] of Array.from(candidates.entries())) {
    if (Array.from(reasons).some((reason) => STRUCTURAL_REASONS.has(reason))) {
      structuralCandidates.set(index, reasons);
    }
    if (Array.from(reasons).some((reason) => !STRUCTURAL_REASONS.has(reason))) {
      explicitCandidates.set(index, reasons);
    }
  }

  if (
    structuralCandidates.size > 0 &&
    isStructurallySafeDrop(entries, candidates)
  ) {
    return isSafeRemainingPlaylist(entries, candidates)
      ? candidates
      : explicitCandidates;
  }

  return isSafeRemainingPlaylist(entries, explicitCandidates)
    ? explicitCandidates
    : new Map();
}

function removeDominantUriOnlyCandidates(
  entries: PlaylistEntry[],
  candidates: Map<number, Set<DropReason>>
): Map<number, Set<DropReason>> {
  const totalDuration = sumDurations(entries);
  if (totalDuration <= 0) return candidates;

  const candidateDurationBySignature = new Map<string, number>();
  for (const [index, reasons] of Array.from(candidates.entries())) {
    if (!isUriOnlyCandidate(reasons)) continue;
    const entry = entries[index];
    if (!entry?.signature) continue;
    candidateDurationBySignature.set(
      entry.signature,
      (candidateDurationBySignature.get(entry.signature) || 0) + entry.duration
    );
  }

  const dominantSignatures = new Set(
    Array.from(candidateDurationBySignature.entries())
      .filter(([, duration]) => duration / totalDuration > 0.5)
      .map(([signature]) => signature)
  );
  if (dominantSignatures.size === 0) return candidates;

  const pruned = new Map<number, Set<DropReason>>();
  for (const [index, reasons] of Array.from(candidates.entries())) {
    const entry = entries[index];
    const nextReasons = new Set(reasons);
    if (entry?.signature && dominantSignatures.has(entry.signature)) {
      nextReasons.delete('explicit-uri');
      nextReasons.delete('non-media');
    }
    if (nextReasons.size > 0) {
      pruned.set(index, nextReasons);
    }
  }

  return pruned;
}

function isUriOnlyCandidate(reasons: Set<DropReason>): boolean {
  return (
    reasons.size > 0 &&
    Array.from(reasons).every(
      (reason) => reason === 'explicit-uri' || reason === 'non-media'
    )
  );
}

function isStructurallySafeDrop(
  entries: PlaylistEntry[],
  candidates: Map<number, Set<DropReason>>
): boolean {
  if (entries.length < 8) return false;

  const totalDuration = sumDurations(entries);
  let structuralDuration = 0;
  let structuralSegments = 0;

  for (const [index, reasons] of Array.from(candidates.entries())) {
    if (!Array.from(reasons).some((reason) => STRUCTURAL_REASONS.has(reason))) {
      continue;
    }
    structuralSegments += 1;
    structuralDuration += entries[index]?.duration || 0;
  }

  if (structuralSegments === 0) return true;
  if (structuralSegments >= entries.length) return false;
  if (structuralSegments / entries.length > MAX_STRUCTURAL_DROP_RATIO) {
    return false;
  }

  return (
    totalDuration <= 0 ||
    structuralDuration / totalDuration <= MAX_STRUCTURAL_DROP_RATIO
  );
}

function isSafeRemainingPlaylist(
  entries: PlaylistEntry[],
  candidates: Map<number, Set<DropReason>>
): boolean {
  if (candidates.size === 0) return true;
  if (candidates.size >= entries.length) return false;

  const keptEntries = entries.filter((entry) => !candidates.has(entry.index));
  return keptEntries.length > 0 && sumDurations(keptEntries) > 0;
}

function rebuildPlaylist(
  parsed: ParsedMediaPlaylist,
  dropPlan: Map<number, Set<DropReason>>
): M3U8AdFilterResult {
  const result: string[] = parsed.header.filter(
    (line) => !isAdControlOrMetadataTag(line.trim())
  );
  let droppedSegments = 0;

  for (const entry of parsed.entries) {
    if (dropPlan.has(entry.index)) {
      droppedSegments += 1;
      continue;
    }

    result.push(
      ...entry.tags.filter((tag) => !isAdControlOrMetadataTag(tag.trim()))
    );
    result.push(entry.uri);
  }

  result.push(
    ...parsed.tail.filter((line) => !isAdControlOrMetadataTag(line.trim()))
  );

  return {
    content: normalizeDiscontinuities(result).join('\n'),
    droppedSegments,
  };
}

function normalizeDiscontinuities(lines: string[]): string[] {
  const normalized: string[] = [];
  let hasSeenMediaUri = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (isDiscontinuityTag(trimmed)) {
      if (!hasSeenMediaUri) continue;
      if (isDiscontinuityTag(normalized[normalized.length - 1]?.trim() || '')) {
        continue;
      }
    }

    normalized.push(line);
    if (!trimmed.startsWith('#')) {
      hasSeenMediaUri = true;
    }
  }

  return normalized;
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

  if (firstGroup.length === 0 || restGroups.length === 0) {
    return new Set();
  }

  const firstDuration = sumDurations(firstGroup);
  const restDuration = sumDurations(restGroups);
  const firstSignature = getDominantPathSignature(firstGroup);
  const restSignature = getDominantPathSignature(restGroups);

  if (
    firstGroup.every((entry) => entry.explicitAd || entry.cueAd) &&
    firstGroup.length <= MAX_PREROLL_SEGMENTS &&
    firstDuration > 0 &&
    firstDuration <= MAX_PREROLL_SECONDS &&
    restDuration >= firstDuration * 3
  ) {
    return new Set([0]);
  }

  const looksLikeDetachedPreroll =
    firstGroup.length <= MAX_PREROLL_SEGMENTS &&
    firstDuration > 0 &&
    firstDuration <= MAX_PREROLL_SECONDS &&
    firstSignature !== '' &&
    restSignature !== '' &&
    firstSignature !== restSignature &&
    restGroups.length >= firstGroup.length * 3 &&
    restDuration >= firstDuration * 3;

  return looksLikeDetachedPreroll ? new Set([0]) : new Set();
}

function getRecurringInsertedAdGroupsToDrop(
  entries: PlaylistEntry[]
): Set<number> {
  const groups = groupEntriesByDiscontinuity(entries);
  const groupInfos = Array.from(groups.entries())
    .map(([groupNumber, groupEntries]) => ({
      duration: sumDurations(groupEntries),
      entries: groupEntries,
      groupNumber,
      segmentCount: groupEntries.length,
      signature: getDominantPathSignature(groupEntries),
    }))
    .filter((info) => info.entries.length > 0 && info.signature);

  if (groupInfos.length < 3) {
    return new Set();
  }

  const primarySignature = getPrimarySignature(groupInfos);
  if (!primarySignature) {
    return new Set();
  }

  const primaryDuration = sumDurations(
    groupInfos
      .filter((info) => info.signature === primarySignature)
      .flatMap((info) => info.entries)
  );
  const infosBySignature = groupInfosBySignature(groupInfos);
  const dropGroups = new Set<number>();

  for (const [signature, infos] of Array.from(infosBySignature.entries())) {
    if (signature === primarySignature) continue;

    const signatureDuration = infos.reduce(
      (total, info) => total + info.duration,
      0
    );
    const allGroupsAreShort = infos.every(
      (info) =>
        info.segmentCount <= MAX_INSERTED_AD_SEGMENTS &&
        info.duration > 0 &&
        info.duration <= MAX_INSERTED_AD_SECONDS
    );
    const allGroupsAreInserted = infos.every((info) =>
      isGroupBetweenPrimaryContent(groupInfos, info, primarySignature)
    );
    const isMinorTrack =
      primaryDuration > 0 && signatureDuration <= primaryDuration * 0.25;

    if (
      infos.length < MIN_RECURRING_AD_GROUPS ||
      !isMinorTrack ||
      !allGroupsAreShort ||
      !allGroupsAreInserted
    ) {
      continue;
    }

    for (const info of infos) {
      dropGroups.add(info.groupNumber);
    }
  }

  return dropGroups;
}

function getRecurringInlineAdSegmentsToDrop(
  entries: PlaylistEntry[]
): Set<number> {
  const signatures = entries.map((entry) => entry.signature);
  if (signatures.filter(Boolean).length < 3) {
    return new Set();
  }

  const signatureDurations = new Map<string, number>();
  for (let index = 0; index < entries.length; index++) {
    const signature = signatures[index];
    if (!signature) continue;
    signatureDurations.set(
      signature,
      (signatureDurations.get(signature) || 0) + entries[index].duration
    );
  }

  const primarySignature = Array.from(signatureDurations.entries()).sort(
    (a, b) => b[1] - a[1]
  )[0]?.[0];
  if (!primarySignature) {
    return new Set();
  }

  const primaryDuration = signatureDurations.get(primarySignature) || 0;
  const runs = buildSegmentRuns(entries, signatures);
  const runsBySignature = new Map<string, SegmentRun[]>();

  for (const run of runs) {
    if (!run.signature || run.signature === primarySignature) continue;
    const list = runsBySignature.get(run.signature) || [];
    list.push(run);
    runsBySignature.set(run.signature, list);
  }

  const dropIndexes = new Set<number>();
  for (const [signature, signatureRuns] of Array.from(
    runsBySignature.entries()
  )) {
    const signatureDuration = signatureDurations.get(signature) || 0;
    const allRunsAreShort = signatureRuns.every(
      (run) =>
        run.segmentCount <= MAX_INSERTED_AD_SEGMENTS &&
        run.duration > 0 &&
        run.duration <= MAX_INSERTED_AD_SECONDS
    );
    const insertedRunCount = signatureRuns.filter((run) =>
      isRunBetweenPrimaryContent(run, signatures, primarySignature)
    ).length;
    const isMinorTrack =
      primaryDuration > 0 && signatureDuration <= primaryDuration * 0.25;

    if (
      signatureRuns.length < MIN_RECURRING_AD_GROUPS ||
      insertedRunCount < MIN_RECURRING_AD_GROUPS ||
      !isMinorTrack ||
      !allRunsAreShort
    ) {
      continue;
    }

    for (const run of signatureRuns) {
      for (let index = run.startIndex; index <= run.endIndex; index++) {
        dropIndexes.add(index);
      }
    }
  }

  return dropIndexes;
}

function buildSegmentRuns(
  entries: PlaylistEntry[],
  signatures: string[]
): SegmentRun[] {
  const runs: SegmentRun[] = [];
  let index = 0;

  while (index < entries.length) {
    const signature = signatures[index];
    const startIndex = index;
    let duration = 0;

    while (index < entries.length && signatures[index] === signature) {
      duration += entries[index].duration;
      index++;
    }

    runs.push({
      duration,
      endIndex: index - 1,
      segmentCount: index - startIndex,
      signature,
      startIndex,
    });
  }

  return runs;
}

function getPrimarySignature(groupInfos: PlaylistGroupInfo[]): string {
  const signatureDurations = new Map<string, number>();
  for (const info of groupInfos) {
    signatureDurations.set(
      info.signature,
      (signatureDurations.get(info.signature) || 0) + info.duration
    );
  }

  return (
    Array.from(signatureDurations.entries()).sort(
      (a, b) => b[1] - a[1]
    )[0]?.[0] || ''
  );
}

function groupInfosBySignature(
  groupInfos: PlaylistGroupInfo[]
): Map<string, PlaylistGroupInfo[]> {
  const grouped = new Map<string, PlaylistGroupInfo[]>();
  for (const info of groupInfos) {
    const list = grouped.get(info.signature) || [];
    list.push(info);
    grouped.set(info.signature, list);
  }
  return grouped;
}

function isGroupBetweenPrimaryContent(
  groupInfos: PlaylistGroupInfo[],
  target: PlaylistGroupInfo,
  primarySignature: string
): boolean {
  const orderedInfos = [...groupInfos].sort(
    (a, b) => a.groupNumber - b.groupNumber
  );
  const index = orderedInfos.findIndex(
    (info) => info.groupNumber === target.groupNumber
  );
  if (index < 0) return false;

  const previous = findNearestGroupSignature(orderedInfos, index - 1, -1);
  const next = findNearestGroupSignature(orderedInfos, index + 1, 1);
  return previous === primarySignature && next === primarySignature;
}

function findNearestGroupSignature(
  groupInfos: PlaylistGroupInfo[],
  startIndex: number,
  direction: 1 | -1
): string {
  for (
    let index = startIndex;
    index >= 0 && index < groupInfos.length;
    index += direction
  ) {
    if (groupInfos[index].signature) {
      return groupInfos[index].signature;
    }
  }
  return '';
}

function isRunBetweenPrimaryContent(
  run: SegmentRun,
  signatures: string[],
  primarySignature: string
): boolean {
  const previousSignature = findNearestSignature(
    signatures,
    run.startIndex - 1,
    -1
  );
  const nextSignature = findNearestSignature(signatures, run.endIndex + 1, 1);
  return (
    previousSignature === primarySignature && nextSignature === primarySignature
  );
}

function findNearestSignature(
  signatures: string[],
  startIndex: number,
  direction: 1 | -1
): string {
  for (
    let index = startIndex;
    index >= 0 && index < signatures.length;
    index += direction
  ) {
    if (signatures[index]) return signatures[index];
  }
  return '';
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

function getExplicitUriAdReason(uri: string): DropReason | null {
  if (NON_MEDIA_SEGMENT_PATTERN.test(uri.trim())) {
    return 'non-media';
  }

  return hasStrongAdTokenInUriPath(uri) ? 'explicit-uri' : null;
}

function hasStrongAdTokenInUriPath(uri: string): boolean {
  const path = getUrlLikePath(uri);
  const segments = path.split('/').filter(Boolean);

  for (const segment of segments) {
    const normalizedSegment = normalizeUrlLikeValue(segment)
      .replace(/\.[a-z0-9]{1,8}$/i, '')
      .toLowerCase();
    const tokens = normalizedSegment
      .split(/[^a-z0-9\u4e00-\u9fff]+/i)
      .filter(Boolean);

    for (const token of tokens) {
      if (isStrongAdToken(token)) {
        return true;
      }
    }

    if (
      /^(?:ad|ads|adv|gg|hdgg)\d+$/i.test(normalizedSegment) ||
      /^(?:preroll|promo|vast|vmap|commercial)[-_]?\d*$/i.test(
        normalizedSegment
      ) ||
      /\u5e7f\u544a|\u5ee3\u544a/i.test(normalizedSegment)
    ) {
      return true;
    }
  }

  return false;
}

function isStrongAdToken(token: string): boolean {
  const normalized = token.toLowerCase();
  if (STRONG_AD_TOKENS.has(normalized)) return true;
  return /\u5e7f\u544a|\u5ee3\u544a/i.test(normalized);
}

function getUrlLikePath(uri: string): string {
  const trimmed = uri.trim();
  try {
    return new URL(trimmed).pathname;
  } catch (_) {
    return trimmed.split(/[?#]/)[0];
  }
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

function isSegmentAdMarkerTag(line: string): boolean {
  const upper = line.toUpperCase();
  return (
    isCueOutTag(upper) ||
    upper.startsWith('#EXT-X-ASSET') ||
    upper.startsWith('#EXT-X-VMAP')
  );
}

function isAdControlOrMetadataTag(line: string): boolean {
  const upper = line.toUpperCase();
  return (
    isCueOutTag(upper) ||
    isCueInTag(upper) ||
    upper.startsWith('#EXT-X-ASSET') ||
    upper.startsWith('#EXT-X-VMAP') ||
    (upper.startsWith('#EXT-X-DATERANGE') && AD_TAG_PATTERN.test(upper))
  );
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
    if (!entry.signature) continue;
    counts.set(entry.signature, (counts.get(entry.signature) || 0) + 1);
  }

  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

function getPathSignature(uri: string): string {
  const path = getUrlLikePath(uri);
  const slashIndex = path.lastIndexOf('/');
  if (slashIndex < 0) return '';
  return normalizeUrlLikeValue(path.slice(0, slashIndex + 1)).toLowerCase();
}

function normalizeUrlLikeValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}
