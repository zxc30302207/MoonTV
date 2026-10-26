import { NextRequest, NextResponse } from 'next/server';

import { readBoundedText } from '@/lib/bounded-response';
import { filterAdsFromM3U8WithStats } from '@/lib/m3u8-ad-filter';
import { getClientIp, getRateLimitHeaders, rateLimit } from '@/lib/rate-limit';
import { assertSafeUrl, parseAllowedHosts, safeFetch } from '@/lib/url-safety';

export const runtime = 'nodejs';

const M3U8_CONTENT_TYPE = 'application/vnd.apple.mpegurl; charset=utf-8';

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rateLimitResult = rateLimit(clientIp, {
    limit: 60,
    prefix: 'm3u8-filter',
    windowMs: 60_000,
  });
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: {
          ...getRateLimitHeaders(rateLimitResult),
          'Cache-Control': 'private, no-store',
        },
      }
    );
  }

  const targetUrl = request.nextUrl.searchParams.get('url') || '';
  if (!targetUrl) {
    return NextResponse.json(
      { error: 'Missing m3u8 url' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }

  const allowPrivateNetworks = process.env.ALLOW_PRIVATE_NETWORKS === 'true';
  const allowedHosts = parseAllowedHosts(
    process.env.ALLOWED_M3U8_HOSTS || process.env.ALLOWED_PROXY_HOSTS
  );

  const requestDeadline = new AbortController();
  const requestTimer = setTimeout(() => requestDeadline.abort(), 15000);
  try {
    const playlistUrl = assertSafeUrl(targetUrl, {
      allowPrivateNetworks,
      allowedHosts,
    }).toString();
    const response = await safeFetch(
      playlistUrl,
      {
        signal: requestDeadline.signal,
        headers: {
          Accept:
            'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*',
          'User-Agent':
            'Mozilla/5.0 (compatible; MoonTV-M3U8-Filter/1.0; +https://github.com/zxc30302207/MoonTV)',
        },
      },
      { allowPrivateNetworks, allowedHosts }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch m3u8 playlist' },
        {
          status: response.status,
          headers: { 'Cache-Control': 'private, no-store' },
        }
      );
    }

    // Relative children, keys and media must resolve against the FINAL redirect URL.
    const resolvedPlaylistUrl = assertSafeUrl(response.url || playlistUrl, {
      allowPrivateNetworks,
      allowedHosts,
    }).toString();
    const content = (await readBoundedText(response, 4 * 1024 * 1024)).replace(
      /^#MOONTV-AD-FILTER:.*(?:\r?\n|$)/gm,
      ''
    );
    if (!content.trimStart().startsWith('#EXTM3U')) {
      return NextResponse.json(
        { error: 'Target is not an m3u8 playlist' },
        { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    // Separate audio/subtitle tracks may identify breaks differently. Preserve
    // every rendition's timeline until a shared removal map is available.
    const preserveTimeline =
      request.nextUrl.searchParams.get('preserve') === '1' ||
      (content.match(/^#EXT-X-STREAM-INF:/gm)?.length || 0) > 1 ||
      content
        .split(/\r?\n/)
        .some(
          (line) =>
            line.startsWith('#EXT-X-MEDIA:') &&
            /(?:[:,])TYPE=(?:AUDIO|SUBTITLES)(?:,|$)/.test(line) &&
            /(?:[:,])URI="/.test(line)
        );
    const rewritten = isMasterPlaylist(content)
      ? {
          content: rewritePlaylistUris(content, resolvedPlaylistUrl, {
            allowPrivateNetworks,
            allowedHosts,
            forcePlaylistUris: true,
            playlistUrisUseFilter: true,
            preserveTimeline,
          }),
          droppedSegments: 0,
          droppedDuration: 0,
        }
      : rewriteFilteredMediaPlaylist(content, resolvedPlaylistUrl, {
          allowPrivateNetworks,
          allowedHosts,
          preserveTimeline,
        });

    const report = JSON.stringify({
      removedSegments: rewritten.droppedSegments,
      removedSeconds: rewritten.droppedDuration || 0,
      ...(preserveTimeline ? { preservedReason: 'multiple-renditions' } : {}),
    });
    const body = rewritten.content.replace(
      /(#EXTM3U[^\r\n]*)(\r?\n|$)/,
      `$1\n#MOONTV-AD-FILTER:${report}\n`
    );
    return new NextResponse(body, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': M3U8_CONTENT_TYPE,
        'X-MoonTV-Dropped-Segments': String(rewritten.droppedSegments),
        'X-MoonTV-Dropped-Duration': String(rewritten.droppedDuration || 0),
        'X-MoonTV-Filter-Mode': preserveTimeline
          ? 'preserve-timeline'
          : 'conservative',
      },
    });
  } catch (_) {
    return NextResponse.json(
      { error: 'Invalid or unsafe m3u8 url' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  } finally {
    clearTimeout(requestTimer);
  }
}

function rewriteFilteredMediaPlaylist(
  content: string,
  playlistUrl: string,
  options: {
    allowPrivateNetworks: boolean;
    allowedHosts?: string[];
    preserveTimeline?: boolean;
  }
): { content: string; droppedSegments: number; droppedDuration: number } {
  const filtered = options.preserveTimeline
    ? { content, droppedSegments: 0, droppedDuration: 0 }
    : filterAdsFromM3U8WithStats(content);
  return {
    content: rewritePlaylistUris(filtered.content, playlistUrl, {
      ...options,
      forcePlaylistUris: false,
      playlistUrisUseFilter: true,
    }),
    droppedSegments: filtered.droppedSegments,
    droppedDuration: filtered.droppedDuration || 0,
  };
}

function rewritePlaylistUris(
  content: string,
  playlistUrl: string,
  options: {
    allowPrivateNetworks: boolean;
    allowedHosts?: string[];
    preserveTimeline?: boolean;
    forcePlaylistUris: boolean;
    playlistUrisUseFilter: boolean;
  }
): string {
  return content
    .split(/\r?\n/)
    .map((line) => rewritePlaylistLine(line, playlistUrl, options))
    .join('\n');
}

function rewritePlaylistLine(
  line: string,
  playlistUrl: string,
  options: {
    allowPrivateNetworks: boolean;
    allowedHosts?: string[];
    preserveTimeline?: boolean;
    forcePlaylistUris: boolean;
    playlistUrisUseFilter: boolean;
  }
): string {
  const trimmed = line.trim();
  if (!trimmed) return line;

  if (!trimmed.startsWith('#')) {
    return rewriteUri(trimmed, playlistUrl, options);
  }

  if (hasUriAttribute(trimmed)) {
    const uriOptions = isPlaylistUriAttributeTag(trimmed)
      ? { ...options, forcePlaylistUris: true, playlistUrisUseFilter: true }
      : {
          ...options,
          forcePlaylistUris: false,
          playlistUrisUseFilter: false,
        };
    return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
      return `URI="${rewriteUri(uri, playlistUrl, uriOptions)}"`;
    });
  }

  return line;
}

function rewriteUri(
  uri: string,
  playlistUrl: string,
  options: {
    allowPrivateNetworks: boolean;
    allowedHosts?: string[];
    preserveTimeline?: boolean;
    forcePlaylistUris: boolean;
    playlistUrisUseFilter: boolean;
  }
): string {
  const absoluteUrl = new URL(uri, playlistUrl).toString();
  assertSafeUrl(absoluteUrl, {
    allowPrivateNetworks: options.allowPrivateNetworks,
    allowedHosts: options.allowedHosts,
  });

  if (
    options.playlistUrisUseFilter &&
    (options.forcePlaylistUris || isM3U8Uri(absoluteUrl))
  ) {
    return `/api/m3u8/filter?url=${encodeURIComponent(absoluteUrl)}${
      options.preserveTimeline ? '&preserve=1' : ''
    }`;
  }

  return absoluteUrl;
}

function isMasterPlaylist(content: string): boolean {
  return /^#EXT-X-STREAM-INF:/m.test(content);
}

function isM3U8Uri(uri: string): boolean {
  return /\.m3u8(?:[?#].*)?$/i.test(
    new URL(uri).pathname + new URL(uri).search
  );
}

function hasUriAttribute(line: string): boolean {
  return /\bURI="/.test(line);
}

function isPlaylistUriAttributeTag(line: string): boolean {
  const upper = line.toUpperCase();
  return (
    upper.startsWith('#EXT-X-MEDIA') ||
    upper.startsWith('#EXT-X-I-FRAME-STREAM-INF') ||
    upper.startsWith('#EXT-X-RENDITION-REPORT')
  );
}
