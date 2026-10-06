import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/auth-server';
import {
  canAccessAdultContent,
  getAvailableApiSites,
  getConfig,
} from '@/lib/config';
import { Following, SearchResult, TodayUpdatedItem } from '@/lib/types';
import { isYellowSearchResult } from '@/lib/yellow';

export const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
};

export function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export function parseFollowingKey(value: unknown): [string, string] | null {
  if (typeof value !== 'string' || value.length > 1024) return null;
  const parts = value.split('+');
  return parts.length === 2 && parts.every((part) => part.length > 0)
    ? [parts[0], parts[1]]
    : null;
}

export function isFollowing(value: unknown): value is Following {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Following;
  return (
    typeof item.title === 'string' &&
    item.title.length > 0 &&
    typeof item.source_name === 'string' &&
    item.source_name.length > 0 &&
    typeof item.cover === 'string' &&
    typeof item.year === 'string' &&
    typeof item.search_title === 'string' &&
    Number.isFinite(item.total_episodes) &&
    item.total_episodes >= 0 &&
    Number.isFinite(item.watched_episodes) &&
    item.watched_episodes >= 0 &&
    (item.save_time === undefined || Number.isFinite(item.save_time))
  );
}

export async function getFollowingAccess(request: NextRequest) {
  const auth = await getVerifiedAuthInfo(request);
  if (!auth?.username) return null;
  const config = await getConfig();
  const available = new Set(
    (await getAvailableApiSites(auth.username)).map((site) => site.key)
  );
  const allowAdult = canAccessAdultContent(config, auth.username);
  const canView = (
    source: string,
    item: Pick<Following | TodayUpdatedItem, 'title' | 'source_name'>
  ) =>
    available.has(source) &&
    (allowAdult ||
      !isYellowSearchResult({
        source,
        title: item.title,
        source_name: item.source_name,
      } as SearchResult));
  return { username: auth.username, canView, allowAdult };
}
