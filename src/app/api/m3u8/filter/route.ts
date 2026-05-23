import { NextRequest, NextResponse } from 'next/server';

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

  try {
    const playlistUrl = assertSafeUrl(targetUrl, {
      allowPrivateNetworks,
      allowedHosts,
    }).toString();
    const response = await safeFetch(
      playlistUrl,
      {
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

    const content = await response.text();
    if (!content.trimStart().startsWith('#EXTM3U')) {
      return NextResponse.json(
        { error: 'Target is not an m3u8 playlist' },
        { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }

    const rewritten = isMasterPlaylist(content)
      ? {
          content: rewritePlaylistUris(content, playlistUrl, {
            allowPrivateNetworks,
            allowedHosts,
            forcePlaylistUris: true,
            playlistUrisUseFilter: true,
          }),
          droppedSegments: 0,
        }
      : rewriteFilteredMediaPlaylist(content, playlistUrl, {
          allowPrivateNetworks,
          allowedHosts,
        });

    return new NextResponse(rewritten.content, {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': M3U8_CONTENT_TYPE,
        'X-MoonTV-Dropped-Segments': String(rewritten.droppedSegments),
      },
    });
  } catch (_) {
    return NextResponse.json(
      { error: 'Invalid or unsafe m3u8 url' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}

function rewriteFilteredMediaPlaylist(
  content: string,
  playlistUrl: string,
  options: {
    allowPrivateNetworks: boolean;
    allowedHosts?: string[];
  }
): { content: string; droppedSegments: number } {
  const filtered = filterAdsFromM3U8WithStats(content);
  return {
    content: rewritePlaylistUris(filtered.content, playlistUrl, {
      ...options,
      forcePlaylistUris: false,
      playlistUrisUseFilter: true,
    }),
    droppedSegments: filtered.droppedSegments,
  };
}

function rewritePlaylistUris(
  content: string,
  playlistUrl: string,
  options: {
    allowPrivateNetworks: boolean;
    allowedHosts?: string[];
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
    forcePlaylistUris: boolean;
    playlistUrisUseFilter: boolean;
  }
): string {
  const trimmed = line.trim();
  if (!trimmed) return line;

  if (!trimmed.startsWith('#')) {
    return rewriteUri(trimmed, playlistUrl, options);
  }

  if (trimmed.startsWith('#EXT-X-KEY') || trimmed.startsWith('#EXT-X-MAP')) {
    return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
      return `URI="${rewriteUri(uri, playlistUrl, {
        ...options,
        playlistUrisUseFilter: false,
      })}"`;
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
    return `/api/m3u8/filter?url=${encodeURIComponent(absoluteUrl)}`;
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
