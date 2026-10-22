type DropReason = 'verified-asset' | 'cue';

type PlaylistEntry = {
  duration: number;
  index: number;
  reasons: Set<DropReason>;
  tags: string[];
  uri: string;
};

type ParsedMediaPlaylist = {
  entries: PlaylistEntry[];
  header: string[];
  tail: string[];
};

export type M3U8AdFilterResult = {
  content: string;
  droppedSegments: number;
  droppedDuration?: number;
};

/**
 * Verified on 2026-10-06 against decoded public-source samples from unrelated
 * titles (Hunan programme + animation; 360 short animation + Doraemon).
 * Match the COMPLETE ordered path/duration sequence, never a host, bitrate,
 * filename substring or minority folder alone. CDN host rotation is harmless.
 * Evidence notes and bounded manifest snippets live in the regression tests.
 */
const VERIFIED_AD_SEQUENCES = [
  {
    // Alias verified byte-for-byte against the six-segment creative below.
    // Programme with burned-in sponsor overlays is deliberately not removed.
    prefix: '/20261009/pjEiiKbZ/10152kb/hls/',
    files: [
      'nahMNf8r.ts',
      'ZFz9RQeM.ts',
      'cHqkizsC.ts',
      'jYruJ6ZL.ts',
      '7j1ossEx.ts',
      'ZTQzdtRR.ts',
    ],
    durations: [3, 3, 5, 3, 3, 0.64],
  },
  {
    // Four-segment packaging of visually verified gambling creative (2026-10-22).
    prefix: '/20261008/2DExGZYA/hls/',
    files: ['wTYCABLc.ts', 'HJKFKNWX.ts', 'tem9H9Vu.ts', 'Y2VXzNPO.ts'],
    durations: [5, 5, 5, 2.567],
  },
  {
    // Visually verified 2026-10-22: six gambling-ad segments, not programme.
    // Exact ordered asset identity + duration; see docs/AD_ASSET_EVIDENCE.md.
    prefix: '/20261009/Bjf6z0RU/10152kb/hls/',
    files: [
      '6JFnQsqe.ts',
      'WfGR4xIS.ts',
      'KMplaxXV.ts',
      '0ONtLMnT.ts',
      'auT4G7cp.ts',
      'j2XNBmNk.ts',
    ],
    durations: [3, 3, 5, 3, 3, 0.64],
  },
  {
    prefix: '/20260917/khKm9Z55/10110kb/hls/',
    files: [
      'ziiI7NqG.ts',
      '6A9DtRjZ.ts',
      'yDBttVea.ts',
      '375tEjhm.ts',
      '8MtYWTXy.ts',
      'ZSaJTnmE.ts',
    ],
    durations: [3, 3, 5, 3, 3, 0.64],
  },
  {
    prefix: '/20260917/oVx7Nl6K/hls/',
    files: ['6DX5yaZ1.ts', 'Q22Q6Lti.ts', 'Qailk3T1.ts', 'aV53bW81.ts'],
    durations: [5, 5, 5, 2.567],
  },
];

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

  // Live sliding windows must retain their original sequence/discontinuity numbering.
  if (!/#EXT-X-ENDLIST(?:\s|$)/m.test(content))
    return { content, droppedSegments: 0 };

  // Malformed numbering cannot safely be used for AES IVs/discontinuities.
  if (
    content
      .split(/\r?\n/)
      .some(
        (line) =>
          /^#EXT-X-(?:MEDIA-SEQUENCE|DISCONTINUITY-SEQUENCE):/i.test(
            line.trim()
          ) &&
          !/^#EXT-X-(?:MEDIA-SEQUENCE|DISCONTINUITY-SEQUENCE):[0-9]+$/i.test(
            line.trim()
          )
      )
  )
    return { content, droppedSegments: 0 };

  const parsed = parseMediaPlaylist(content);
  if (parsed.entries.length === 0) {
    return { content, droppedSegments: 0 };
  }

  const dropPlan = buildDropPlan(parsed.entries);
  // Unknown interstitials may be introductions/bonus content. Preserve them too.
  if (dropPlan.size === 0) return { content, droppedSegments: 0 };
  if (
    hasUnsupportedTimelineState(content) ||
    parsed.entries.some(
      (entry) => !Number.isFinite(entry.duration) || entry.duration <= 0
    )
  ) {
    return { content, droppedSegments: 0 };
  }
  return rebuildPlaylist(parsed, dropPlan, content);
}

