import { NextRequest, NextResponse } from 'next/server';

import { getAdultAuthorizationStatus } from '@/lib/adult-authorization';
import {
  type AdultSourceOption,
  fetchAdultRecommendations,
  getAdultSources,
  toAdultSourceOptions,
} from '@/lib/adult-recommendations';
import { getVerifiedAuthInfo } from '@/lib/auth-server';
import { getAvailableApiSites, getConfig } from '@/lib/config';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 96;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parsePositiveInt(searchParams.get('page'), 1);
  const limit = clamp(
    parsePositiveInt(searchParams.get('limit'), DEFAULT_LIMIT),
    1,
    MAX_LIMIT
  );
  const selectedSource = searchParams.get('source') || 'all';

  const config = await getConfig();

  if (!config.SiteConfig.DisableYellowFilter) {
    return NextResponse.json(
      emptyResult(page, limit, [], 'Adult recommendations are disabled'),
      { headers: noStoreHeaders() }
    );
  }

  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo?.username) {
    return NextResponse.json(emptyResult(page, limit, [], 'Unauthorized'), {
      status: 401,
      headers: noStoreHeaders(),
    });
  }

  const adultAuth = getAdultAuthorizationStatus(config, authInfo.username);
  if (!adultAuth.authorized) {
    return NextResponse.json(
      {
        ...emptyResult(page, limit, [], 'Adult authorization required'),
        adultAuthorized: false,
        expiresAt: adultAuth.expiresAt ?? null,
      },
      { status: 403, headers: noStoreHeaders() }
    );
  }

  const adultSources = getAdultSources(
    await getAvailableApiSites(authInfo.username)
  );
  const sources = toAdultSourceOptions(adultSources);

  const scopedSources =
    selectedSource === 'all'
      ? adultSources
      : adultSources.filter((site) => site.key === selectedSource);

  if (scopedSources.length === 0) {
    return NextResponse.json(
      emptyResult(page, limit, sources, 'No adult sources available'),
      { headers: noStoreHeaders() }
    );
  }

  const { list, hasMore } = await fetchAdultRecommendations(scopedSources, {
    page,
    limit,
  });

  return NextResponse.json(
    {
      code: 200,
      message: 'success',
      list,
      page,
      limit,
      hasMore,
      sources,
      adultAuthorized: true,
      expiresAt: adultAuth.expiresAt ?? null,
    },
    {
      headers: noStoreHeaders(),
    }
  );
}

function emptyResult(
  page: number,
  limit: number,
  sources: AdultSourceOption[],
  message: string
) {
  return {
    code: 200,
    message,
    list: [],
    page,
    limit,
    hasMore: false,
    sources,
  };
}

function noStoreHeaders() {
  return {
    'Cache-Control': 'private, no-store',
  };
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