function hasUnsupportedTimelineState(content: string): boolean {
  // Date ranges can schedule introductions, bonus material or other external
  // content. Without a shared timeline map, cutting beside them is ambiguous.
  if (/^#EXT-X-DATERANGE:/m.test(content)) return true;
  return content.split(/\r?\n/).some((rawLine) => {
    const line = rawLine.trim();
    if (line.startsWith('#EXT-X-KEY:')) {
      const attributes = cueAttributes(line.slice('#EXT-X-KEY:'.length));
      const method = attributes?.get('METHOD');
      const format = attributes?.get('KEYFORMAT')?.replace(/^"(.*)"$/, '$1');
      return (
        !['NONE', 'AES-128'].includes(method || '') ||
        Boolean(format && format !== 'identity')
      );
    }
    return line.startsWith('#EXT-X-MAP:') && /BYTERANGE="\d+"/.test(line);
  });
}

function parseMediaPlaylist(content: string): ParsedMediaPlaylist {
  const lines = content.split(/\r?\n/);
  const entries: PlaylistEntry[] = [];
  const header: string[] = [];
  let hasSeenSegment = false;
  // Commit a cue span only after its end is verified. A malformed marker must
  // not turn the remainder of the programme into an unbounded advertisement.
  let cue: {
    duration: number | null;
    elapsed: number;
    entries: number[];
  } | null = null;
  let cueBlocked = false;
  const isCueComplete = () =>
    cue !== null &&
    cue.duration !== null &&
    Math.abs(cue.elapsed - cue.duration) <= 0.001;
  const finishCue = () => {
    if (cue) {
      for (const index of cue.entries) entries[index].reasons.add('cue');
    }
    cue = null;
  };
  let pendingTags: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (!line.startsWith('#')) {
      // Wait through boundary metadata before committing. A continuation on
      // this next segment may contradict an apparently completed duration.
      if (isCueComplete()) finishCue();
      const tags = pendingTags;
      const duration = getPendingDuration(tags);
      const reasons = new Set<DropReason>();

      entries.push({
        duration,
        index: entries.length,
        reasons,
        tags,
        uri: rawLine,
      });

      if (cue) {
        cue.entries.push(entries.length - 1);
        cue.elapsed += duration;
        if (cue.duration !== null) {
          if (cue.elapsed > cue.duration + 0.001) {
            // A segment straddles the advertised boundary; do not cut it or
            // rely on this ambiguous cue span to remove preceding segments.
            cue = null;
            cueBlocked = true;
          }
        }
      }

      pendingTags = [];
      hasSeenSegment = true;
      continue;
    }

    if (
      /^#(?:EXTM3U$|EXT-X-(?:VERSION|TARGETDURATION|MEDIA-SEQUENCE|DISCONTINUITY-SEQUENCE|PLAYLIST-TYPE|I-FRAMES-ONLY|INDEPENDENT-SEGMENTS|START|PART-INF|SERVER-CONTROL)(?::|$))/i.test(
        line
      )
    ) {
      header.push(rawLine);
      continue;
    }

    if (isCueOutTag(line)) {
      if (isCueComplete()) finishCue();
      const duration = parseCueDuration(line);
      if (cue || cueBlocked || duration === undefined) {
        cue = null;
        cueBlocked = true;
      } else {
        cue = { duration, elapsed: 0, entries: [] };
      }
      continue;
    }

    if (isCueContinuationTag(line)) {
      const continuation = parseCueContinuation(line);
      if (!continuation || cueBlocked) {
        cue = null;
        cueBlocked = true;
      } else if (cue) {
        if (
          (cue.duration !== null &&
            Math.abs(cue.duration - continuation.duration) > 0.001) ||
          Math.abs(cue.elapsed - continuation.elapsed) > 0.001
        ) {
          cue = null;
          cueBlocked = true;
        } else {
          cue.duration = continuation.duration;
        }
      } else if (!hasSeenSegment) {
        // Archived/clipped playlists can begin during an ad break. Only a
        // leading continuation can establish a span without an OUT marker.
        cue = { ...continuation, entries: [] };
      }
      continue;
    }

    if (isCueInTag(line)) {
      // CUE-IN has no payload. Malformed lookalikes cannot validate a span.
      if (/^#EXT-X-CUE-IN(?::)?$/i.test(line)) {
        finishCue();
        cueBlocked = false;
      } else {
        cue = null;
        cueBlocked = true;
      }
      continue;
    }

    if (isAdControlOrMetadataTag(line)) {
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
      pendingTags.push(rawLine);
      continue;
    }

    pendingTags.push(rawLine);
  }

  if (isCueComplete()) finishCue();
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

  for (const sequence of VERIFIED_AD_SEQUENCES) {
    for (
      let start = 0;
      start <= entries.length - sequence.files.length;
      start += 1
    ) {
      const matches = sequence.files.every((file, offset) => {
        const entry = entries[start + offset];
        return (
          getUrlLikePath(entry.uri) === `${sequence.prefix}${file}` &&
          Math.abs(entry.duration - sequence.durations[offset]) <= 0.01
        );
      });
      if (!matches) continue;
      for (let offset = 0; offset < sequence.files.length; offset += 1) {
        addDropReason(candidates, start + offset, 'verified-asset');
      }
    }
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
  return isSafeRemainingPlaylist(entries, candidates) ? candidates : new Map();
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

/** Rebuild without losing encryption/init state or implicit byte offsets. */
function rebuildPlaylist(
  parsed: ParsedMediaPlaylist,
  dropPlan: Map<number, Set<DropReason>>,
  originalContent: string
): M3U8AdFilterResult {
  const result: string[] = parsed.header.filter(
    (line) => !isAdControlOrMetadataTag(line.trim())
  );
  const mediaSequence =
    parsed.header
      .find((line) => /^#EXT-X-MEDIA-SEQUENCE:/i.test(line.trim()))
      ?.split(':')[1]
      .trim() || '0';
  let baseSequence: bigint;
  try {
    baseSequence = BigInt(mediaSequence);
  } catch {
    baseSequence = BigInt(0);
  }
  const firstKept = parsed.entries.find((entry) => !dropPlan.has(entry.index));
  const leadingDiscontinuities = parsed.entries
    .slice(0, (firstKept?.index ?? 0) + 1)
    .reduce(
      (count, entry) => count + entry.tags.filter(isDiscontinuityTag).length,
      0
    );
  const updateSequence = (tag: string, value: string) => {
    const index = result.findIndex((line) => line.startsWith(`${tag}:`));
    if (index >= 0) result[index] = `${tag}:${value}`;
    else result.push(`${tag}:${value}`);
  };
  if (firstKept && firstKept.index > 0)
    updateSequence(
      '#EXT-X-MEDIA-SEQUENCE',
      (baseSequence + BigInt(firstKept.index)).toString()
    );
  if (leadingDiscontinuities > 0) {
    const original =
      result
        .find((line) => line.startsWith('#EXT-X-DISCONTINUITY-SEQUENCE:'))
        ?.split(':')[1] || '0';
    updateSequence(
      '#EXT-X-DISCONTINUITY-SEQUENCE',
      (BigInt(original) + BigInt(leadingDiscontinuities)).toString()
    );
  }
  let droppedSegments = 0;
  let droppedDuration = 0;
  let carriedState: string[] = [];
  let activeKey: string | null = null;
  let previousRange: { uri: string; end: number } | null = null;
  let hasKeptSegment = false;
  let crossedRemovedSegment = false;

  for (const entry of parsed.entries) {
    const keyTags = entry.tags.filter((tag) =>
      /^#EXT-X-KEY:/i.test(tag.trim())
    );
    for (const key of keyTags) {
      const format = cueAttributes(key.trim().slice('#EXT-X-KEY:'.length))
        ?.get('KEYFORMAT')
        ?.replace(/^"(.*)"$/, '$1');
      if (!format || format === 'identity') activeKey = key;
    }
    const range = entry.tags.find((tag) =>
      /^#EXT-X-BYTERANGE:/i.test(tag.trim())
    );
    let resolvedRange: string | null = null;
    if (range) {
      const match = range.trim().match(/^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?$/i);
      const size = Number(match?.[1]);
      const offset: number =
        match?.[2] !== undefined
          ? Number(match[2])
          : previousRange?.uri === entry.uri
          ? previousRange.end
          : NaN;
      if (
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(offset + size)
      ) {
        // Ambiguous range semantics: keep the original playlist rather than corrupt retained content.
        return { content: originalContent, droppedSegments: 0 };
      }
      previousRange = { uri: entry.uri, end: offset + size };
      resolvedRange = `#EXT-X-BYTERANGE:${size}@${offset}`;
    } else {
      previousRange = null;
    }

    if (dropPlan.has(entry.index)) {
      droppedSegments += 1;
      droppedDuration += entry.duration;
      carriedState.push(
        ...entry.tags.filter((tag) => /^#EXT-X-(?:KEY|MAP):/i.test(tag.trim()))
      );
      crossedRemovedSegment = true;
      continue;
    }

    if (
      crossedRemovedSegment &&
      hasKeptSegment &&
      !entry.tags.some(isDiscontinuityTag)
    ) {
      result.push('#EXT-X-DISCONTINUITY');
    }
    result.push(...carriedState);
    carriedState = [];
    result.push(
      ...entry.tags
        .filter((tag) => !isAdControlOrMetadataTag(tag.trim()))
        .map((tag) =>
          dropPlan.size > 0 &&
          resolvedRange &&
          /^#EXT-X-BYTERANGE:/i.test(tag.trim())
            ? resolvedRange
            : tag
        )
    );
    // AES-128 without IV derives it from the ORIGINAL media sequence. Deleting
    // earlier segments changes implicit numbering, so pin the original IV.
    if (
      dropPlan.size > 0 &&
      activeKey &&
      cueAttributes(activeKey.trim().slice('#EXT-X-KEY:'.length))?.get(
        'METHOD'
      ) === 'AES-128' &&
      !cueAttributes(activeKey.trim().slice('#EXT-X-KEY:'.length))?.has('IV')
    ) {
      const declaredVersion = Number(
        result
          .find((line) => line.startsWith('#EXT-X-VERSION:'))
          ?.split(':')[1] || 1
      );
      if (declaredVersion < 2) updateSequence('#EXT-X-VERSION', '2');
      const iv = (baseSequence + BigInt(entry.index))
        .toString(16)
        .padStart(32, '0');
      result.push(`${activeKey},IV=0x${iv}`);
    }
    result.push(entry.uri);
    hasKeptSegment = true;
    crossedRemovedSegment = false;
  }
  result.push(
    ...parsed.tail.filter((line) => !isAdControlOrMetadataTag(line.trim()))
  );
  // EXT-X-START is relative to the playlist timeline, not the original media.
  // Map the requested position through cuts so prerolls/midrolls cannot shift it.
  const totalDuration = sumDurations(parsed.entries);
  for (let index = 0; index < result.length; index += 1) {
    if (!result[index].trim().startsWith('#EXT-X-START:')) continue;
    const match = result[index].match(
      /(?:[:,])TIME-OFFSET=(-?[0-9]+(?:\.[0-9]+)?)(?=,|$)/
    );
    if (!match || !Number.isFinite(Number(match[1]))) {
      return { content: originalContent, droppedSegments: 0 };
    }
    const offset = Number(match[1]);
    const position = Math.max(
      0,
      Math.min(totalDuration, offset < 0 ? totalDuration + offset : offset)
    );
    let originalPosition = 0;
    let mappedPosition = 0;
    for (const entry of parsed.entries) {
      if (!dropPlan.has(entry.index)) {
        mappedPosition += Math.max(
          0,
          Math.min(entry.duration, position - originalPosition)
        );
      }
      originalPosition += entry.duration;
    }
    const mappedOffset =
      offset < 0
        ? mappedPosition - (totalDuration - droppedDuration)
        : mappedPosition;
    const roundedOffset = Math.round(mappedOffset * 1000000) / 1000000;
    // Negative zero is parsed as a start-relative offset; retain the end position.
    const outputOffset =
      offset < 0 && roundedOffset === 0
        ? Math.round(mappedPosition * 1000000) / 1000000
        : roundedOffset;
    result[index] = result[index].replace(
      `TIME-OFFSET=${match[1]}`,
      `TIME-OFFSET=${outputOffset}`
    );
  }
  return {
    content: normalizeDiscontinuities(result).join('\n'),
    droppedSegments,
    ...(droppedSegments > 0
      ? { droppedDuration: Math.round(droppedDuration * 1000) / 1000 }
      : {}),
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

function isMasterPlaylist(content: string): boolean {
  return /^#EXT-X-STREAM-INF:/m.test(content);
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
  return /^#EXT-X-CUE-OUT(?::|$)/.test(upper);
}

function isCueContinuationTag(line: string): boolean {
  return /^#EXT-X-CUE-OUT-CONT(?::|$)/i.test(line.trim());
}

/** Parse complete decimal values, never a numeric prefix of malformed data. */
function parseCueNumber(value: string): number | undefined {
  const unquoted = value.trim().replace(/^"([^"\n]*)"$/, '$1');
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(unquoted)) return undefined;
  const number = Number(unquoted);
  return Number.isFinite(number) ? number : undefined;
}

function cueAttributes(value: string): Map<string, string> | undefined {
  const attributes = new Map<string, string>();
  // Split outside quotes; SCTE35/CAID metadata may accompany cue timing.
  const parts = value.match(/(?:[^,"]|"[^"\n]*")+/g) || [];
  if (parts.join(',') !== value) return undefined;
  for (const part of parts) {
    const match = part.trim().match(/^([A-Z0-9-]+)=(.*)$/i);
    if (!match || attributes.has(match[1].toUpperCase())) return undefined;
    attributes.set(match[1].toUpperCase(), match[2]);
  }
  return attributes;
}

function parseCueDuration(line: string): number | null | undefined {
  const separator = line.indexOf(':');
  if (separator < 0) return null;
  const value = line.slice(separator + 1).trim();
  const attributes = value.includes('=') ? cueAttributes(value) : undefined;
  const duration = parseCueNumber(attributes?.get('DURATION') ?? value);
  return duration !== undefined && duration > 0 ? duration : undefined;
}

function parseCueContinuation(
  line: string
): { duration: number; elapsed: number } | undefined {
  const separator = line.indexOf(':');
  if (separator < 0) return undefined;
  const value = line.slice(separator + 1).trim();
  const attributes = cueAttributes(value);
  const shorthand = value.includes('=') ? [] : value.split('/');
  const duration = parseCueNumber(
    attributes?.get('DURATION') ?? (shorthand.length === 2 ? shorthand[1] : '')
  );
  const elapsed = parseCueNumber(
    attributes?.get('ELAPSEDTIME') ??
      (shorthand.length === 2 ? shorthand[0] : '')
  );
  if (
    duration === undefined ||
    elapsed === undefined ||
    duration <= 0 ||
    elapsed >= duration
  ) {
    return undefined;
  }
  return { duration, elapsed };
}

function isCueInTag(line: string): boolean {
  return /^#EXT-X-CUE-IN(?::|$)/.test(line.trim().toUpperCase());
}

function isAdControlOrMetadataTag(line: string): boolean {
  return isCueOutTag(line) || isCueInTag(line) || isCueContinuationTag(line);
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

  const match = extinf.trim().match(/^#EXTINF:([0-9]+(?:\.[0-9]+)?),.*$/);
  return match ? Number(match[1]) : 0;
}

function sumDurations(entries: PlaylistEntry[]): number {
  return entries.reduce((total, entry) => total + entry.duration, 0);
}
